import { Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { AccessService, AuthService } from "@healthcare/auth";
import {
  type Actor,
  APP_CONFIG,
  type AppConfig,
  BusinessRuleError,
  DATABASE,
  type Database,
  ForbiddenError,
  localDate,
  NotFoundError,
  PH_TIMEZONE,
  systemActor,
  VersionConflictError,
} from "@healthcare/core";
import { DocumentsService } from "@healthcare/documents";
import { NotificationService } from "@healthcare/notification";
import { OrganizationService } from "@healthcare/organization";
import { and, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { coversAll, type ExportTable, PDF_REPORT, REPORT_FILES, type ReportFile, TABLE_SECTIONS, type WithheldSection } from "./management-dashboard.rules";
import { DISPENSING_PERMISSION, INVENTORY_PERMISSION, ManagementDashboardService, REVENUE_PERMISSION } from "./management-dashboard.service";
import { duePeriods, type ReportPeriod, reportFileName } from "./management-report.rules";
import {
  managementReport,
  type ManagementReportRecord,
  managementReportFile,
  managementReportSchedule,
  type ManagementReportScheduleRecord,
  type ReportCadence,
  type WithheldTable,
} from "./management-report.schema";

const MANAGEMENT_PERMISSION = "management.dashboard.read";
/** The permission each gated section needs on every facility of the scope, and how its refusal is named. */
const SECTION_PERMISSIONS: Record<WithheldSection, { permission: string; code: string; message: string }> = {
  billing: {
    permission: REVENUE_PERMISSION,
    code: "revenue_not_reportable",
    message: "Revenue tables need the billing report permission for every facility in scope",
  },
  inventory: {
    permission: INVENTORY_PERMISSION,
    code: "stock_not_reportable",
    message: "Stock tables need the inventory valuation permission for every facility in scope",
  },
  dispensing: {
    permission: DISPENSING_PERMISSION,
    code: "dispensing_not_reportable",
    message: "Dispensing tables need the prescription reading permission for every facility in scope",
  },
};
/** A run still 'producing' this long after it started was interrupted (an API restart) and is resumed. */
const STALE_RUN_MS = 10 * 60 * 1000;
/** A failed run is tried again every hour for this long, then left as it is for someone to look at. */
const RETRY_FAILED_MS = 7 * 24 * 60 * 60 * 1000;

export interface ScheduleInput {
  name: string;
  cadence: ReportCadence;
  /** CSV tables of the dashboard, and `pdf` for the whole dashboard as one PDF. */
  tables: ReportFile[];
  facilityId?: string | null;
  recipientUserIds: string[];
}

export interface ScheduleView {
  id: string;
  name: string;
  cadence: ReportCadence;
  tables: string[];
  facilityId: string | null;
  recipientUserIds: string[];
  ownerUserId: string;
  status: "active" | "paused";
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportRunView {
  id: string;
  scheduleId: string;
  periodFrom: string;
  periodTo: string;
  facilityId: string | null;
  status: ManagementReportRecord["status"];
  withheld: WithheldTable[];
  error: string | null;
  startedAt: Date;
  producedAt: Date | null;
  files: Array<{ table: string; storedAt: Date | null }>;
}

function toScheduleView(row: ManagementReportScheduleRecord): ScheduleView {
  return {
    id: row.id,
    name: row.name,
    cadence: row.cadence,
    tables: row.tables,
    facilityId: row.facilityId,
    recipientUserIds: row.recipientUserIds,
    ownerUserId: row.ownerUserId,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Scheduled management reports (docs/architecture/management-dashboard.md, "Scheduled reports"). A schedule names a
 * cadence, the dashboard tables wanted, a facility scope and the recipients; the hourly job produces each ended
 * period once, as CSV files stored as documents, through the same export the screen uses and with the schedule
 * owner's permissions (re-resolved at each run), then tells each recipient who still holds the permissions the report
 * needs. Nothing here names a patient; small patient counts stay suppressed and revenue tables need billing reporting.
 */
@Injectable()
export class ManagementReportService {
  private readonly logger = new Logger(ManagementReportService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly dashboards: ManagementDashboardService,
    private readonly access: AccessService,
    private readonly auth: AuthService,
    private readonly organizations: OrganizationService,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  // ---- schedules ---------------------------------------------------------------------------------------------------

  async listSchedules(actor: Actor): Promise<ScheduleView[]> {
    const rows = await this.db
      .select()
      .from(managementReportSchedule)
      .where(eq(managementReportSchedule.organizationId, actor.organizationId))
      .orderBy(managementReportSchedule.name);
    return rows.map(toScheduleView);
  }

  async createSchedule(actor: Actor, input: ScheduleInput): Promise<ScheduleView> {
    await this.validate(actor, input);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(managementReportSchedule)
        .values({
          organizationId: actor.organizationId,
          facilityId: input.facilityId ?? null,
          name: input.name,
          cadence: input.cadence,
          tables: input.tables,
          recipientUserIds: input.recipientUserIds,
          ownerUserId: actor.userId,
          updatedBy: actor.userId,
        })
        .returning();
      await this.audit.record(tx, actor, {
        action: "management.report-schedule.create",
        resourceType: "management_report_schedule",
        resourceId: row!.id,
        metadata: { cadence: input.cadence, tables: input.tables, facilityId: input.facilityId ?? null, recipients: input.recipientUserIds.length },
      });
      return toScheduleView(row!);
    });
  }

  async updateSchedule(actor: Actor, scheduleId: string, input: ScheduleInput & { version: number }): Promise<ScheduleView> {
    await this.validate(actor, input);
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, actor.organizationId, scheduleId);
      if (current.version !== input.version) throw new VersionConflictError("Report schedule", input.version);
      const [row] = await tx
        .update(managementReportSchedule)
        .set({
          name: input.name,
          cadence: input.cadence,
          tables: input.tables,
          facilityId: input.facilityId ?? null,
          recipientUserIds: input.recipientUserIds,
          // The person who last set it up produces it from now on (their permissions decide scope and revenue).
          ownerUserId: actor.userId,
          version: current.version + 1,
          updatedAt: new Date(),
          updatedBy: actor.userId,
        })
        .where(eq(managementReportSchedule.id, scheduleId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "management.report-schedule.update",
        resourceType: "management_report_schedule",
        resourceId: scheduleId,
        changes: {
          cadence: { from: current.cadence, to: input.cadence },
          tables: { from: current.tables, to: input.tables },
          facilityId: { from: current.facilityId, to: input.facilityId ?? null },
          recipients: { from: current.recipientUserIds, to: input.recipientUserIds },
        },
      });
      return toScheduleView(row!);
    });
  }

  async setScheduleStatus(actor: Actor, scheduleId: string, status: "active" | "paused", version: number): Promise<ScheduleView> {
    return this.db.transaction(async (tx) => {
      const current = await this.lock(tx, actor.organizationId, scheduleId);
      if (current.version !== version) throw new VersionConflictError("Report schedule", version);
      const [row] = await tx
        .update(managementReportSchedule)
        .set({ status, version: current.version + 1, updatedAt: new Date(), updatedBy: actor.userId })
        .where(eq(managementReportSchedule.id, scheduleId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "management.report-schedule.status",
        resourceType: "management_report_schedule",
        resourceId: scheduleId,
        changes: { status: { from: current.status, to: status } },
      });
      return toScheduleView(row!);
    });
  }

  /**
   * Tables must be the dashboard's; a facility must be the organization's; every recipient must be an active member
   * holding the dashboard permission in the scope; and the owner (the caller) must hold what the tables need, so that
   * a schedule is never created that can only produce an empty report.
   */
  private async validate(actor: Actor, input: ScheduleInput): Promise<void> {
    const unknown = input.tables.filter((t) => !REPORT_FILES.includes(t));
    if (unknown.length > 0) throw new BusinessRuleError(`Unknown table(s): ${unknown.join(", ")}`, "unknown_table");
    const facilities = await this.organizations.listFacilities(actor.organizationId);
    if (input.facilityId && !facilities.some((f) => f.id === input.facilityId)) throw new NotFoundError("Facility");
    const scope = input.facilityId ? [input.facilityId] : facilities.map((f) => f.id);

    const ownerGrants = await this.access.grantsFor(actor.userId, actor.organizationId);
    if (
      !coversAll(
        ownerGrants.filter((g) => g.permissionKey === MANAGEMENT_PERMISSION),
        scope,
      )
    ) {
      throw new ForbiddenError("You may not report on every facility in this scope", "scope_not_reportable");
    }
    // A gated table can only be promised when the owner holds its permission; the PDF prints withheld sections as such.
    const sections = new Set(input.tables.flatMap((t) => (t === PDF_REPORT ? [] : [TABLE_SECTIONS[t]])).filter((x): x is WithheldSection => !!x));
    for (const section of sections) {
      const { permission, code, message } = SECTION_PERMISSIONS[section];
      if (
        !coversAll(
          ownerGrants.filter((g) => g.permissionKey === permission),
          scope,
        )
      ) {
        throw new ForbiddenError(message, code);
      }
    }

    for (const userId of new Set(input.recipientUserIds)) {
      if (!(await this.auth.hasActiveMembership(userId, actor.organizationId))) {
        throw new BusinessRuleError("Every recipient must be an active member of the organization", "recipient_not_member");
      }
      const grants = await this.access.grantsFor(userId, actor.organizationId);
      if (
        !coversAll(
          grants.filter((g) => g.permissionKey === MANAGEMENT_PERMISSION),
          scope,
        )
      ) {
        throw new BusinessRuleError("Every recipient must be allowed to view the management dashboard for the scope", "recipient_not_permitted");
      }
    }
  }

  private async lock(tx: Database, organizationId: string, scheduleId: string): Promise<ManagementReportScheduleRecord> {
    const [row] = await tx
      .select()
      .from(managementReportSchedule)
      .where(and(eq(managementReportSchedule.organizationId, organizationId), eq(managementReportSchedule.id, scheduleId)))
      .for("update");
    if (!row) throw new NotFoundError("Report schedule");
    return row;
  }

  // ---- runs ------------------------------------------------------------------------------------------------------

  async listRuns(actor: Actor, scheduleId?: string, limit = 50): Promise<ReportRunView[]> {
    const where = scheduleId
      ? and(eq(managementReport.organizationId, actor.organizationId), eq(managementReport.scheduleId, scheduleId))
      : eq(managementReport.organizationId, actor.organizationId);
    const runs = await this.db
      .select()
      .from(managementReport)
      .where(where)
      .orderBy(desc(managementReport.periodFrom), desc(managementReport.startedAt))
      .limit(limit);
    if (runs.length === 0) return [];
    const files = await this.db
      .select()
      .from(managementReportFile)
      .where(
        inArray(
          managementReportFile.reportId,
          runs.map((r) => r.id),
        ),
      );
    return runs.map((run) => ({
      id: run.id,
      scheduleId: run.scheduleId,
      periodFrom: run.periodFrom,
      periodTo: run.periodTo,
      facilityId: run.facilityId,
      status: run.status,
      withheld: run.withheld,
      error: run.error,
      startedAt: run.startedAt,
      producedAt: run.producedAt,
      files: files
        .filter((f) => f.reportId === run.id)
        .map((f) => ({ table: f.table, storedAt: f.storedAt }))
        .sort((a, b) => a.table.localeCompare(b.table)),
    }));
  }

  /**
   * One stored table of a run. The dashboard permission opens the route; a revenue table also needs billing reporting
   * on every facility the run covers (as the screen's export does). The download is audited.
   */
  async download(actor: Actor, runId: string, table: string): Promise<{ fileName: string; body: Buffer }> {
    const [run] = await this.db
      .select()
      .from(managementReport)
      .where(and(eq(managementReport.organizationId, actor.organizationId), eq(managementReport.id, runId)));
    if (!run) throw new NotFoundError("Report");
    const [file] = await this.db
      .select()
      .from(managementReportFile)
      .where(and(eq(managementReportFile.reportId, runId), eq(managementReportFile.table, table)));
    if (!file?.documentId) throw new NotFoundError("Report file");
    // A gated table needs its permission on every facility of the run (as the screen's export does). The PDF was
    // produced with the owner's permissions and may hold every section: it needs every gated permission the owner had.
    const sections: WithheldSection[] =
      table === PDF_REPORT
        ? (Object.keys(SECTION_PERMISSIONS) as WithheldSection[]).filter((s) => !run.withheld.some((w) => w.table === `pdf:${s}`))
        : [TABLE_SECTIONS[table as ExportTable]].filter((s): s is WithheldSection => !!s);
    if (sections.length > 0) {
      const facilities = await this.organizations.listFacilities(actor.organizationId);
      const scope = run.facilityId ? [run.facilityId] : facilities.map((f) => f.id);
      const grants = await this.access.grantsFor(actor.userId, actor.organizationId);
      for (const section of sections) {
        const { permission } = SECTION_PERMISSIONS[section];
        if (
          !coversAll(
            grants.filter((g) => g.permissionKey === permission),
            scope,
          )
        ) {
          await this.audit.recordStandalone(actor, {
            action: "management.report.download",
            resourceType: "management_report",
            resourceId: runId,
            outcome: "denied",
            reason: `${section === "billing" ? "Revenue" : section === "inventory" ? "Stock" : "Dispensing"} figures need ${permission} for every facility in scope`,
            metadata: { table, section },
          });
          throw new ForbiddenError(SECTION_PERMISSIONS[section].message.replace(" tables ", " figures "));
        }
      }
    }
    const { body } = await this.documents.content(actor, file.documentId);
    await this.audit.recordStandalone(actor, {
      action: "management.report.download",
      resourceType: "management_report",
      resourceId: runId,
      metadata: { table, periodFrom: run.periodFrom, periodTo: run.periodTo, facilityId: run.facilityId },
    });
    return { fileName: reportFileName(table, { from: run.periodFrom, to: run.periodTo }), body };
  }

  // ---- production (the hourly job) ---------------------------------------------------------------------------------

  /** Produces every ended period of every active schedule not yet produced, and resumes interrupted runs. Idempotent. */
  async produceDue(now = new Date()): Promise<{ produced: number; resumed: number }> {
    let produced = 0;
    let resumed = 0;
    // Runs a crashed instance left behind, and failed runs still worth another try (stored files are kept).
    const stale = await this.db
      .select()
      .from(managementReport)
      .where(
        or(
          and(eq(managementReport.status, "producing"), lt(managementReport.startedAt, new Date(now.getTime() - STALE_RUN_MS))),
          and(eq(managementReport.status, "failed"), gt(managementReport.startedAt, new Date(now.getTime() - RETRY_FAILED_MS))),
        ),
      );
    for (const run of stale) {
      const [schedule] = await this.db.select().from(managementReportSchedule).where(eq(managementReportSchedule.id, run.scheduleId));
      if (!schedule) continue;
      await this.produceRun(schedule, run);
      resumed += 1;
    }

    const schedules = await this.db.select().from(managementReportSchedule).where(eq(managementReportSchedule.status, "active"));
    for (const schedule of schedules) {
      const facilities = await this.organizations.listFacilities(schedule.organizationId);
      const timeZone = facilities.find((f) => f.id === schedule.facilityId)?.timezone ?? PH_TIMEZONE;
      const today = localDate(now, timeZone);
      const existing = await this.db
        .select({ periodFrom: managementReport.periodFrom })
        .from(managementReport)
        .where(eq(managementReport.scheduleId, schedule.id));
      for (const period of duePeriods(schedule.cadence, today, new Set(existing.map((r) => r.periodFrom)))) {
        const run = await this.claimRun(schedule, period);
        if (!run) continue; // another instance claimed it
        await this.produceRun(schedule, run);
        produced += 1;
      }
    }
    return { produced, resumed };
  }

  /** The run row and its file rows (document ids chosen now), or null when the period is already claimed. */
  private async claimRun(schedule: ManagementReportScheduleRecord, period: ReportPeriod): Promise<ManagementReportRecord | null> {
    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .insert(managementReport)
        .values({
          organizationId: schedule.organizationId,
          scheduleId: schedule.id,
          periodFrom: period.from,
          periodTo: period.to,
          facilityId: schedule.facilityId,
        })
        .onConflictDoNothing()
        .returning();
      if (!run) return null;
      await tx.insert(managementReportFile).values(schedule.tables.map((table) => ({ reportId: run.id, organizationId: schedule.organizationId, table })));
      return run;
    });
  }

  private async produceRun(schedule: ManagementReportScheduleRecord, run: ManagementReportRecord): Promise<void> {
    const period = { from: run.periodFrom, to: run.periodTo };
    const owner = await this.ownerActor(schedule);
    const files = await this.db.select().from(managementReportFile).where(eq(managementReportFile.reportId, run.id));
    const withheld: WithheldTable[] = [...run.withheld];
    try {
      for (const file of files) {
        if (file.storedAt || withheld.some((w) => w.table === file.table)) continue;
        const query = { from: period.from, to: period.to, facilityId: schedule.facilityId ?? undefined };
        let body: Buffer;
        let contentType: "text/csv" | "application/pdf";
        if (file.table === PDF_REPORT) {
          // The PDF prints what the owner may see; the sections it had to leave out are recorded as `pdf:<section>`.
          const { pdf, withheld: left } = await this.dashboards.exportPdf(owner, query);
          for (const section of left) {
            if (!withheld.some((w) => w.table === `pdf:${section}`))
              withheld.push({ table: `pdf:${section}`, reason: `Not available to the owner: ${section}` });
          }
          body = pdf;
          contentType = "application/pdf";
        } else {
          try {
            body = Buffer.from(`\uFEFF${(await this.dashboards.export(owner, query, file.table as ExportTable)).csv}`, "utf8");
            contentType = "text/csv";
          } catch (error) {
            if (error instanceof ForbiddenError) {
              withheld.push({ table: file.table, reason: error.message });
              continue;
            }
            throw error;
          }
        }
        // A fresh document id per attempt: an interrupted attempt leaves no file row pointing at a document.
        const documentId = crypto.randomUUID();
        await this.documents.storeGenerated(owner, {
          id: documentId,
          facilityId: schedule.facilityId,
          patientId: null,
          category: "management_report",
          title: `${schedule.name} — ${file.table} ${period.from} to ${period.to}`,
          fileName: reportFileName(file.table, period),
          contentType,
          body,
        });
        await this.db
          .update(managementReportFile)
          .set({ documentId, storedAt: new Date() })
          .where(and(eq(managementReportFile.reportId, run.id), eq(managementReportFile.table, file.table)));
      }
    } catch (error) {
      await this.db
        .update(managementReport)
        .set({ status: "failed", error: String(error).slice(0, 500), withheld })
        .where(eq(managementReport.id, run.id));
      this.logger.warn({ event: "management_report.failed", scheduleId: schedule.id, reportId: run.id, message: String(error) });
      return;
    }
    const status = withheld.length > 0 ? "partial" : "produced";
    await this.db.update(managementReport).set({ status, withheld, producedAt: new Date(), error: null }).where(eq(managementReport.id, run.id));
    await this.audit.recordStandalone(systemActor(schedule.organizationId, schedule.facilityId, "management-reports"), {
      action: "management.report.produce",
      resourceType: "management_report",
      resourceId: run.id,
      metadata: { scheduleId: schedule.id, periodFrom: period.from, periodTo: period.to, tables: schedule.tables, withheld, ownerUserId: schedule.ownerUserId },
    });
    await this.notify(schedule, { ...run, status, withheld });
  }

  /** Tells each recipient who is still a member holding the dashboard permission for the scope; once per recipient and run. */
  private async notify(schedule: ManagementReportScheduleRecord, run: ManagementReportRecord): Promise<void> {
    const facilities = await this.organizations.listFacilities(schedule.organizationId);
    const scope = schedule.facilityId ? [schedule.facilityId] : facilities.map((f) => f.id);
    const actor = systemActor(schedule.organizationId, schedule.facilityId, "management-reports");
    const variables = {
      scheduleName: schedule.name,
      periodFrom: run.periodFrom,
      periodTo: run.periodTo,
      ...(this.config.STAFF_BASE_URL ? { link: `${this.config.STAFF_BASE_URL.replace(/\/$/, "")}/management/reports` } : {}),
    };
    const told = new Set(run.notifiedUserIds);
    for (const userId of new Set(schedule.recipientUserIds)) {
      if (told.has(userId)) continue;
      if (!(await this.auth.hasActiveMembership(userId, schedule.organizationId))) continue;
      const grants = await this.access.grantsFor(userId, schedule.organizationId);
      if (
        !coversAll(
          grants.filter((g) => g.permissionKey === MANAGEMENT_PERMISSION),
          scope,
        )
      )
        continue;
      for (const channel of ["in_app", "email"] as const) {
        await this.notifications
          .send(actor, {
            recipient: { type: "user", userId },
            channel,
            templateKey: "management.report-ready",
            variables,
            idempotencyKey: `management-report:${run.id}:${userId}:${channel}`,
          })
          .catch((error: unknown) => this.logger.warn({ event: "management_report.notice_failed", reportId: run.id, channel, message: String(error) }));
      }
      told.add(userId);
      await this.db
        .update(managementReport)
        .set({ notifiedUserIds: [...told] })
        .where(eq(managementReport.id, run.id));
    }
  }

  /** The schedule's owner as the actor of the export: their grants decide the scope and whether revenue is included. */
  private async ownerActor(schedule: ManagementReportScheduleRecord): Promise<Actor> {
    const user = await this.auth.getUser(schedule.ownerUserId);
    const permissions = await this.access.resolvePermissions(user.id, schedule.organizationId, { facilityId: schedule.facilityId ?? undefined });
    return {
      kind: "user",
      userId: user.id,
      displayName: user.displayName,
      organizationId: schedule.organizationId,
      facilityId: schedule.facilityId ?? undefined,
      isPlatformAdmin: false,
      permissions,
      request: {},
    };
  }
}
