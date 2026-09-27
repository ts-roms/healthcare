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
  ForbiddenError,
  NotFoundError,
  type Page,
  pageOffset,
  PgErrorCode,
  requireFacilityId,
  toPage,
} from "@healthcare/core";
import { and, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { addDiagnosisSchema, amendNoteSchema, saveNoteSchema, startEncounterSchema, updateDiagnosisStatusSchema } from "../clinic.dto";
import {
  appointment,
  codingSystem,
  diagnosis,
  type DiagnosisRecord,
  encounter,
  encounterNoteRevision,
  type EncounterRecord,
  type PractitionerRecord,
  triageAssessment,
  vitalSignSet,
} from "../clinic.schema";
import { found, publicView } from "../clinic-support";
import { ClinicConfigService } from "../config/clinic-config.service";
import { VisitService } from "../queue/visit.service";
import { toVitalsView } from "../triage/triage.service";

/** Professions that can be the responsible practitioner of an encounter. */
const ENCOUNTER_PROFESSIONS = new Set(["physician", "dentist", "midwife"]);

export type EncounterView = Omit<EncounterRecord, "organizationId">;

function encounterEvent(type: string, row: EncounterRecord, payload: Record<string, unknown> = {}) {
  return {
    type,
    organizationId: row.organizationId,
    aggregateType: "encounter",
    aggregateId: row.id,
    facilityId: row.facilityId,
    patientId: row.patientId,
    payload: { practitionerId: row.practitionerId, modality: row.modality, ...payload },
  };
}

/**
 * Consultations. Notes are append-only revisions: drafts while in progress,
 * a signed revision at completion, amendments (with reason) afterwards.
 */
@Injectable()
export class EncounterService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly config: ClinicConfigService,
    private readonly visits: VisitService,
  ) {}

  async start(actor: Actor, input: z.infer<typeof startEncounterSchema>): Promise<EncounterView> {
    const clinician = await this.requireClinician(actor);
    try {
      return await this.db.transaction(async (tx) => {
        let values: Pick<typeof encounter.$inferInsert, "facilityId" | "patientId" | "visitId" | "appointmentId" | "chiefComplaint">;
        let visitRow;
        if (input.visitId) {
          visitRow = await this.visits.lock(tx, actor.organizationId, input.visitId);
          if (actor.facilityId && visitRow.facilityId !== actor.facilityId) throw new NotFoundError("Visit");
          values = {
            facilityId: visitRow.facilityId,
            patientId: visitRow.patientId,
            visitId: visitRow.id,
            appointmentId: visitRow.appointmentId,
            chiefComplaint: input.chiefComplaint ?? visitRow.chiefComplaint,
          };
        } else {
          values = {
            facilityId: requireFacilityId(actor),
            patientId: input.patientId!,
            visitId: null,
            appointmentId: null,
            chiefComplaint: input.chiefComplaint ?? null,
          };
        }
        const [created] = await tx
          .insert(encounter)
          .values({ ...values, organizationId: actor.organizationId, practitionerId: clinician.id, modality: input.modality, startedBy: actor.userId })
          .returning();
        const row = found(created, "Encounter");
        if (visitRow) {
          await this.visits.setStatus(tx, visitRow, "in_consultation", {
            consultationStartedAt: visitRow.consultationStartedAt ?? new Date(),
            assignedPractitionerId: clinician.id,
          });
        }
        await this.audit.record(tx, actor, {
          action: "encounter.start",
          resourceType: "encounter",
          resourceId: row.id,
          patientId: row.patientId,
          metadata: { visitId: row.visitId },
        });
        await this.events.record(tx, encounterEvent("EncounterStarted", row, { visitId: row.visitId }));
        return publicView(row);
      });
    } catch (error) {
      const pg = asPgError(error);
      if (pg?.constraint === "encounter_visit_uq") throw new ConflictError("This visit already has an encounter", undefined, "encounter_exists");
      if (pg?.code === PgErrorCode.foreignKeyViolation) throw new NotFoundError("Patient");
      throw error;
    }
  }

  /** The encounter with its current note, diagnoses, vital signs and triage. Viewing is audited. */
  async get(actor: Actor, encounterId: string) {
    const row = await this.find(this.db, actor.organizationId, encounterId);
    const [revisions, diagnoses, vitals, triage] = await Promise.all([
      this.db
        .select()
        .from(encounterNoteRevision)
        .where(eq(encounterNoteRevision.encounterId, encounterId))
        .orderBy(desc(encounterNoteRevision.revisionNumber)),
      this.db.select().from(diagnosis).where(eq(diagnosis.encounterId, encounterId)).orderBy(diagnosis.recordedAt),
      this.db
        .select()
        .from(vitalSignSet)
        .where(
          and(
            eq(vitalSignSet.patientId, row.patientId),
            eq(vitalSignSet.status, "final"),
            sql`(${vitalSignSet.encounterId} = ${encounterId} OR (${vitalSignSet.visitId} IS NOT NULL AND ${vitalSignSet.visitId} = ${row.visitId}))`,
          ),
        )
        .orderBy(desc(vitalSignSet.measuredAt)),
      row.visitId
        ? this.db
            .select()
            .from(triageAssessment)
            .where(and(eq(triageAssessment.visitId, row.visitId), eq(triageAssessment.status, "final")))
            .orderBy(desc(triageAssessment.assessedAt))
        : Promise.resolve([]),
    ]);
    await this.audit.recordStandalone(actor, { action: "encounter.view", resourceType: "encounter", resourceId: encounterId, patientId: row.patientId });
    const current = revisions[0];
    return {
      ...publicView(row),
      note: current ? publicView(current) : null,
      revisionCount: revisions.length,
      diagnoses: diagnoses.map(publicView),
      vitals: vitals.map(toVitalsView),
      triage: triage.map(publicView),
    };
  }

  async history(actor: Actor, encounterId: string) {
    const row = await this.find(this.db, actor.organizationId, encounterId);
    const revisions = await this.db
      .select()
      .from(encounterNoteRevision)
      .where(eq(encounterNoteRevision.encounterId, encounterId))
      .orderBy(encounterNoteRevision.revisionNumber);
    await this.audit.recordStandalone(actor, {
      action: "encounter.view-history",
      resourceType: "encounter",
      resourceId: encounterId,
      patientId: row.patientId,
    });
    return revisions.map(publicView);
  }

  async listForPatient(actor: Actor, patientId: string, query: { page: number; pageSize: number }): Promise<Page<EncounterView>> {
    const rows = await this.db
      .select()
      .from(encounter)
      .where(and(eq(encounter.organizationId, actor.organizationId), eq(encounter.patientId, patientId)))
      .orderBy(desc(encounter.startedAt))
      .limit(query.pageSize + 1)
      .offset(pageOffset(query));
    await this.audit.recordStandalone(actor, { action: "encounter.list", resourceType: "encounter", patientId });
    const page = toPage(rows, query);
    return { ...page, items: page.items.map(publicView) };
  }

  /** Saves a draft revision. `basedOnRevision` must be the latest, so concurrent edits are not lost. */
  async saveDraft(actor: Actor, encounterId: string, input: z.infer<typeof saveNoteSchema>) {
    return this.db.transaction(async (tx) => {
      const row = await this.lock(tx, actor.organizationId, encounterId);
      if (row.status !== "in_progress") throw new BusinessRuleError("The encounter is signed; add an amendment instead", "encounter_signed");
      const revision = await this.appendRevision(tx, actor, row, "draft", input);
      await this.audit.record(tx, actor, {
        action: "encounter.note-save",
        resourceType: "encounter",
        resourceId: encounterId,
        patientId: row.patientId,
        metadata: { revision: revision.revisionNumber },
      });
      return publicView(revision);
    });
  }

  /** Signs and completes the encounter; completes the visit and appointment too. Only the responsible practitioner may sign. */
  async sign(actor: Actor, encounterId: string, version: number): Promise<EncounterView> {
    const clinician = await this.requireClinician(actor);
    return this.db.transaction(async (tx) => {
      const row = await this.lock(tx, actor.organizationId, encounterId);
      if (row.version !== version) throw new ConflictError("The encounter changed; reload before signing", undefined, "version_conflict");
      if (row.status !== "in_progress") throw new BusinessRuleError("The encounter is not in progress", "encounter_not_in_progress");
      if (row.practitionerId !== clinician.id) throw new ForbiddenError("Only the responsible practitioner can sign this encounter");
      const [latest] = await tx
        .select()
        .from(encounterNoteRevision)
        .where(eq(encounterNoteRevision.encounterId, encounterId))
        .orderBy(desc(encounterNoteRevision.revisionNumber))
        .limit(1);
      if (!latest || !(latest.assessment?.trim() || latest.plan?.trim())) {
        throw new BusinessRuleError("Document at least an assessment or plan before signing", "note_incomplete");
      }
      await this.appendRevision(tx, actor, row, "signed", { ...latest, basedOnRevision: latest.revisionNumber });
      const [updated] = await tx
        .update(encounter)
        .set({
          status: "completed",
          completedAt: new Date(),
          signedByPractitionerId: clinician.id,
          updatedAt: new Date(),
          version: sql`${encounter.version} + 1`,
        })
        .where(eq(encounter.id, encounterId))
        .returning();
      const signed = found(updated, "Encounter");
      if (row.visitId) {
        const visitRow = await this.visits.lock(tx, actor.organizationId, row.visitId);
        if (visitRow.status === "in_consultation") await this.visits.setStatus(tx, visitRow, "completed", { completedAt: new Date() });
      }
      if (row.appointmentId) {
        await tx
          .update(appointment)
          .set({ status: "completed", completedAt: new Date(), updatedBy: actor.userId, updatedAt: new Date(), version: sql`${appointment.version} + 1` })
          .where(and(eq(appointment.id, row.appointmentId), eq(appointment.status, "checked_in")));
      }
      const diagnoses = await tx
        .select({ id: diagnosis.id })
        .from(diagnosis)
        .where(and(eq(diagnosis.encounterId, encounterId), eq(diagnosis.status, "active")));
      await this.audit.record(tx, actor, { action: "encounter.sign", resourceType: "encounter", resourceId: encounterId, patientId: row.patientId });
      await this.events.record(tx, encounterEvent("EncounterCompleted", signed, { diagnosisIds: diagnoses.map((d) => d.id), visitId: row.visitId }));
      return publicView(signed);
    });
  }

  /** Adds an amendment revision to a signed encounter; the signed text stays in history. */
  async amend(actor: Actor, encounterId: string, input: z.infer<typeof amendNoteSchema>) {
    return this.db.transaction(async (tx) => {
      const row = await this.lock(tx, actor.organizationId, encounterId);
      if (row.status !== "completed") throw new BusinessRuleError("Only signed encounters are amended; edit the draft instead", "encounter_not_signed");
      const revision = await this.appendRevision(tx, actor, row, "amendment", input, input.reason);
      await this.audit.record(tx, actor, {
        action: "encounter.amend",
        resourceType: "encounter",
        resourceId: encounterId,
        patientId: row.patientId,
        reason: input.reason,
        metadata: { revision: revision.revisionNumber },
      });
      await this.events.record(tx, encounterEvent("EncounterAmended", row, { revision: revision.revisionNumber }));
      return publicView(revision);
    });
  }

  /** For an encounter opened by mistake (wrong patient, duplicate). Returns the patient to the queue. */
  async markEnteredInError(actor: Actor, encounterId: string, reason: string): Promise<EncounterView> {
    return this.db.transaction(async (tx) => {
      const row = await this.lock(tx, actor.organizationId, encounterId);
      if (row.status !== "in_progress") throw new BusinessRuleError("Signed encounters are corrected by amendment", "encounter_signed");
      const [updated] = await tx
        .update(encounter)
        .set({ status: "entered_in_error", enteredInErrorReason: reason, updatedAt: new Date(), version: sql`${encounter.version} + 1` })
        .where(eq(encounter.id, encounterId))
        .returning();
      if (row.visitId) {
        const visitRow = await this.visits.lock(tx, actor.organizationId, row.visitId);
        if (visitRow.status === "in_consultation") await this.visits.setStatus(tx, visitRow, "awaiting_consultation");
      }
      await this.audit.record(tx, actor, {
        action: "encounter.entered-in-error",
        resourceType: "encounter",
        resourceId: encounterId,
        patientId: row.patientId,
        reason,
      });
      return publicView(found(updated, "Encounter"));
    });
  }

  async addDiagnosis(actor: Actor, encounterId: string, input: z.infer<typeof addDiagnosisSchema>) {
    try {
      return await this.db.transaction(async (tx) => {
        const row = await this.lock(tx, actor.organizationId, encounterId);
        this.assertDiagnosisEditable(actor, row, input.amendmentReason);
        let codeSystemVersion: string | null = null;
        if (input.codeSystemKey) {
          const [system] = await tx
            .select()
            .from(codingSystem)
            .where(and(eq(codingSystem.organizationId, actor.organizationId), eq(codingSystem.key, input.codeSystemKey), eq(codingSystem.status, "active")));
          if (!system) throw new BusinessRuleError(`Coding system "${input.codeSystemKey}" is not configured`, "unknown_coding_system");
          codeSystemVersion = system.version;
        }
        const [created] = await tx
          .insert(diagnosis)
          .values({
            organizationId: actor.organizationId,
            patientId: row.patientId,
            encounterId,
            codeSystemKey: input.codeSystemKey ?? null,
            codeSystemVersion,
            code: input.code?.toUpperCase() ?? null,
            display: input.display,
            rank: input.rank,
            certainty: input.certainty,
            isChronic: input.isChronic,
            notes: input.notes ?? null,
            recordedBy: actor.userId,
            updatedBy: actor.userId,
          })
          .returning();
        const dx = found(created, "Diagnosis");
        await this.audit.record(tx, actor, {
          action: row.status === "completed" ? "diagnosis.add-amendment" : "diagnosis.add",
          resourceType: "diagnosis",
          resourceId: dx.id,
          patientId: row.patientId,
          reason: input.amendmentReason,
          metadata: { encounterId, code: dx.code, codeSystem: dx.codeSystemKey, rank: dx.rank },
        });
        await this.events.record(tx, encounterEvent("DiagnosisRecorded", row, { diagnosisId: dx.id, code: dx.code, codeSystem: dx.codeSystemKey }));
        return publicView(dx);
      });
    } catch (error) {
      if (asPgError(error)?.constraint === "diagnosis_primary_uq")
        throw new ConflictError("The encounter already has a primary diagnosis", undefined, "primary_diagnosis_exists");
      throw error;
    }
  }

  async updateDiagnosisStatus(actor: Actor, encounterId: string, diagnosisId: string, input: z.infer<typeof updateDiagnosisStatusSchema>) {
    return this.db.transaction(async (tx) => {
      const row = await this.lock(tx, actor.organizationId, encounterId);
      if (input.status === "entered_in_error") this.assertDiagnosisEditable(actor, row, input.reason);
      const [before] = await tx
        .select()
        .from(diagnosis)
        .where(and(eq(diagnosis.encounterId, encounterId), eq(diagnosis.id, diagnosisId)))
        .for("update");
      const current: DiagnosisRecord = found(before, "Diagnosis");
      if (current.status === "entered_in_error") throw new BusinessRuleError("The diagnosis was entered in error", "diagnosis_closed");
      const [updated] = await tx
        .update(diagnosis)
        .set({
          status: input.status,
          certainty: input.certainty ?? current.certainty,
          statusReason: input.reason,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(diagnosis.id, diagnosisId))
        .returning();
      await this.audit.record(tx, actor, {
        action: `diagnosis.${input.status.replace(/_/g, "-")}`,
        resourceType: "diagnosis",
        resourceId: diagnosisId,
        patientId: row.patientId,
        reason: input.reason,
        changes: { status: { from: current.status, to: input.status } },
      });
      return publicView(found(updated, "Diagnosis"));
    });
  }

  // ---- internals ---------------------------------------------------------------

  async find(executor: DbExecutor, organizationId: string, encounterId: string): Promise<EncounterRecord> {
    const [row] = await executor
      .select()
      .from(encounter)
      .where(and(eq(encounter.organizationId, organizationId), eq(encounter.id, encounterId)));
    return found(row, "Encounter");
  }

  private async lock(executor: DbExecutor, organizationId: string, encounterId: string): Promise<EncounterRecord> {
    const [row] = await executor
      .select()
      .from(encounter)
      .where(and(eq(encounter.organizationId, organizationId), eq(encounter.id, encounterId)))
      .for("update");
    const current = found(row, "Encounter");
    if (current.status === "entered_in_error") throw new BusinessRuleError("The encounter was entered in error", "encounter_entered_in_error");
    return current;
  }

  private async requireClinician(actor: Actor): Promise<PractitionerRecord> {
    const clinician = await this.config.practitionerForUser(actor.organizationId, actor.userId);
    if (!clinician || !ENCOUNTER_PROFESSIONS.has(clinician.profession)) {
      throw new ForbiddenError("Your account is not linked to a practitioner who can conduct encounters");
    }
    return clinician;
  }

  private assertDiagnosisEditable(actor: Actor, row: EncounterRecord, amendmentReason: string | undefined): void {
    if (row.status !== "completed") return;
    if (!actor.permissions.has("encounter.amend")) throw new ForbiddenError("Changing a signed encounter requires permission to amend");
    if (!amendmentReason) throw new BusinessRuleError("The encounter is signed; give an amendment reason", "amendment_reason_required");
  }

  private async appendRevision(
    tx: DbExecutor,
    actor: Actor,
    row: EncounterRecord,
    kind: "draft" | "signed" | "amendment",
    input: {
      basedOnRevision: number;
      templateKey: string;
      subjective?: string | null;
      objective?: string | null;
      assessment?: string | null;
      plan?: string | null;
      sections: Record<string, unknown>;
    },
    amendmentReason?: string,
  ) {
    const [latest] = await tx
      .select({ revisionNumber: encounterNoteRevision.revisionNumber })
      .from(encounterNoteRevision)
      .where(eq(encounterNoteRevision.encounterId, row.id))
      .orderBy(desc(encounterNoteRevision.revisionNumber))
      .limit(1);
    const current = latest?.revisionNumber ?? 0;
    if (input.basedOnRevision !== current) {
      throw new ConflictError("The note was changed by someone else; reload to see the latest revision", { latestRevision: current }, "note_revision_conflict");
    }
    const [created] = await tx
      .insert(encounterNoteRevision)
      .values({
        organizationId: row.organizationId,
        encounterId: row.id,
        revisionNumber: current + 1,
        kind,
        templateKey: input.templateKey,
        subjective: input.subjective ?? null,
        objective: input.objective ?? null,
        assessment: input.assessment ?? null,
        plan: input.plan ?? null,
        sections: input.sections,
        amendmentReason: amendmentReason ?? null,
        authoredBy: actor.userId,
      })
      .returning();
    await tx
      .update(encounter)
      .set({ updatedAt: new Date(), version: sql`${encounter.version} + 1` })
      .where(eq(encounter.id, row.id));
    return found(created, "Note revision");
  }
}
