import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  normalizeName,
  NotFoundError,
  PgErrorCode,
  filedAsPatient,
} from "@healthcare/core";
import { and, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { createAllergySchema, recordVitalsSchema, triageSchema, updateAllergyStatusSchema, VitalsInput } from "../clinic.dto";
import { allergyIntolerance, allergyReview, triageAssessment, vitalSignSet, type VitalSignSetRecord } from "../clinic.schema";
import { assertVersion, found, publicView } from "../clinic-support";
import { ACTIVE_VISIT_STATUSES } from "../domain/queue-state";
import { bodyMassIndex, implausibleVitals } from "../domain/vital-signs";
import { toVisitView, VisitService } from "../queue/visit.service";

export type VitalsView = Omit<VitalSignSetRecord, "organizationId"> & { bmi: number | null };

export function toVitalsView(row: VitalSignSetRecord): VitalsView {
  return { ...publicView(row), bmi: bodyMassIndex(row.weightKg, row.heightCm) };
}

@Injectable()
export class TriageService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly visits: VisitService,
  ) {}

  /** Records triage (and optional vitals) and advances the queue entry. */
  async triage(actor: Actor, visitId: string, input: z.infer<typeof triageSchema>) {
    if (input.vitals) assertPlausible(input.vitals);
    return this.db.transaction(async (tx) => {
      let current = await this.visits.lock(tx, actor.organizationId, visitId);
      if (actor.facilityId && current.facilityId !== actor.facilityId) throw new NotFoundError("Visit");
      if (!ACTIVE_VISIT_STATUSES.includes(current.status) || current.status === "in_consultation") {
        throw new BusinessRuleError(`Triage is not possible while the visit is ${current.status.replace(/_/g, " ")}`, "invalid_queue_transition");
      }
      const [assessment] = await tx
        .insert(triageAssessment)
        .values({
          organizationId: actor.organizationId,
          visitId,
          patientId: current.patientId,
          chiefComplaint: input.chiefComplaint,
          painScore: input.painScore ?? null,
          priority: input.priority,
          riskFlags: input.riskFlags,
          notes: input.notes ?? null,
          assessedBy: actor.userId,
        })
        .returning();
      const vitals = input.vitals
        ? await this.insertVitals(tx, actor, current.patientId, { visitId, facilityId: current.facilityId }, input.vitals)
        : undefined;

      const details = { priority: input.priority, chiefComplaint: input.chiefComplaint };
      if (current.status !== "in_triage") {
        current = await this.visits.setStatus(tx, current, "in_triage", { ...details, triageStartedAt: current.triageStartedAt ?? new Date() });
      }
      current = await this.visits.setStatus(tx, current, input.completeTriage ? "awaiting_consultation" : "in_triage", details);

      const triage = found(assessment, "Triage assessment");
      await this.audit.record(tx, actor, {
        action: "triage.record",
        resourceType: "triage_assessment",
        resourceId: triage.id,
        patientId: current.patientId,
        metadata: { visitId, priority: input.priority, riskFlags: input.riskFlags, vitalsId: vitals?.id },
      });
      await this.events.record(tx, {
        type: "TriageCompleted",
        organizationId: actor.organizationId,
        aggregateType: "visit",
        aggregateId: visitId,
        facilityId: current.facilityId,
        patientId: current.patientId,
        payload: { triageId: triage.id, priority: input.priority },
      });
      return { triage: publicView(triage), vitals: vitals ? toVitalsView(vitals) : null, visit: toVisitView(current) };
    });
  }

  async recordVitals(actor: Actor, input: z.infer<typeof recordVitalsSchema>): Promise<VitalsView> {
    assertPlausible(input.vitals);
    try {
      return await this.db.transaction(async (tx) => {
        const row = await this.insertVitals(
          tx,
          actor,
          input.patientId,
          { visitId: input.visitId, encounterId: input.encounterId, facilityId: actor.facilityId },
          input.vitals,
        );
        await this.audit.record(tx, actor, { action: "vitals.record", resourceType: "vital_sign_set", resourceId: row.id, patientId: row.patientId });
        return toVitalsView(row);
      });
    } catch (error) {
      // Composite (patient_id, visit_id/encounter_id) keys reject records of another patient.
      if (asPgError(error)?.code === PgErrorCode.foreignKeyViolation) throw new NotFoundError("Patient, visit or encounter");
      throw error;
    }
  }

  async vitalsHistory(actor: Actor, patientId: string, limit = 50): Promise<VitalsView[]> {
    const rows = await this.db
      .select()
      .from(vitalSignSet)
      .where(and(eq(vitalSignSet.organizationId, actor.organizationId), filedAsPatient(vitalSignSet.patientId, patientId), eq(vitalSignSet.status, "final")))
      .orderBy(desc(vitalSignSet.measuredAt))
      .limit(limit);
    await this.audit.recordStandalone(actor, { action: "vitals.view", resourceType: "vital_sign_set", patientId });
    return rows.map(toVitalsView);
  }

  /** Corrections never delete: the entry is marked entered-in-error with a reason. */
  async markVitalsInError(actor: Actor, vitalsId: string, reason: string): Promise<VitalsView> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(vitalSignSet)
        .set({ status: "entered_in_error", enteredInErrorReason: reason, enteredInErrorBy: actor.userId })
        .where(and(eq(vitalSignSet.organizationId, actor.organizationId), eq(vitalSignSet.id, vitalsId), eq(vitalSignSet.status, "final")))
        .returning();
      if (!updated) throw new NotFoundError("Vital signs");
      await this.audit.record(tx, actor, {
        action: "vitals.entered-in-error",
        resourceType: "vital_sign_set",
        resourceId: vitalsId,
        patientId: updated.patientId,
        reason,
      });
      return toVitalsView(updated);
    });
  }

  // ---- allergies ----------------------------------------------------------------

  async allergies(actor: Actor, patientId: string) {
    const summary = await this.allergySummary(actor.organizationId, patientId);
    await this.audit.recordStandalone(actor, { action: "allergy.view", resourceType: "allergy_intolerance", patientId });
    return summary;
  }

  /**
   * Active allergies plus the latest "reviewed" assertion, for triage, consultation and prescribing.
   * "No known allergies" holds only if it was asserted after the last change to the patient's
   * allergy list: once an allergy was recorded (even if later resolved or entered in error), an
   * older assertion no longer describes the patient and the history must be taken again.
   */
  async allergySummary(organizationId: string, patientId: string) {
    const ofPatient = and(eq(allergyIntolerance.organizationId, organizationId), filedAsPatient(allergyIntolerance.patientId, patientId));
    const [active, [review], [lastChange]] = await Promise.all([
      this.db
        .select()
        .from(allergyIntolerance)
        .where(and(ofPatient, eq(allergyIntolerance.status, "active")))
        .orderBy(desc(allergyIntolerance.recordedAt)),
      this.db
        .select()
        .from(allergyReview)
        .where(and(eq(allergyReview.organizationId, organizationId), filedAsPatient(allergyReview.patientId, patientId)))
        .orderBy(desc(allergyReview.reviewedAt))
        .limit(1),
      this.db
        .select({ at: sql<Date | null>`max(${allergyIntolerance.updatedAt})` })
        .from(allergyIntolerance)
        .where(ofPatient),
    ]);
    const changedAt = lastChange?.at ? new Date(lastChange.at) : null;
    const noneStillAsserted = Boolean(review?.noKnownAllergies) && (!changedAt || (review?.reviewedAt ?? new Date(0)) >= changedAt);
    return {
      allergies: active.map(publicView),
      // "Unknown" (never asked) is clinically different from "no known allergies".
      status: active.length > 0 ? "has_allergies" : noneStillAsserted ? "no_known_allergies" : "not_reviewed",
      lastReviewedAt: review?.reviewedAt ?? null,
    } as const;
  }

  async addAllergy(actor: Actor, patientId: string, input: z.infer<typeof createAllergySchema>) {
    try {
      return await this.db.transaction((tx) => this.addAllergyIn(tx, actor, patientId, input));
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.foreignKeyViolation) throw new NotFoundError("Patient");
      throw error;
    }
  }

  /**
   * Records an allergy in the caller's transaction: a staff entry, or (with `origin`) one accepted from an external
   * import, which is kept unconfirmed and carries its source reference. Never replaces an active allergy of the same
   * substance.
   */
  async addAllergyIn(tx: DbExecutor, actor: Actor, patientId: string, input: z.infer<typeof createAllergySchema>, origin?: { reference: string }) {
    const substanceNormalized = normalizeName(input.substance);
    const [duplicate] = await tx
      .select({ id: allergyIntolerance.id })
      .from(allergyIntolerance)
      .where(
        and(
          eq(allergyIntolerance.organizationId, actor.organizationId),
          filedAsPatient(allergyIntolerance.patientId, patientId),
          eq(allergyIntolerance.substanceNormalized, substanceNormalized),
          eq(allergyIntolerance.status, "active"),
        ),
      );
    if (duplicate) throw new ConflictError("This allergy is already recorded", { allergyId: duplicate.id }, "allergy_exists");
    const [created] = await tx
      .insert(allergyIntolerance)
      .values({
        ...input,
        ...(origin ? { verification: "unconfirmed" as const, source: "external_import" as const, sourceReference: origin.reference } : {}),
        substanceNormalized,
        organizationId: actor.organizationId,
        patientId,
        recordedBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    const row = found(created, "Allergy");
    await this.audit.record(tx, actor, {
      action: "allergy.add",
      resourceType: "allergy_intolerance",
      resourceId: row.id,
      patientId,
      metadata: { category: row.category, criticality: row.criticality, source: row.source, ...(origin ? { sourceReference: origin.reference } : {}) },
    });
    return publicView(row);
  }

  async updateAllergyStatus(actor: Actor, patientId: string, allergyId: string, input: z.infer<typeof updateAllergyStatusSchema>) {
    if (input.status !== "active" && !input.reason) throw new BusinessRuleError("A reason is required", "reason_required");
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(allergyIntolerance)
        .where(
          and(
            eq(allergyIntolerance.organizationId, actor.organizationId),
            filedAsPatient(allergyIntolerance.patientId, patientId),
            eq(allergyIntolerance.id, allergyId),
          ),
        )
        .for("update");
      const current = found(before, "Allergy");
      assertVersion(current.version, input.version, "Allergy");
      const [updated] = await tx
        .update(allergyIntolerance)
        .set({
          status: input.status,
          statusReason: input.reason ?? null,
          updatedBy: actor.userId,
          updatedAt: new Date(),
          version: sql`${allergyIntolerance.version} + 1`,
        })
        .where(eq(allergyIntolerance.id, allergyId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "allergy.status",
        resourceType: "allergy_intolerance",
        resourceId: allergyId,
        patientId,
        reason: input.reason,
        changes: { status: { from: current.status, to: input.status } },
      });
      return publicView(found(updated, "Allergy"));
    });
  }

  async reviewAllergies(actor: Actor, patientId: string, noKnownAllergies: boolean) {
    await this.db.transaction(async (tx) => {
      if (noKnownAllergies) {
        const [active] = await tx
          .select({ id: allergyIntolerance.id })
          .from(allergyIntolerance)
          .where(and(filedAsPatient(allergyIntolerance.patientId, patientId), eq(allergyIntolerance.status, "active")))
          .limit(1);
        if (active) throw new BusinessRuleError('Resolve or correct the recorded allergies before recording "no known allergies"', "allergies_recorded");
      }
      try {
        await tx.insert(allergyReview).values({ organizationId: actor.organizationId, patientId, noKnownAllergies, reviewedBy: actor.userId });
      } catch (error) {
        if (asPgError(error)?.code === PgErrorCode.foreignKeyViolation) throw new NotFoundError("Patient");
        throw error;
      }
      await this.audit.record(tx, actor, { action: "allergy.review", resourceType: "allergy_review", patientId, metadata: { noKnownAllergies } });
    });
    return this.allergySummary(actor.organizationId, patientId);
  }

  private async insertVitals(
    tx: DbExecutor,
    actor: Actor,
    patientId: string,
    context: { visitId?: string; encounterId?: string; facilityId?: string },
    input: VitalsInput,
  ): Promise<VitalSignSetRecord> {
    const { measuredAt, notes, ...values } = input;
    const [row] = await tx
      .insert(vitalSignSet)
      .values({
        ...values,
        organizationId: actor.organizationId,
        patientId,
        visitId: context.visitId ?? null,
        encounterId: context.encounterId ?? null,
        facilityId: context.facilityId ?? null,
        measuredAt: measuredAt ? new Date(measuredAt) : new Date(),
        measuredBy: actor.userId,
        notes: notes ?? null,
      })
      .returning();
    return found(row, "Vital signs");
  }
}

function assertPlausible(vitals: VitalsInput): void {
  const problems = implausibleVitals(vitals);
  if (problems.length > 0) throw new BusinessRuleError("Some vital signs are not plausible; check the entries", "implausible_vital_signs", problems);
}
