import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  NotFoundError,
  systemActor,
  VersionConflictError,
} from "@healthcare/core";
import { and, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { integrationExchange, type IntegrationExchangeRecord } from "../exchange/exchange.schema";
import type { ExchangeCompletedPayload } from "../exchange/exchange-types";
import { IntegrationExchanges } from "../exchange/integration-exchanges.service";
import type { dismissSchema, recordExternalSchema } from "./doh.dto";
import {
  buildCasePackage,
  canApply,
  caseReadiness,
  caseReportDueAt,
  caseReportOverdue,
  type DohCaseSource,
  isIcd10,
  matchRule,
  normalizeCode,
} from "./doh.rules";
import { type CaseReportRecord, type CaseReportStatus, dohCaseReport, type ReportableRuleRecord } from "./doh.schema";
import { DOH_REPORTING_GATEWAY, DOH_REPORTING_SYSTEM, type DohReportingGateway, SUBMIT_CASE_REPORT } from "./gateway";
import { DohSettingsService, strip } from "./doh-settings.service";
import { DOH_CASE_SOURCES, type DohCaseSources } from "./ports";

/**
 * Disease case reports (API side). A diagnosis matching one of the
 * organization's reportable-condition rules opens a case report for review;
 * staff confirm it — recording the reference from DOH's own channel, or, once
 * an adapter exists, submitting it through the integration worker — or dismiss
 * it with a reason. The platform assists: it never decides reportability on its
 * own terms (the rules are the organization's configuration).
 */
@Injectable()
export class DohReportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(DOH_REPORTING_GATEWAY) private readonly gateway: DohReportingGateway,
    @Inject(DOH_CASE_SOURCES) private readonly sources: DohCaseSources,
    private readonly settings: DohSettingsService,
    private readonly exchanges: IntegrationExchanges,
    private readonly audit: AuditService,
  ) {}

  integration() {
    return this.gateway.specification;
  }

  /**
   * Opens a case report when the coded diagnosis matches an active rule. Idempotent (one case report per diagnosis).
   * Called for DiagnosisRecorded, and by a check of earlier diagnoses (`rescanId`, with the rules it loaded).
   */
  async detect(
    organizationId: string,
    diagnosisId: string,
    options: { rules?: ReportableRuleRecord[]; rescanId?: string } = {},
  ): Promise<"opened" | "exists" | "not_reportable"> {
    const src = await this.sources.forDiagnosis(organizationId, diagnosisId);
    if (!src?.diagnosis.code || !isIcd10(src.diagnosis.codeSystemKey) || src.diagnosis.status === "entered_in_error") return "not_reportable";
    const rule = matchRule(options.rules ?? (await this.settings.rules(organizationId, true)), src.diagnosis.code);
    if (!rule) return "not_reportable";
    return this.db.transaction(async (tx) => {
      const inserted = (await tx
        .insert(dohCaseReport)
        .values({
          organizationId,
          facilityId: src.encounter.facilityId,
          patientId: src.patient.id,
          encounterId: src.encounter.id,
          diagnosisId,
          ruleId: rule.id,
          category: rule.category,
          diagnosisCode: normalizeCode(src.diagnosis.code!),
          diagnosisDisplay: src.diagnosis.display,
          rescanId: options.rescanId ?? null,
          dueAt: caseReportDueAt(src.diagnosis.recordedAt, rule.reportWithinDays),
        })
        .onConflictDoNothing({ target: dohCaseReport.diagnosisId })
        .returning()) as CaseReportRecord[];
      const row = inserted[0];
      if (!row) return "exists";
      await this.audit.record(tx, systemActor(organizationId, src.encounter.facilityId, "doh-reporting"), {
        action: "doh.case.detected",
        resourceType: "doh_case_report",
        resourceId: row.id,
        patientId: row.patientId,
        metadata: { ruleId: rule.id, code: row.diagnosisCode, rescanId: options.rescanId ?? null },
      });
      return "opened";
    });
  }

  /** Case reports awaiting review in the organization (a count for the navigation badge; not audited). */
  async countPendingReview(actor: Actor): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(dohCaseReport)
      .where(and(eq(dohCaseReport.organizationId, actor.organizationId), eq(dohCaseReport.status, "pending_review")));
    return row?.count ?? 0;
  }

  async list(actor: Actor, status?: CaseReportStatus) {
    const conditions = [eq(dohCaseReport.organizationId, actor.organizationId)];
    if (status) conditions.push(eq(dohCaseReport.status, status));
    const rows = await this.db
      .select()
      .from(dohCaseReport)
      .where(and(...conditions))
      .orderBy(sql`${dohCaseReport.status} = 'pending_review' DESC`, desc(dohCaseReport.detectedAt))
      .limit(200);
    const briefs = await this.sources.patientBriefs(actor.organizationId, [...new Set(rows.map((r) => r.patientId))]);
    await this.audit.recordStandalone(actor, {
      action: "doh.case.list",
      resourceType: "doh_case_report",
      metadata: { status: status ?? null, count: rows.length },
    });
    return rows.map((r) => ({ ...strip(r), overdue: caseReportOverdue(r), patient: briefs.get(r.patientId) ?? null }));
  }

  /** One case: the record, readiness checks of the platform's data, the prepared package and any submissions. */
  async get(actor: Actor, caseReportId: string) {
    const row = await this.find(this.db, actor.organizationId, caseReportId);
    const { src, facilityCode } = await this.load(actor.organizationId, row);
    const checks = caseReadiness(src, facilityCode);
    await this.audit.recordStandalone(actor, { action: "doh.case.view", resourceType: "doh_case_report", resourceId: row.id, patientId: row.patientId });
    return {
      ...strip(row),
      overdue: caseReportOverdue(row),
      integration: this.gateway.specification,
      ready: checks.every((c) => c.ok),
      checks,
      report: buildCasePackage(row, src, facilityCode),
      submissions: await this.submissions(actor.organizationId, row.id),
    };
  }

  /** Reported through DOH's own channel: staff record the reference it gave. */
  async recordExternal(actor: Actor, caseReportId: string, input: z.infer<typeof recordExternalSchema>) {
    return this.transition(actor, caseReportId, input.version, "record_external", "doh.case.reported", {
      status: "reported",
      reportedVia: "external_channel",
      externalReference: input.reference,
      statusReason: null,
    });
  }

  async dismiss(actor: Actor, caseReportId: string, input: z.infer<typeof dismissSchema>) {
    return this.transition(actor, caseReportId, input.version, "dismiss", "doh.case.dismissed", { status: "dismissed", statusReason: input.reason });
  }

  /**
   * Queues the case for the integration worker. Refused while DOH reporting is an integration dependency and while
   * the platform's data is incomplete. The same idempotency key returns the same exchange.
   */
  async submit(actor: Actor, caseReportId: string, input: { idempotencyKey: string; version: number }) {
    if (this.gateway.specification.status === "dependency") {
      throw new BusinessRuleError(
        "DOH reporting is not connected: the official specification is an integration dependency. Report through DOH's own channel and record its reference here.",
        "integration_not_configured",
      );
    }
    const [existing] = await this.db
      .select()
      .from(integrationExchange)
      .where(
        and(
          eq(integrationExchange.organizationId, actor.organizationId),
          eq(integrationExchange.system, DOH_REPORTING_SYSTEM),
          eq(integrationExchange.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (existing) {
      if (existing.resourceId !== caseReportId)
        throw new ConflictError("This idempotency key was used for another report", undefined, "idempotency_key_reused");
      return this.get(actor, caseReportId);
    }
    const current = await this.find(this.db, actor.organizationId, caseReportId);
    const { src, facilityCode } = await this.load(actor.organizationId, current);
    const checks = caseReadiness(src, facilityCode);
    if (!checks.every((c) => c.ok)) {
      throw new BusinessRuleError(
        "The case report cannot be prepared yet",
        "case_not_ready",
        checks.filter((c) => !c.ok),
      );
    }
    await this.db.transaction(async (tx) => {
      const row = await this.find(tx, actor.organizationId, caseReportId, true);
      if (row.version !== input.version) throw new VersionConflictError("Case report", input.version);
      if (!canApply("submit", row.status)) throw new BusinessRuleError(`The case report is ${row.status.replace("_", " ")}`, "case_report_state");
      const exchange = await this.exchanges.request(tx, actor, {
        system: DOH_REPORTING_SYSTEM,
        operation: SUBMIT_CASE_REPORT,
        idempotencyKey: input.idempotencyKey,
        patientId: row.patientId,
        resourceType: "doh_case_report",
        resourceId: row.id,
        facilityId: row.facilityId,
        payload: buildCasePackage(row, src, facilityCode),
      });
      await tx
        .update(dohCaseReport)
        .set({ status: "queued", exchangeId: exchange.id, statusReason: null, reviewedBy: actor.userId, reviewedAt: new Date(), version: row.version + 1 })
        .where(eq(dohCaseReport.id, row.id));
      await this.audit.record(tx, actor, {
        action: "doh.case.submit-request",
        resourceType: "doh_case_report",
        resourceId: row.id,
        patientId: row.patientId,
        metadata: { exchangeId: exchange.id },
      });
    });
    return this.get(actor, caseReportId);
  }

  /** Outbox handler (IntegrationExchangeCompleted): records the worker's outcome on the queued case report. Idempotent. */
  async exchangeCompleted(organizationId: string, outcome: ExchangeCompletedPayload): Promise<void> {
    if (outcome.system !== DOH_REPORTING_SYSTEM || outcome.operation !== SUBMIT_CASE_REPORT) return;
    const accepted = outcome.status === "accepted" && outcome.externalReference;
    await this.db.transaction(async (tx) => {
      const updated = (await tx
        .update(dohCaseReport)
        .set({
          status: accepted ? "reported" : outcome.status === "rejected" ? "rejected" : "failed",
          reportedVia: accepted ? "adapter" : null,
          externalReference: accepted ? outcome.externalReference : null,
          statusReason: accepted ? null : outcome.status === "rejected" ? "Rejected by DOH (see the submission's reasons)" : "Not sent (see the submission)",
          version: sql`${dohCaseReport.version} + 1`,
        })
        .where(
          and(
            eq(dohCaseReport.organizationId, organizationId),
            eq(dohCaseReport.id, outcome.resourceId),
            eq(dohCaseReport.exchangeId, outcome.exchangeId),
            eq(dohCaseReport.status, "queued"),
          ),
        )
        .returning()) as CaseReportRecord[];
      const row = updated[0];
      if (!row) return;
      await this.audit.record(tx, systemActor(organizationId, row.facilityId, "doh-reporting"), {
        action: "doh.case.outcome",
        resourceType: "doh_case_report",
        resourceId: row.id,
        patientId: row.patientId,
        outcome: accepted ? "success" : "failure",
        metadata: { exchangeId: outcome.exchangeId, status: row.status },
      });
    });
  }

  // ---- internals -----------------------------------------------------------------------------

  private async transition(
    actor: Actor,
    caseReportId: string,
    version: number,
    action: "record_external" | "dismiss",
    auditAction: string,
    changes: Partial<typeof dohCaseReport.$inferInsert>,
  ) {
    await this.db.transaction(async (tx) => {
      const row = await this.find(tx, actor.organizationId, caseReportId, true);
      if (row.version !== version) throw new VersionConflictError("Case report", version);
      if (!canApply(action, row.status)) throw new BusinessRuleError(`The case report is ${row.status.replace("_", " ")}`, "case_report_state");
      await tx
        .update(dohCaseReport)
        .set({ ...changes, reviewedBy: actor.userId, reviewedAt: new Date(), version: row.version + 1 })
        .where(eq(dohCaseReport.id, row.id));
      await this.audit.record(tx, actor, {
        action: auditAction,
        resourceType: "doh_case_report",
        resourceId: row.id,
        patientId: row.patientId,
        reason: changes.statusReason ?? undefined,
        changes: { status: { from: row.status, to: changes.status } },
        metadata: { externalReference: changes.externalReference ?? null },
      });
    });
    return this.get(actor, caseReportId);
  }

  private async find(executor: DbExecutor, organizationId: string, id: string, lock = false): Promise<CaseReportRecord> {
    const query = executor
      .select()
      .from(dohCaseReport)
      .where(and(eq(dohCaseReport.organizationId, organizationId), eq(dohCaseReport.id, id)));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw new NotFoundError("Case report");
    return row;
  }

  private async load(organizationId: string, row: CaseReportRecord): Promise<{ src: DohCaseSource; facilityCode: string | null }> {
    const src = await this.sources.forDiagnosis(organizationId, row.diagnosisId);
    if (!src) throw new NotFoundError("Diagnosis");
    const setting = await this.settings.facilityCode(organizationId, row.facilityId);
    return { src, facilityCode: setting?.facilityCode ?? null };
  }

  private async submissions(organizationId: string, caseReportId: string) {
    const rows: IntegrationExchangeRecord[] = await this.db
      .select()
      .from(integrationExchange)
      .where(
        and(
          eq(integrationExchange.organizationId, organizationId),
          eq(integrationExchange.system, DOH_REPORTING_SYSTEM),
          eq(integrationExchange.resourceType, "doh_case_report"),
          eq(integrationExchange.resourceId, caseReportId),
        ),
      )
      .orderBy(desc(integrationExchange.requestedAt));
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      attempts: r.attempts,
      externalReference: r.externalReference,
      outcomeDetail: r.outcomeDetail,
      lastError: r.lastError,
      requestedAt: r.requestedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    }));
  }
}
