import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  NotFoundError,
  requireFacilityId,
  VersionConflictError,
} from "@healthcare/core";
import { integrationExchange, type IntegrationExchangeRecord, IntegrationExchanges } from "@healthcare/interoperability";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { maskPin } from "./claim-package";
import { philhealthYakapParticipation, philhealthYakapRegistration, type YakapParticipationRecord, type YakapRegistrationRecord } from "./philhealth.schema";
import { PHILHEALTH_CLAIM_SOURCES, PHILHEALTH_YAKAP_SOURCES, type PhilHealthClaimSources, type PhilHealthYakapSources } from "./ports";
import {
  buildYakapPackage,
  isYakapReady,
  PHILHEALTH_YAKAP_GATEWAY,
  PHILHEALTH_YAKAP_SYSTEM,
  type PhilHealthYakapGateway,
  SUBMIT_YAKAP_ENCOUNTER,
  type YakapEncounterSource,
  yakapReadiness,
  type YakapRegistrationSource,
} from "./yakap";
import type { recordYakapRegistrationSchema, yakapParticipationSchema } from "./yakap.dto";

const ENCOUNTER = "encounter";

/**
 * PhilHealth YAKAP (API side): the facility's participation reference, PhilHealth's answers about a patient's
 * registration (recorded from PhilHealth's own channel; history, never changed), and a format-neutral encounter
 * package prepared from the clinical record with readiness checks of the platform's own data. The default gateway is
 * unconfigured (no official specification): a submission is refused rather than faked. With an adapter, a submission
 * is sealed here and sent by the integration worker.
 */
@Injectable()
export class PhilHealthYakapService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PHILHEALTH_YAKAP_GATEWAY) private readonly gateway: PhilHealthYakapGateway,
    @Inject(PHILHEALTH_YAKAP_SOURCES) private readonly sources: PhilHealthYakapSources,
    @Inject(PHILHEALTH_CLAIM_SOURCES) private readonly patients: PhilHealthClaimSources,
    private readonly exchanges: IntegrationExchanges,
    private readonly audit: AuditService,
  ) {}

  // ---- facility participation ----------------------------------------------------------------------

  async participation(organizationId: string, facilityId: string): Promise<YakapParticipationRecord | null> {
    const [row] = await this.db
      .select()
      .from(philhealthYakapParticipation)
      .where(and(eq(philhealthYakapParticipation.organizationId, organizationId), eq(philhealthYakapParticipation.facilityId, facilityId)));
    return row ?? null;
  }

  /** Records the facility's YAKAP participation reference as issued by PhilHealth (not verified). Versioned and audited. */
  async recordParticipation(actor: Actor, facilityId: string, input: z.infer<typeof yakapParticipationSchema>) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(philhealthYakapParticipation)
        .where(and(eq(philhealthYakapParticipation.organizationId, actor.organizationId), eq(philhealthYakapParticipation.facilityId, facilityId)))
        .for("update");
      const values = {
        participationReference: input.participationReference,
        validFrom: input.validFrom ?? null,
        validUntil: input.validUntil ?? null,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      };
      let saved: YakapParticipationRecord;
      if (current) {
        if (input.version !== current.version) throw new VersionConflictError("YAKAP participation reference", input.version ?? 0);
        [saved] = (await tx
          .update(philhealthYakapParticipation)
          .set({ ...values, version: current.version + 1 })
          .where(eq(philhealthYakapParticipation.id, current.id))
          .returning()) as [YakapParticipationRecord];
      } else {
        // The facility must belong to the organization (composite foreign key).
        [saved] = (await tx
          .insert(philhealthYakapParticipation)
          .values({ organizationId: actor.organizationId, facilityId, ...values })
          .returning()) as [YakapParticipationRecord];
      }
      await this.audit.record(tx, actor, {
        action: "philhealth.yakap.participation.record",
        resourceType: "facility",
        resourceId: facilityId,
        changes: {
          participationReference: { from: current?.participationReference ?? null, to: saved.participationReference },
          validFrom: { from: current?.validFrom ?? null, to: saved.validFrom },
          validUntil: { from: current?.validUntil ?? null, to: saved.validUntil },
        },
      });
      return participationView(saved);
    });
  }

  // ---- registration answers ------------------------------------------------------------------------

  /** The patient's recorded registration answers (newest first) and the selected facility's participation reference. */
  async registrations(actor: Actor, patientId: string) {
    if (!(await this.patients.patient(actor.organizationId, patientId))) throw new NotFoundError("Patient");
    const rows = await this.db
      .select()
      .from(philhealthYakapRegistration)
      .where(and(eq(philhealthYakapRegistration.organizationId, actor.organizationId), eq(philhealthYakapRegistration.patientId, patientId)))
      .orderBy(desc(philhealthYakapRegistration.recordedAt))
      .limit(50);
    const participation = actor.facilityId ? await this.participation(actor.organizationId, actor.facilityId) : null;
    await this.audit.recordStandalone(actor, { action: "philhealth.yakap.registration.list", resourceType: "patient", resourceId: patientId, patientId });
    return {
      integration: this.gateway.specification,
      participation: participation ? participationView(participation) : null,
      registrations: rows.map(registrationView),
    };
  }

  /** Records what PhilHealth's own channel answered about the patient's registration at the selected facility. Never changed afterwards. */
  async recordRegistration(actor: Actor, input: z.infer<typeof recordYakapRegistrationSchema>) {
    const facilityId = requireFacilityId(actor);
    if (!(await this.patients.patient(actor.organizationId, input.patientId))) throw new NotFoundError("Patient");
    return this.db.transaction(async (tx) => {
      const [row] = (await tx
        .insert(philhealthYakapRegistration)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          patientId: input.patientId,
          status: input.status,
          effectiveDate: input.effectiveDate ?? null,
          externalReference: input.reference ?? null,
          note: input.note ?? null,
          recordedBy: actor.userId,
        })
        .returning()) as [YakapRegistrationRecord];
      await this.audit.record(tx, actor, {
        action: "philhealth.yakap.registration.record",
        resourceType: "philhealth_yakap_registration",
        resourceId: row.id,
        patientId: input.patientId,
        metadata: { status: input.status, effectiveDate: input.effectiveDate ?? null, reference: input.reference ?? null },
      });
      return registrationView(row);
    });
  }

  // ---- encounter packages --------------------------------------------------------------------------

  /** The patient's consultations with their latest YAKAP submission, to choose one to prepare. */
  async consultations(actor: Actor, patientId: string) {
    if (!(await this.patients.patient(actor.organizationId, patientId))) throw new NotFoundError("Patient");
    const consultations = await this.sources.consultations(actor.organizationId, patientId);
    const exchanges = consultations.length
      ? await this.db
          .select()
          .from(integrationExchange)
          .where(
            and(
              eq(integrationExchange.organizationId, actor.organizationId),
              eq(integrationExchange.system, PHILHEALTH_YAKAP_SYSTEM),
              eq(integrationExchange.resourceType, ENCOUNTER),
              inArray(
                integrationExchange.resourceId,
                consultations.map((c) => c.encounterId),
              ),
            ),
          )
          .orderBy(desc(integrationExchange.requestedAt))
      : [];
    await this.audit.recordStandalone(actor, { action: "philhealth.yakap.consultation.list", resourceType: "patient", resourceId: patientId, patientId });
    return {
      integration: this.gateway.specification,
      consultations: consultations.map((c) => {
        const latest = exchanges.find((e) => e.resourceId === c.encounterId);
        return { ...c, latestSubmission: latest ? exchangeView(latest) : null };
      }),
    };
  }

  /** The package as it would be prepared now: readiness checks, the package (PIN masked), the registration answer, earlier submissions. */
  async preview(actor: Actor, encounterId: string) {
    const { src, participation, registration } = await this.load(actor.organizationId, encounterId);
    const checks = yakapReadiness(src, participation, registration);
    const ready = isYakapReady(checks);
    const pkg = ready ? buildYakapPackage(src, participation, registration) : null;
    await this.audit.recordStandalone(actor, {
      action: "philhealth.yakap.package.view",
      resourceType: ENCOUNTER,
      resourceId: encounterId,
      patientId: src.encounter.patientId,
      metadata: { ready },
    });
    return {
      integration: this.gateway.specification,
      encounterId,
      patientId: src.encounter.patientId,
      consultation: {
        date: src.encounter.date,
        modality: src.encounter.modality,
        status: src.encounter.status,
        facilityId: src.encounter.facilityId,
        facilityName: src.encounter.facilityName,
        visitTypeName: src.encounter.visitTypeName,
        clinicianName: src.encounter.clinician?.name ?? null,
      },
      registration: registration ? { ...registration } : null,
      ready,
      checks,
      package: pkg ? { ...pkg, patient: { ...pkg.patient, philhealthPin: maskPin(pkg.patient.philhealthPin) } } : null,
      submissions: await this.submissions(actor.organizationId, encounterId),
    };
  }

  /**
   * Queues the package for the integration worker (sealed for it). Refused while the YAKAP specification is an
   * integration dependency, while the platform's data is incomplete, and while an earlier submission of the same
   * consultation is pending or was accepted. The same idempotency key returns the same exchange.
   */
  async requestSubmission(actor: Actor, encounterId: string, idempotencyKey: string) {
    if (this.gateway.specification.status === "dependency") {
      throw new BusinessRuleError(
        "PhilHealth YAKAP is not connected: the official specification is an integration dependency. Use PhilHealth's own channel for this consultation.",
        "integration_not_configured",
      );
    }
    const existing = await this.findByKey(actor.organizationId, idempotencyKey);
    if (existing) {
      if (existing.resourceId !== encounterId)
        throw new ConflictError("This idempotency key was used for another consultation", undefined, "idempotency_key_reused");
      return exchangeView(existing);
    }
    const { src, participation, registration } = await this.load(actor.organizationId, encounterId);
    const checks = yakapReadiness(src, participation, registration);
    if (!isYakapReady(checks)) {
      throw new BusinessRuleError(
        "The YAKAP encounter package cannot be prepared yet",
        "yakap_package_not_ready",
        checks.filter((c) => !c.ok),
      );
    }
    const pkg = buildYakapPackage(src, participation, registration);
    const created = await this.db.transaction(async (tx) => {
      // One package in flight or accepted per consultation; serialise concurrent requests.
      const open = await tx
        .select({ id: integrationExchange.id, status: integrationExchange.status })
        .from(integrationExchange)
        .where(
          and(
            eq(integrationExchange.organizationId, actor.organizationId),
            eq(integrationExchange.system, PHILHEALTH_YAKAP_SYSTEM),
            eq(integrationExchange.resourceType, ENCOUNTER),
            eq(integrationExchange.resourceId, encounterId),
            inArray(integrationExchange.status, ["queued", "accepted"]),
          ),
        )
        .for("update");
      if (open.length > 0) {
        throw new ConflictError(
          open.some((o) => o.status === "accepted")
            ? "PhilHealth already acknowledged this consultation's package"
            : "A submission for this consultation is in progress",
          undefined,
          "yakap_already_submitted",
        );
      }
      const row = await this.exchanges.request(tx, actor, {
        system: PHILHEALTH_YAKAP_SYSTEM,
        operation: SUBMIT_YAKAP_ENCOUNTER,
        idempotencyKey,
        patientId: src.encounter.patientId,
        resourceType: ENCOUNTER,
        resourceId: encounterId,
        facilityId: src.encounter.facilityId,
        payload: pkg,
      });
      await this.audit.record(tx, actor, {
        action: "philhealth.yakap.submit-request",
        resourceType: ENCOUNTER,
        resourceId: encounterId,
        patientId: src.encounter.patientId,
        metadata: { exchangeId: row.id },
      });
      return row;
    });
    return exchangeView(created);
  }

  async submissions(organizationId: string, encounterId: string) {
    const rows = await this.db
      .select()
      .from(integrationExchange)
      .where(
        and(
          eq(integrationExchange.organizationId, organizationId),
          eq(integrationExchange.system, PHILHEALTH_YAKAP_SYSTEM),
          eq(integrationExchange.resourceType, ENCOUNTER),
          eq(integrationExchange.resourceId, encounterId),
        ),
      )
      .orderBy(desc(integrationExchange.requestedAt));
    return rows.map(exchangeView);
  }

  // ---- internals -----------------------------------------------------------------------------------

  private async load(organizationId: string, encounterId: string) {
    const src: YakapEncounterSource | undefined = await this.sources.encounter(organizationId, encounterId);
    if (!src || src.encounter.status === "entered_in_error") throw new NotFoundError("Encounter");
    const [participation, registration] = await Promise.all([
      this.participation(organizationId, src.encounter.facilityId),
      this.latestRegistration(organizationId, src.encounter.patientId, src.encounter.facilityId),
    ]);
    return { src, participation, registration };
  }

  /** PhilHealth's latest recorded answer about the patient's registration at a facility. */
  private async latestRegistration(organizationId: string, patientId: string, facilityId: string): Promise<YakapRegistrationSource | null> {
    const [row] = await this.db
      .select()
      .from(philhealthYakapRegistration)
      .where(
        and(
          eq(philhealthYakapRegistration.organizationId, organizationId),
          eq(philhealthYakapRegistration.patientId, patientId),
          eq(philhealthYakapRegistration.facilityId, facilityId),
        ),
      )
      .orderBy(desc(philhealthYakapRegistration.recordedAt))
      .limit(1);
    return row
      ? { status: row.status, effectiveDate: row.effectiveDate, externalReference: row.externalReference, recordedAt: row.recordedAt.toISOString() }
      : null;
  }

  private findByKey(organizationId: string, idempotencyKey: string) {
    return this.db
      .select()
      .from(integrationExchange)
      .where(
        and(
          eq(integrationExchange.organizationId, organizationId),
          eq(integrationExchange.system, PHILHEALTH_YAKAP_SYSTEM),
          eq(integrationExchange.idempotencyKey, idempotencyKey),
        ),
      )
      .then((rows) => rows[0]);
  }
}

export function participationView({ organizationId: _o, ...row }: YakapParticipationRecord) {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

function registrationView({ organizationId: _o, ...row }: YakapRegistrationRecord) {
  return { ...row, recordedAt: row.recordedAt.toISOString() };
}

function exchangeView(row: IntegrationExchangeRecord) {
  return {
    id: row.id,
    status: row.status,
    attempts: row.attempts,
    externalReference: row.externalReference,
    outcomeDetail: row.outcomeDetail,
    lastError: row.lastError,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
