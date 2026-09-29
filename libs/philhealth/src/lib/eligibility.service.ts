import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  DomainEventHandlers,
  NotFoundError,
  requireFacilityId,
  systemActor,
  filedAsPatient,
} from "@healthcare/core";
import { type ExchangeCompletedPayload, INTEGRATION_EXCHANGE_COMPLETED, integrationExchange, IntegrationExchanges } from "@healthcare/interoperability";
import { and, desc, eq, gte, lte, ne } from "drizzle-orm";
import type { z } from "zod";
import type { recordEligibilitySchema, requestEligibilitySchema } from "./eligibility.dto";
import {
  buildEligibilityInquiry,
  CHECK_ELIGIBILITY,
  type EligibilityAnswer,
  eligibilityReadiness,
  PHILHEALTH_ELIGIBILITY_GATEWAY,
  PHILHEALTH_ELIGIBILITY_SYSTEM,
  type PhilHealthEligibilityGateway,
} from "./eligibility";
import { type EligibilityCheckRecord, philhealthEligibilityCheck } from "./philhealth.schema";
import { PhilHealthSettingsService } from "./philhealth-settings.service";
import { PHILHEALTH_CLAIM_SOURCES, type PhilHealthClaimSources } from "./ports";

const ANSWERS = new Set<string>(["eligible", "not_eligible", "undetermined"]);

/**
 * PhilHealth eligibility checks (API side). Staff record what PhilHealth's own
 * channel answered, with its reference; once an adapter exists they can ask
 * through the integration worker instead. Answers are history: never changed,
 * never deleted (database trigger). The platform does not decide eligibility.
 */
@Injectable()
export class PhilHealthEligibilityService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PHILHEALTH_ELIGIBILITY_GATEWAY) private readonly gateway: PhilHealthEligibilityGateway,
    @Inject(PHILHEALTH_CLAIM_SOURCES) private readonly sources: PhilHealthClaimSources,
    private readonly settings: PhilHealthSettingsService,
    private readonly exchanges: IntegrationExchanges,
    private readonly handlers: DomainEventHandlers,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.handlers.on(INTEGRATION_EXCHANGE_COMPLETED, "philhealth.eligibility-outcome", (event) =>
      this.exchangeCompleted(event.organizationId, event.payload as unknown as ExchangeCompletedPayload),
    );
  }

  /** The patient's checks (newest first) and, for the selected facility and date, what a new inquiry would need. */
  async list(actor: Actor, patientId: string, serviceDate?: string) {
    const patient = await this.sources.patient(actor.organizationId, patientId);
    if (!patient) throw new NotFoundError("Patient");
    const rows = await this.db
      .select()
      .from(philhealthEligibilityCheck)
      .where(and(eq(philhealthEligibilityCheck.organizationId, actor.organizationId), filedAsPatient(philhealthEligibilityCheck.patientId, patientId)))
      .orderBy(desc(philhealthEligibilityCheck.serviceDate), desc(philhealthEligibilityCheck.createdAt))
      .limit(50);
    const accreditation = actor.facilityId ? await this.settings.accreditation(actor.organizationId, actor.facilityId) : null;
    await this.audit.recordStandalone(actor, { action: "philhealth.eligibility.list", resourceType: "patient", resourceId: patientId, patientId });
    return {
      integration: this.gateway.specification,
      checks: rows.map(view),
      readiness: actor.facilityId && serviceDate ? eligibilityReadiness(patient, accreditation, serviceDate) : null,
    };
  }

  /** What PhilHealth's own channel answered, recorded by staff with its reference. */
  async record(actor: Actor, input: z.infer<typeof recordEligibilitySchema>) {
    const facilityId = requireFacilityId(actor);
    if (!(await this.sources.patient(actor.organizationId, input.patientId))) throw new NotFoundError("Patient");
    return this.db.transaction(async (tx) => {
      const [row] = (await tx
        .insert(philhealthEligibilityCheck)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          patientId: input.patientId,
          serviceDate: input.serviceDate,
          status: input.answer,
          source: "external_channel",
          externalReference: input.reference,
          note: input.note ?? null,
          requestedBy: actor.userId,
          completedAt: new Date(),
        })
        .returning()) as [EligibilityCheckRecord];
      await this.audit.record(tx, actor, {
        action: "philhealth.eligibility.record",
        resourceType: "philhealth_eligibility_check",
        resourceId: row.id,
        patientId: input.patientId,
        metadata: { serviceDate: input.serviceDate, answer: input.answer, reference: input.reference },
      });
      return view(row);
    });
  }

  /** Asks PhilHealth through the adapter (integration worker). Refused while the eligibility specification is a dependency. */
  async request(actor: Actor, input: z.infer<typeof requestEligibilitySchema>) {
    const facilityId = requireFacilityId(actor);
    if (this.gateway.specification.status === "dependency") {
      throw new BusinessRuleError(
        "PhilHealth eligibility checking is not connected: the official specification is an integration dependency. Check through PhilHealth's own channel and record the answer here.",
        "integration_not_configured",
      );
    }
    const [existing] = await this.db
      .select({ check: philhealthEligibilityCheck })
      .from(integrationExchange)
      .innerJoin(philhealthEligibilityCheck, eq(philhealthEligibilityCheck.exchangeId, integrationExchange.id))
      .where(
        and(
          eq(integrationExchange.organizationId, actor.organizationId),
          eq(integrationExchange.system, PHILHEALTH_ELIGIBILITY_SYSTEM),
          eq(integrationExchange.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (existing) {
      if (existing.check.patientId !== input.patientId)
        throw new ConflictError("This idempotency key was used for another check", undefined, "idempotency_key_reused");
      return view(existing.check);
    }
    const patient = await this.sources.patient(actor.organizationId, input.patientId);
    if (!patient) throw new NotFoundError("Patient");
    const accreditation = await this.settings.accreditation(actor.organizationId, facilityId);
    const checks = eligibilityReadiness(patient, accreditation, input.serviceDate);
    if (!checks.every((c) => c.ok)) {
      throw new BusinessRuleError(
        "The eligibility inquiry cannot be prepared yet",
        "eligibility_not_ready",
        checks.filter((c) => !c.ok),
      );
    }
    return this.db.transaction(async (tx) => {
      const exchange = await this.exchanges.request(tx, actor, {
        system: PHILHEALTH_ELIGIBILITY_SYSTEM,
        operation: CHECK_ELIGIBILITY,
        idempotencyKey: input.idempotencyKey,
        patientId: input.patientId,
        resourceType: "patient",
        resourceId: input.patientId,
        facilityId,
        payload: buildEligibilityInquiry(patient, facilityId, accreditation, input.serviceDate),
      });
      const [row] = (await tx
        .insert(philhealthEligibilityCheck)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          patientId: input.patientId,
          serviceDate: input.serviceDate,
          status: "queued",
          source: "adapter",
          exchangeId: exchange.id,
          requestedBy: actor.userId,
        })
        .returning()) as [EligibilityCheckRecord];
      await this.audit.record(tx, actor, {
        action: "philhealth.eligibility.request",
        resourceType: "philhealth_eligibility_check",
        resourceId: row.id,
        patientId: input.patientId,
        metadata: { serviceDate: input.serviceDate, exchangeId: exchange.id },
      });
      return view(row);
    });
  }

  /** The most recent answered check covering a date range (informational on claims; not a PhilHealth rule). */
  async latestAnswered(organizationId: string, patientId: string, from: string, to: string) {
    const [row] = await this.db
      .select()
      .from(philhealthEligibilityCheck)
      .where(
        and(
          eq(philhealthEligibilityCheck.organizationId, organizationId),
          filedAsPatient(philhealthEligibilityCheck.patientId, patientId),
          gte(philhealthEligibilityCheck.serviceDate, from),
          lte(philhealthEligibilityCheck.serviceDate, to),
          ne(philhealthEligibilityCheck.status, "queued"),
          ne(philhealthEligibilityCheck.status, "failed"),
        ),
      )
      .orderBy(desc(philhealthEligibilityCheck.createdAt))
      .limit(1);
    return row ? view(row) : null;
  }

  /** Outbox handler (IntegrationExchangeCompleted): records the adapter's answer on the queued check. Idempotent. */
  async exchangeCompleted(organizationId: string, outcome: ExchangeCompletedPayload): Promise<void> {
    if (outcome.system !== PHILHEALTH_ELIGIBILITY_SYSTEM || outcome.operation !== CHECK_ELIGIBILITY) return;
    const answer = outcome.status === "accepted" && ANSWERS.has(outcome.detail.eligibility ?? "") ? (outcome.detail.eligibility as EligibilityAnswer) : null;
    await this.db.transaction(async (tx) => {
      const updated = (await tx
        .update(philhealthEligibilityCheck)
        .set({
          status: answer ?? "failed",
          externalReference: answer ? outcome.externalReference : null,
          note: answer ? null : outcome.status === "rejected" ? "The inquiry was rejected (see the exchange log)" : "No answer (see the exchange log)",
          outcomeDetail: outcome.detail,
          completedAt: new Date(),
        })
        .where(
          and(
            eq(philhealthEligibilityCheck.organizationId, organizationId),
            eq(philhealthEligibilityCheck.exchangeId, outcome.exchangeId),
            eq(philhealthEligibilityCheck.status, "queued"),
          ),
        )
        .returning()) as EligibilityCheckRecord[];
      const row = updated[0];
      if (!row) return;
      await this.audit.record(tx, systemActor(organizationId, row.facilityId, PHILHEALTH_ELIGIBILITY_SYSTEM), {
        action: "philhealth.eligibility.answer",
        resourceType: "philhealth_eligibility_check",
        resourceId: row.id,
        patientId: row.patientId,
        outcome: answer ? "success" : "failure",
        metadata: { status: row.status, exchangeId: outcome.exchangeId },
      });
    });
  }
}

function view({ organizationId: _o, ...row }: EligibilityCheckRecord) {
  return { ...row, createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null };
}
