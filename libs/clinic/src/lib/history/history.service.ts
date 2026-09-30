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
  filedAsPatient,
  ForbiddenError,
  localDate,
  NotFoundError,
  PgErrorCode,
  PH_TIMEZONE,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { encounter } from "../clinic.schema";
import { found } from "../clinic-support";
import { ClinicConfigService } from "../config/clinic-config.service";
import { PATIENT_DIRECTORY, type PatientDirectory } from "../ports";
import type {
  familyReviewSchema,
  recordFamilyHistorySchema,
  recordPastConditionSchema,
  recordPastProcedureSchema,
  recordReportedMedicationSchema,
  recordSocialHistorySchema,
  stopReportedMedicationSchema,
} from "./history.dto";
import {
  alcoholText,
  changedSocialFields,
  familyHistoryState,
  type FamilyHistoryState,
  isPartialDateText,
  medicationState,
  nextSocialVersion,
  type PartialDate,
  partialDateInFuture,
  partialDateText,
  parsePartialDate,
  relativeText,
  reviewConflict,
  SENSITIVE_HISTORY_PERMISSION,
  SENSITIVE_SOCIAL_FIELDS,
  SOCIAL_FIELDS,
  type SocialFields,
  socialHasContent,
  stopBeforeStart,
  tobaccoText,
} from "./history.rules";
import {
  FAMILY_RELATIONSHIPS,
  familyHistoryEntry,
  type FamilyHistoryRecord,
  familyHistoryReview,
  type FamilyReviewRecord,
  type HistoryDatePrecision,
  type HistorySection,
  pastCondition,
  type PastConditionRecord,
  pastProcedure,
  type PastProcedureRecord,
  reportedMedication,
  type ReportedMedicationRecord,
  socialHistory,
  type SocialHistoryRecord,
} from "./history.schema";
import { HISTORY_STAFF_NAMES, type HistoryStaffNames } from "./ports";

interface EntryMeta {
  id: string;
  /** The record it is filed under (the patient, or a record merged into it). */
  patientId: string;
  encounterId: string | null;
  recordedAt: string;
  recordedByName: string | null;
  enteredInError: { at: string; reason: string; byName: string | null } | null;
}

export interface PastProcedureView extends EntryMeta {
  description: string;
  codeSystem: string | null;
  code: string | null;
  /** "2019", "2019-05", "2019-05-12", or null when not known. */
  performed: string | null;
  performedPrecision: HistoryDatePrecision | null;
  performer: string | null;
  bodySite: string | null;
  notes: string | null;
  source: PastProcedureRecord["source"];
  reportedBy: PastProcedureRecord["reportedBy"];
  sourceDescription: string | null;
  sourceReference: string | null;
  declaredSource: string | null;
}

export interface PastConditionView extends EntryMeta {
  description: string;
  codeSystem: string | null;
  code: string | null;
  onset: string | null;
  onsetPrecision: HistoryDatePrecision | null;
  status: PastConditionRecord["reportedStatus"];
  diagnosedBy: string | null;
  notes: string | null;
  source: PastConditionRecord["source"];
  reportedBy: PastConditionRecord["reportedBy"];
  sourceDescription: string | null;
}

export interface ReportedMedicationView extends EntryMeta {
  medication: string;
  codeSystem: string | null;
  code: string | null;
  dose: string | null;
  reason: string | null;
  prescribedBy: string | null;
  started: string | null;
  startedPrecision: HistoryDatePrecision | null;
  /** As reported when recorded. */
  reportedStatus: ReportedMedicationRecord["reportedStatus"];
  /** As it stands: stopped once marked stopped, otherwise as reported. */
  status: ReportedMedicationRecord["reportedStatus"];
  stopped: string | null;
  stoppedPrecision: HistoryDatePrecision | null;
  /** Marked stopped after it was recorded. */
  stopRecorded: { at: string; byName: string | null; note: string | null } | null;
  notes: string | null;
  source: ReportedMedicationRecord["source"];
  reportedBy: ReportedMedicationRecord["reportedBy"];
  sourceDescription: string | null;
}

export interface FamilyHistoryView extends EntryMeta {
  relationship: FamilyHistoryRecord["relationship"];
  relationshipText: string | null;
  /** The relative as shown ("Mother", "Sister (older)", or the free text for "other"). */
  relative: string;
  condition: string;
  codeSystem: string | null;
  code: string | null;
  onsetAge: number | null;
  deceased: boolean | null;
  causeOfDeath: string | null;
  notes: string | null;
  source: FamilyHistoryRecord["source"];
  reportedBy: FamilyHistoryRecord["reportedBy"];
  sourceReference: string | null;
  declaredSource: string | null;
}

export interface FamilyReviewView {
  id: string;
  patientId: string;
  encounterId: string | null;
  outcome: FamilyReviewRecord["outcome"];
  unknownReason: FamilyReviewRecord["unknownReason"];
  notes: string | null;
  reviewedAt: string;
  reviewedByName: string | null;
}

export interface SocialHistoryView extends EntryMeta, SocialFields {
  supersedesId: string | null;
  effectiveDate: string;
  /** Substance use and sexual history are left out (null) for this viewer: whether anything is recorded is not said. */
  sensitiveWithheld: boolean;
  /** The current version (the latest recorded that is not in error). */
  current: boolean;
}

export interface PatientHistoryView {
  patientId: string;
  /** Whether the viewer sees substance use and sexual history (history.read and encounter.write). */
  sensitiveAccess: boolean;
  procedures: PastProcedureView[];
  conditions: PastConditionView[];
  /** Medicines taken that were not prescribed here (never prescriptions of the organization). */
  medications: ReportedMedicationView[];
  family: {
    state: FamilyHistoryState;
    latestReview: FamilyReviewView | null;
    reviews: FamilyReviewView[];
    entries: FamilyHistoryView[];
  };
  social: { current: SocialHistoryView | null; versions: SocialHistoryView[] };
}

/** A procedure accepted from a FHIR import, as the interoperability layer maps it (validated again here). */
export const importedPastProcedureSchema = z.object({
  description: z.string().trim().min(1).max(300),
  codeSystem: z.string().min(1).max(200).nullable(),
  code: z.string().trim().min(1).max(60).nullable(),
  /** YYYY, YYYY-MM or YYYY-MM-DD (the sender's date), or null. */
  performed: z.string().refine(isPartialDateText, "No date the platform can record").nullable(),
  performer: z.string().trim().min(1).max(300).nullable(),
  bodySite: z.string().trim().min(1).max(120).nullable(),
  /** What the sender said that has no field here (a date as text, its status), kept as a note. */
  notes: z.string().trim().min(1).max(2000).nullable(),
  sourceDescription: z.string().trim().min(1).max(300).nullable(),
});
export type ImportedPastProcedureInput = z.input<typeof importedPastProcedureSchema>;

/** A family member's condition accepted from a FHIR import. */
export const importedFamilyHistorySchema = z.object({
  relationship: z.enum(FAMILY_RELATIONSHIPS),
  relationshipText: z.string().trim().min(1).max(100).nullable(),
  condition: z.string().trim().min(1).max(300),
  codeSystem: z.string().min(1).max(200).nullable(),
  code: z.string().trim().min(1).max(60).nullable(),
  onsetAge: z.number().int().min(0).max(130).nullable(),
  deceased: z.boolean().nullable(),
  causeOfDeath: z.string().trim().min(1).max(300).nullable(),
  notes: z.string().trim().min(1).max(2000).nullable(),
});
export type ImportedFamilyHistoryInput = z.input<typeof importedFamilyHistorySchema>;

/** Every history row of a patient (records merged into it included), for a record export. */
export interface PatientHistoryRecord {
  procedures: PastProcedureRecord[];
  conditions: PastConditionRecord[];
  medications: ReportedMedicationRecord[];
  family: FamilyHistoryRecord[];
  familyReviews: FamilyReviewRecord[];
  social: SocialHistoryRecord[];
}

const iso = (d: Date) => d.toISOString();
const MAX_ROWS = 500;

function validated<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new BusinessRuleError(
      "The imported entry cannot be recorded as it is",
      "invalid_import_entry",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return parsed.data;
}

function socialFields(r: SocialHistoryRecord): SocialFields {
  return Object.fromEntries(SOCIAL_FIELDS.map((k) => [k, r[k]])) as unknown as SocialFields;
}

/** Whether the actor sees the sensitive parts of the social history. */
export function canReadSensitiveHistory(permissions: ReadonlySet<string>): boolean {
  return permissions.has("history.read") && permissions.has(SENSITIVE_HISTORY_PERMISSION);
}

/**
 * Patient history (docs/domains/patient-history.md): past procedures and past conditions as reported or documented
 * here, family history with its review, and social history as versions. Nothing is a diagnosis or a procedure of the
 * organization, nothing is scored or inferred. Rows are immutable except being marked entered in error (database
 * trigger); every record and read is audited; events carry ids and the section only.
 */
@Injectable()
export class PatientHistoryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly config: ClinicConfigService,
    private readonly organizations: OrganizationService,
    @Inject(HISTORY_STAFF_NAMES) private readonly staff: HistoryStaffNames,
    @Inject(PATIENT_DIRECTORY) private readonly patients: PatientDirectory,
  ) {}

  // ---- reading ----------------------------------------------------------------------------------------------------

  /** Every section (records merged into the patient included); entries in error listed, marked. One audited read. */
  async history(actor: Actor, patientId: string): Promise<PatientHistoryView> {
    await this.requirePatient(actor.organizationId, patientId);
    const record = await this.patientRecord(actor.organizationId, patientId);
    const sensitiveAccess = canReadSensitiveHistory(actor.permissions);
    const view = await this.compose(actor.organizationId, patientId, record, sensitiveAccess);
    await this.audit.recordStandalone(actor, {
      action: "history.view",
      resourceType: "patient_history",
      patientId,
      metadata: {
        sensitiveShown: sensitiveAccess,
        counts: {
          procedures: record.procedures.length,
          conditions: record.conditions.length,
          medications: record.medications.length,
          family: record.family.length,
          familyReviews: record.familyReviews.length,
          social: record.social.length,
        },
      },
    });
    return view;
  }

  /** Every row of the patient (entries in error included), for record exports. Not audited here: the caller audits. */
  async patientRecord(organizationId: string, patientId: string): Promise<PatientHistoryRecord> {
    const [procedures, conditions, medications, family, familyReviews, social] = await Promise.all([
      this.db
        .select()
        .from(pastProcedure)
        .where(and(eq(pastProcedure.organizationId, organizationId), filedAsPatient(pastProcedure.patientId, patientId)))
        .orderBy(sql`${pastProcedure.performedDate} DESC NULLS LAST`, desc(pastProcedure.recordedAt))
        .limit(MAX_ROWS),
      this.db
        .select()
        .from(pastCondition)
        .where(and(eq(pastCondition.organizationId, organizationId), filedAsPatient(pastCondition.patientId, patientId)))
        .orderBy(sql`${pastCondition.onsetDate} DESC NULLS LAST`, desc(pastCondition.recordedAt))
        .limit(MAX_ROWS),
      this.db
        .select()
        .from(reportedMedication)
        .where(and(eq(reportedMedication.organizationId, organizationId), filedAsPatient(reportedMedication.patientId, patientId)))
        .orderBy(desc(reportedMedication.recordedAt))
        .limit(MAX_ROWS),
      this.db
        .select()
        .from(familyHistoryEntry)
        .where(and(eq(familyHistoryEntry.organizationId, organizationId), filedAsPatient(familyHistoryEntry.patientId, patientId)))
        .orderBy(asc(familyHistoryEntry.relationship), desc(familyHistoryEntry.recordedAt))
        .limit(MAX_ROWS),
      this.db
        .select()
        .from(familyHistoryReview)
        .where(and(eq(familyHistoryReview.organizationId, organizationId), filedAsPatient(familyHistoryReview.patientId, patientId)))
        .orderBy(desc(familyHistoryReview.reviewedAt))
        .limit(MAX_ROWS),
      this.db
        .select()
        .from(socialHistory)
        .where(and(eq(socialHistory.organizationId, organizationId), filedAsPatient(socialHistory.patientId, patientId)))
        .orderBy(desc(socialHistory.recordedAt))
        .limit(MAX_ROWS),
    ]);
    return { procedures, conditions, medications, family, familyReviews, social };
  }

  /**
   * What the patient sees in MyHealth: entries not in error, the family history state and the current social history,
   * without staff notes or who recorded them. Substance use and sexual history only when `sensitive` (the patient
   * themself, not someone acting for them). Not audited here.
   */
  async patientView(organizationId: string, patientId: string, options: { sensitive: boolean }) {
    const record = await this.patientRecord(organizationId, patientId);
    const procedures = record.procedures.filter((r) => !r.enteredInErrorAt);
    const conditions = record.conditions.filter((r) => !r.enteredInErrorAt);
    const medications = record.medications.filter((r) => !r.enteredInErrorAt);
    const family = record.family.filter((r) => !r.enteredInErrorAt);
    const latestReview = record.familyReviews[0] ?? null;
    const current = record.social.find((r) => !r.enteredInErrorAt) ?? null;
    return {
      procedures: procedures.map((r) => ({
        id: r.id,
        description: r.description,
        performed: partialDateText(r.performedDate, r.performedPrecision),
        performer: r.performer,
        bodySite: r.bodySite,
        source: r.source,
      })),
      conditions: conditions.map((r) => ({
        id: r.id,
        description: r.description,
        onset: partialDateText(r.onsetDate, r.onsetPrecision),
        status: r.reportedStatus,
        source: r.source,
      })),
      medications: medications.map((r) => ({
        id: r.id,
        medication: r.medication,
        dose: r.doseText,
        reason: r.reason,
        started: partialDateText(r.startedDate, r.startedPrecision),
        status: medicationState(r),
        stopped: partialDateText(r.stoppedDate, r.stoppedPrecision),
        source: r.source,
      })),
      family: {
        state: familyHistoryState(family.length, latestReview),
        unknownReason: latestReview?.outcome === "unknown" ? latestReview.unknownReason : null,
        reviewedOn: latestReview ? iso(latestReview.reviewedAt) : null,
        entries: family.map((r) => ({
          id: r.id,
          relative: relativeText(r.relationship, r.relationshipText),
          condition: r.condition,
          onsetAge: r.onsetAge,
          deceased: r.deceased,
          causeOfDeath: r.causeOfDeath,
          source: r.source,
        })),
      },
      social: current
        ? {
            effectiveDate: current.effectiveDate,
            tobacco: tobaccoText(current),
            alcohol: alcoholText(current),
            occupation: current.occupation,
            occupationalExposures: current.occupationalExposures,
            livingSituation: current.livingSituation,
            physicalActivity: current.physicalActivity,
            diet: current.diet,
            sensitiveWithheld: !options.sensitive,
            substanceUse: options.sensitive ? current.substanceUse : null,
            sexualHistory: options.sensitive ? current.sexualHistory : null,
          }
        : null,
    };
  }

  /** Short display fields for Patient 360 (entries in error left out). Sensitive parts only when `sensitive`. Not audited here. */
  async workspace(organizationId: string, patientId: string, limit: number, options: { sensitive: boolean }) {
    const record = await this.patientRecord(organizationId, patientId);
    const family = record.family.filter((r) => !r.enteredInErrorAt);
    const current = record.social.find((r) => !r.enteredInErrorAt) ?? null;
    const procedures = record.procedures.filter((r) => !r.enteredInErrorAt);
    const conditions = record.conditions.filter((r) => !r.enteredInErrorAt);
    // Medicines the patient still takes (or may: not known); stopped ones stay in the full history.
    const medications = record.medications.filter((r) => !r.enteredInErrorAt && medicationState(r) !== "stopped");
    return {
      procedures: procedures.slice(0, limit).map((r) => ({
        id: r.id,
        patientId: r.patientId,
        description: r.description,
        performed: partialDateText(r.performedDate, r.performedPrecision),
        source: r.source,
      })),
      proceduresTotal: procedures.length,
      conditions: conditions.slice(0, limit).map((r) => ({
        id: r.id,
        patientId: r.patientId,
        description: r.description,
        onset: partialDateText(r.onsetDate, r.onsetPrecision),
        status: r.reportedStatus,
      })),
      conditionsTotal: conditions.length,
      medications: medications.slice(0, limit).map((r) => ({
        id: r.id,
        patientId: r.patientId,
        medication: r.medication,
        dose: r.doseText,
        status: medicationState(r),
      })),
      medicationsTotal: medications.length,
      family: {
        state: familyHistoryState(family.length, record.familyReviews[0] ?? null),
        entries: family.slice(0, limit).map((r) => ({
          id: r.id,
          patientId: r.patientId,
          relative: relativeText(r.relationship, r.relationshipText),
          condition: r.condition,
          onsetAge: r.onsetAge,
        })),
        total: family.length,
      },
      social: current
        ? {
            effectiveDate: current.effectiveDate,
            tobacco: tobaccoText(current),
            alcohol: alcoholText(current),
            occupation: current.occupation,
            sensitiveWithheld: !options.sensitive,
            substanceUse: options.sensitive ? current.substanceUse : null,
            sexualHistory: options.sensitive ? current.sexualHistory : null,
          }
        : null,
    };
  }

  // ---- recording --------------------------------------------------------------------------------------------------

  async recordProcedure(actor: Actor, patientId: string, input: z.output<typeof recordPastProcedureSchema>): Promise<PastProcedureView> {
    const performed = await this.pastDate(actor, input.performed, "The procedure date is in the future");
    const practitioner = await this.config.practitionerForUser(actor.organizationId, actor.userId);
    const row = await this.patientScoped(() =>
      this.db.transaction(async (tx) => {
        if (input.encounterId) await this.checkEncounter(tx, actor.organizationId, input.encounterId, patientId);
        const [inserted] = await tx
          .insert(pastProcedure)
          .values({
            organizationId: actor.organizationId,
            patientId,
            encounterId: input.encounterId ?? null,
            description: input.description,
            codeSystem: input.code ? (input.codeSystem ?? null) : null,
            code: input.code ?? null,
            performedDate: performed?.date ?? null,
            performedPrecision: performed?.precision ?? null,
            performer: input.performer ?? null,
            bodySite: input.bodySite ?? null,
            notes: input.notes ?? null,
            source: input.source,
            reportedBy: input.source === "reported" ? (input.reportedBy ?? null) : null,
            sourceDescription: input.sourceDescription ?? null,
            recorderPractitionerId: practitioner?.id ?? null,
            recordedBy: actor.userId,
          })
          .returning();
        const created = found(inserted, "Past procedure");
        await this.recorded(tx, actor, "procedure", created.id, patientId, { source: created.source, encounterId: created.encounterId });
        return created;
      }),
    );
    return (await this.procedureViews(actor.organizationId, [row]))[0]!;
  }

  async recordCondition(actor: Actor, patientId: string, input: z.output<typeof recordPastConditionSchema>): Promise<PastConditionView> {
    const onset = await this.pastDate(actor, input.onset, "The onset date is in the future");
    const practitioner = await this.config.practitionerForUser(actor.organizationId, actor.userId);
    const row = await this.patientScoped(() =>
      this.db.transaction(async (tx) => {
        if (input.encounterId) await this.checkEncounter(tx, actor.organizationId, input.encounterId, patientId);
        const [inserted] = await tx
          .insert(pastCondition)
          .values({
            organizationId: actor.organizationId,
            patientId,
            encounterId: input.encounterId ?? null,
            description: input.description,
            codeSystem: input.code ? (input.codeSystem ?? null) : null,
            code: input.code ?? null,
            onsetDate: onset?.date ?? null,
            onsetPrecision: onset?.precision ?? null,
            reportedStatus: input.status,
            diagnosedBy: input.diagnosedBy ?? null,
            notes: input.notes ?? null,
            source: input.source,
            reportedBy: input.source === "reported" ? (input.reportedBy ?? null) : null,
            sourceDescription: input.sourceDescription ?? null,
            recorderPractitionerId: practitioner?.id ?? null,
            recordedBy: actor.userId,
          })
          .returning();
        const created = found(inserted, "Past condition");
        await this.recorded(tx, actor, "condition", created.id, patientId, { source: created.source, encounterId: created.encounterId });
        return created;
      }),
    );
    return (await this.conditionViews(actor.organizationId, [row]))[0]!;
  }

  /** A medicine the patient takes that was not prescribed here, as reported or documented (never a prescription). */
  async recordMedication(actor: Actor, patientId: string, input: z.output<typeof recordReportedMedicationSchema>): Promise<ReportedMedicationView> {
    const started = await this.pastDate(actor, input.started, "The start date is in the future");
    const stopped = await this.pastDate(actor, input.stopped, "The stop date is in the future");
    if (stopBeforeStart(started, stopped)) throw new BusinessRuleError("The stop date is before the start date", "stop_before_start");
    const practitioner = await this.config.practitionerForUser(actor.organizationId, actor.userId);
    const row = await this.patientScoped(() =>
      this.db.transaction(async (tx) => {
        if (input.encounterId) await this.checkEncounter(tx, actor.organizationId, input.encounterId, patientId);
        const [inserted] = await tx
          .insert(reportedMedication)
          .values({
            organizationId: actor.organizationId,
            patientId,
            encounterId: input.encounterId ?? null,
            medication: input.medication,
            codeSystem: input.code ? (input.codeSystem ?? null) : null,
            code: input.code ?? null,
            doseText: input.dose ?? null,
            reason: input.reason ?? null,
            prescribedBy: input.prescribedBy ?? null,
            startedDate: started?.date ?? null,
            startedPrecision: started?.precision ?? null,
            reportedStatus: input.status,
            stoppedDate: stopped?.date ?? null,
            stoppedPrecision: stopped?.precision ?? null,
            notes: input.notes ?? null,
            source: input.source,
            reportedBy: input.source === "reported" ? (input.reportedBy ?? null) : null,
            sourceDescription: input.sourceDescription ?? null,
            recorderPractitionerId: practitioner?.id ?? null,
            recordedBy: actor.userId,
          })
          .returning();
        const created = found(inserted, "Medication taken");
        await this.recorded(tx, actor, "medication", created.id, patientId, {
          source: created.source,
          status: created.reportedStatus,
          encounterId: created.encounterId,
        });
        return created;
      }),
    );
    return (await this.medicationViews(actor.organizationId, [row]))[0]!;
  }

  /** The patient no longer takes a medicine recorded as taken or not known: once, with the stop date as known. */
  async stopMedication(actor: Actor, entryId: string, input: z.output<typeof stopReportedMedicationSchema>): Promise<ReportedMedicationView> {
    const stopped = await this.pastDate(actor, input.stopped, "The stop date is in the future");
    const row = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(reportedMedication)
        .where(and(eq(reportedMedication.organizationId, actor.organizationId), eq(reportedMedication.id, entryId)))
        .for("update");
      const entry = found(current, "Medication taken");
      if (entry.enteredInErrorAt) throw new BusinessRuleError("The entry is marked entered in error", "already_entered_in_error");
      if (medicationState(entry) === "stopped") throw new BusinessRuleError("The medicine is already recorded as stopped", "already_stopped");
      const started = entry.startedDate && entry.startedPrecision ? { date: entry.startedDate, precision: entry.startedPrecision } : null;
      if (stopBeforeStart(started, stopped)) throw new BusinessRuleError("The stop date is before the start date", "stop_before_start");
      const now = new Date();
      const [updated] = await tx
        .update(reportedMedication)
        .set({
          stopRecordedAt: now,
          stopRecordedBy: actor.userId,
          stopNote: input.note ?? null,
          stoppedDate: stopped?.date ?? null,
          stoppedPrecision: stopped?.precision ?? null,
        })
        .where(eq(reportedMedication.id, entryId))
        .returning();
      const result = found(updated, "Medication taken");
      await this.audit.record(tx, actor, {
        action: "history.medication-stopped",
        resourceType: "patient_history",
        resourceId: entryId,
        patientId: result.patientId,
        changes: { status: { from: entry.reportedStatus, to: "stopped" } },
        metadata: { section: "medication", stoppedPrecision: result.stoppedPrecision },
      });
      await this.events.record(tx, {
        type: "PatientHistoryMedicationStopped",
        organizationId: actor.organizationId,
        aggregateType: "patient_history",
        aggregateId: entryId,
        facilityId: actor.facilityId ?? null,
        patientId: result.patientId,
        payload: { entryId, section: "medication" },
      });
      return result;
    });
    return (await this.medicationViews(actor.organizationId, [row]))[0]!;
  }

  async recordFamily(actor: Actor, patientId: string, input: z.output<typeof recordFamilyHistorySchema>): Promise<FamilyHistoryView> {
    const row = await this.patientScoped(() =>
      this.db.transaction(async (tx) => {
        if (input.encounterId) await this.checkEncounter(tx, actor.organizationId, input.encounterId, patientId);
        const [inserted] = await tx
          .insert(familyHistoryEntry)
          .values({
            organizationId: actor.organizationId,
            patientId,
            encounterId: input.encounterId ?? null,
            relationship: input.relationship,
            relationshipText: input.relationshipText ?? null,
            condition: input.condition,
            codeSystem: input.code ? (input.codeSystem ?? null) : null,
            code: input.code ?? null,
            onsetAge: input.onsetAge ?? null,
            deceased: input.deceased ?? null,
            causeOfDeath: input.deceased ? (input.causeOfDeath ?? null) : null,
            notes: input.notes ?? null,
            source: "reported",
            reportedBy: input.reportedBy,
            recordedBy: actor.userId,
          })
          .returning();
        const created = found(inserted, "Family history entry");
        await this.recorded(tx, actor, "family", created.id, patientId, { source: created.source, relationship: created.relationship });
        return created;
      }),
    );
    return (await this.familyViews(actor.organizationId, [row]))[0]!;
  }

  /** The family history was asked about: complete as listed, none known, or not known (with the reason). */
  async reviewFamily(actor: Actor, patientId: string, input: z.output<typeof familyReviewSchema>): Promise<FamilyReviewView> {
    const row = await this.patientScoped(() =>
      this.db.transaction(async (tx) => {
        if (input.encounterId) await this.checkEncounter(tx, actor.organizationId, input.encounterId, patientId);
        // Serialize the patient's family history reviews (the conflict check reads the entries).
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('family_history'), hashtext(${patientId}::text))`);
        const [counted] = await tx
          .select({ n: count() })
          .from(familyHistoryEntry)
          .where(
            and(
              eq(familyHistoryEntry.organizationId, actor.organizationId),
              filedAsPatient(familyHistoryEntry.patientId, patientId),
              isNull(familyHistoryEntry.enteredInErrorAt),
            ),
          );
        const conflict = reviewConflict(input.outcome, counted?.n ?? 0);
        if (conflict) throw new BusinessRuleError(conflict, "family_review_conflict");
        const [inserted] = await tx
          .insert(familyHistoryReview)
          .values({
            organizationId: actor.organizationId,
            patientId,
            encounterId: input.encounterId ?? null,
            outcome: input.outcome,
            unknownReason: input.outcome === "unknown" ? (input.unknownReason ?? null) : null,
            notes: input.notes ?? null,
            reviewedBy: actor.userId,
          })
          .returning();
        const created = found(inserted, "Family history review");
        await this.recorded(tx, actor, "family_review", created.id, patientId, { outcome: created.outcome, unknownReason: created.unknownReason });
        return created;
      }),
    );
    return (await this.reviewViews(actor.organizationId, [row]))[0]!;
  }

  /**
   * A new version of the social history, on top of the current one (`basedOn`). Fields left out are carried over;
   * substance use and sexual history can be changed only by a user who may see them (they are carried over otherwise).
   */
  async recordSocial(actor: Actor, patientId: string, input: z.output<typeof recordSocialHistorySchema>): Promise<SocialHistoryView> {
    const sensitiveAccess = canReadSensitiveHistory(actor.permissions);
    if (!sensitiveAccess && SENSITIVE_SOCIAL_FIELDS.some((k) => input[k] !== undefined)) {
      throw new ForbiddenError(`Substance use and sexual history can be recorded only by users who also hold ${SENSITIVE_HISTORY_PERMISSION}`);
    }
    const timeZone = await this.timeZone(actor);
    const today = localDate(new Date(), timeZone);
    const effectiveDate = input.effectiveDate ?? today;
    if (effectiveDate > today) throw new BusinessRuleError("The date given is in the future", "date_in_future");

    const row = await this.patientScoped(() =>
      this.unique(() =>
        this.db.transaction(async (tx) => {
          if (input.encounterId) await this.checkEncounter(tx, actor.organizationId, input.encounterId, patientId);
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('social_history'), hashtext(${patientId}::text))`);
          const [current] = await tx
            .select()
            .from(socialHistory)
            .where(
              and(
                eq(socialHistory.organizationId, actor.organizationId),
                filedAsPatient(socialHistory.patientId, patientId),
                isNull(socialHistory.enteredInErrorAt),
              ),
            )
            .orderBy(desc(socialHistory.recordedAt))
            .limit(1);
          if ((current?.id ?? null) !== input.basedOn) {
            throw new ConflictError(
              "The social history changed since you opened it: review the current version and record again",
              undefined,
              "social_history_changed",
            );
          }
          if (current && effectiveDate < current.effectiveDate) {
            throw new BusinessRuleError("The date given is before the current version's", "effective_date_before_current");
          }
          const { basedOn: _basedOn, effectiveDate: _effective, encounterId: _encounter, ...changes } = input;
          const before = current ? socialFields(current) : null;
          const next = nextSocialVersion(before, changes);
          if (next.tobaccoQuitYear !== null && next.tobaccoQuitYear > Number(effectiveDate.slice(0, 4))) {
            throw new BusinessRuleError("The year stopped is after the date given", "quit_year_in_future");
          }
          if (!socialHasContent(next)) throw new BusinessRuleError("Record at least one part of the social history", "social_history_empty");
          const changed = changedSocialFields(before, next);
          if (current && changed.length === 0 && effectiveDate === current.effectiveDate) {
            throw new BusinessRuleError("Nothing changed from the current version", "social_history_unchanged");
          }
          const [inserted] = await tx
            .insert(socialHistory)
            .values({
              organizationId: actor.organizationId,
              patientId,
              encounterId: input.encounterId ?? null,
              supersedesId: current?.id ?? null,
              effectiveDate,
              ...next,
              recordedBy: actor.userId,
            })
            .returning();
          const created = found(inserted, "Social history");
          // Field names only, never their values.
          await this.recorded(tx, actor, "social", created.id, patientId, { supersedesId: created.supersedesId, changedFields: changed });
          return created;
        }),
      ),
    );
    return (await this.socialViews(actor.organizationId, [row], sensitiveAccess, row.id))[0]!;
  }

  /** A procedure accepted from a FHIR import, in the caller's transaction (the review queue's accept). Kept as received. */
  async recordImportedProcedureIn(
    tx: DbExecutor,
    actor: Actor,
    patientId: string,
    input: ImportedPastProcedureInput,
    origin: { reference: string; declaredSource: string | null },
  ): Promise<{ id: string }> {
    const entry = validated(importedPastProcedureSchema, input);
    const performed = entry.performed ? parsePartialDate(entry.performed) : null;
    const [inserted] = await tx
      .insert(pastProcedure)
      .values({
        organizationId: actor.organizationId,
        patientId,
        description: entry.description,
        codeSystem: entry.code ? entry.codeSystem : null,
        code: entry.codeSystem ? entry.code : null,
        performedDate: performed?.date ?? null,
        performedPrecision: performed?.precision ?? null,
        performer: entry.performer,
        bodySite: entry.bodySite,
        notes: entry.notes,
        source: "external_import",
        sourceDescription: entry.sourceDescription,
        sourceReference: origin.reference,
        declaredSource: origin.declaredSource,
        recordedBy: actor.userId,
      })
      .returning();
    const created = found(inserted, "Past procedure");
    await this.recorded(tx, actor, "procedure", created.id, patientId, { source: created.source, sourceReference: origin.reference });
    return { id: created.id };
  }

  /** A family member's condition accepted from a FHIR import, in the caller's transaction. */
  async recordImportedFamilyIn(
    tx: DbExecutor,
    actor: Actor,
    patientId: string,
    input: ImportedFamilyHistoryInput,
    origin: { reference: string; declaredSource: string | null },
  ): Promise<{ id: string }> {
    const entry = validated(importedFamilyHistorySchema, input);
    const [inserted] = await tx
      .insert(familyHistoryEntry)
      .values({
        organizationId: actor.organizationId,
        patientId,
        relationship: entry.relationship,
        relationshipText: entry.relationshipText ?? (entry.relationship === "other" ? "Relative" : null),
        condition: entry.condition,
        codeSystem: entry.code ? entry.codeSystem : null,
        code: entry.codeSystem ? entry.code : null,
        onsetAge: entry.onsetAge,
        deceased: entry.deceased,
        causeOfDeath: entry.deceased ? entry.causeOfDeath : null,
        notes: entry.notes,
        source: "external_import",
        sourceReference: origin.reference,
        declaredSource: origin.declaredSource,
        recordedBy: actor.userId,
      })
      .returning();
    const created = found(inserted, "Family history entry");
    await this.recorded(tx, actor, "family", created.id, patientId, { source: created.source, sourceReference: origin.reference });
    return { id: created.id };
  }

  /**
   * Marks a procedure, condition, medication taken, family history entry or social history version entered in error with a reason (never
   * deleted; once). A social history version in error stops being current: the previous version is current again.
   */
  async markEnteredInError(actor: Actor, entryId: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const org = actor.organizationId;
      const now = new Date();
      const set = { enteredInErrorAt: now, enteredInErrorBy: actor.userId, enteredInErrorReason: reason };
      const locate = async (): Promise<{ section: HistorySection; patientId: string; alreadyInError: boolean } | null> => {
        const [p] = await tx
          .select()
          .from(pastProcedure)
          .where(and(eq(pastProcedure.organizationId, org), eq(pastProcedure.id, entryId)))
          .for("update");
        if (p) return { section: "procedure", patientId: p.patientId, alreadyInError: p.enteredInErrorAt !== null };
        const [c] = await tx
          .select()
          .from(pastCondition)
          .where(and(eq(pastCondition.organizationId, org), eq(pastCondition.id, entryId)))
          .for("update");
        if (c) return { section: "condition", patientId: c.patientId, alreadyInError: c.enteredInErrorAt !== null };
        const [m] = await tx
          .select()
          .from(reportedMedication)
          .where(and(eq(reportedMedication.organizationId, org), eq(reportedMedication.id, entryId)))
          .for("update");
        if (m) return { section: "medication", patientId: m.patientId, alreadyInError: m.enteredInErrorAt !== null };
        const [f] = await tx
          .select()
          .from(familyHistoryEntry)
          .where(and(eq(familyHistoryEntry.organizationId, org), eq(familyHistoryEntry.id, entryId)))
          .for("update");
        if (f) return { section: "family", patientId: f.patientId, alreadyInError: f.enteredInErrorAt !== null };
        const [s] = await tx
          .select()
          .from(socialHistory)
          .where(and(eq(socialHistory.organizationId, org), eq(socialHistory.id, entryId)))
          .for("update");
        if (s) return { section: "social", patientId: s.patientId, alreadyInError: s.enteredInErrorAt !== null };
        return null;
      };
      const target = await locate();
      if (!target) throw new NotFoundError("History entry");
      if (target.alreadyInError) throw new BusinessRuleError("The entry is already marked entered in error", "already_entered_in_error");
      const table = { procedure: pastProcedure, condition: pastCondition, medication: reportedMedication, family: familyHistoryEntry, social: socialHistory }[
        target.section as "procedure" | "condition" | "medication" | "family" | "social"
      ];
      await tx.update(table).set(set).where(eq(table.id, entryId));
      await this.audit.record(tx, actor, {
        action: "history.entered-in-error",
        resourceType: "patient_history",
        resourceId: entryId,
        patientId: target.patientId,
        reason,
        changes: { status: { from: "recorded", to: "entered_in_error" } },
        metadata: { section: target.section },
      });
      await this.events.record(tx, {
        type: "PatientHistoryEnteredInError",
        organizationId: org,
        aggregateType: "patient_history",
        aggregateId: entryId,
        facilityId: actor.facilityId ?? null,
        patientId: target.patientId,
        payload: { entryId, section: target.section },
      });
      return { id: entryId, section: target.section, enteredInError: { at: now.toISOString(), reason } };
    });
  }

  // ---- internals --------------------------------------------------------------------------------------------------

  private async recorded(tx: DbExecutor, actor: Actor, section: HistorySection, id: string, patientId: string, metadata: Record<string, unknown>) {
    await this.audit.record(tx, actor, {
      action: "history.record",
      resourceType: "patient_history",
      resourceId: id,
      patientId,
      metadata: { section, ...metadata },
    });
    await this.events.record(tx, {
      type: "PatientHistoryRecorded",
      organizationId: actor.organizationId,
      aggregateType: "patient_history",
      aggregateId: id,
      facilityId: actor.facilityId ?? null,
      patientId,
      payload: { entryId: id, section },
    });
  }

  private async requirePatient(organizationId: string, patientId: string): Promise<void> {
    if (!(await this.patients.summaries(organizationId, [patientId])).has(patientId)) throw new NotFoundError("Patient");
  }

  /** A past date as precise as given; refused when it starts after today (in the facility's time zone). */
  private async pastDate(actor: Actor, value: string | undefined, futureMessage: string): Promise<PartialDate | null> {
    if (!value) return null;
    const parsed = parsePartialDate(value);
    const today = localDate(new Date(), await this.timeZone(actor));
    if (partialDateInFuture(parsed, today)) throw new BusinessRuleError(futureMessage, "date_in_future");
    return parsed;
  }

  private async checkEncounter(tx: DbExecutor, organizationId: string, encounterId: string, patientId: string): Promise<void> {
    const [row] = await tx
      .select({ patientId: encounter.patientId, status: encounter.status })
      .from(encounter)
      .where(and(eq(encounter.organizationId, organizationId), eq(encounter.id, encounterId)));
    const consultation = found(row, "Encounter");
    if (consultation.patientId !== patientId) throw new BusinessRuleError("The consultation is another patient's", "encounter_other_patient");
    if (consultation.status === "entered_in_error") throw new BusinessRuleError("The consultation is marked entered in error", "encounter_entered_in_error");
  }

  private async timeZone(actor: Actor): Promise<string> {
    if (!actor.facilityId) return PH_TIMEZONE;
    return (await this.organizations.getFacility(actor.organizationId, actor.facilityId)).timezone;
  }

  /** A patient outside the organization is not found (the composite foreign key). */
  private async patientScoped<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const pg = asPgError(error);
      if (pg?.code === PgErrorCode.foreignKeyViolation && pg.constraint?.includes("patient_id_fkey") && !pg.constraint.includes("encounter")) {
        throw new NotFoundError("Patient");
      }
      throw error;
    }
  }

  /** Two versions recorded on top of the same current one: the second is refused. */
  private async unique<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation) {
        throw new ConflictError(
          "The social history changed since you opened it: review the current version and record again",
          undefined,
          "social_history_changed",
        );
      }
      throw error;
    }
  }

  private async names(organizationId: string, ids: Array<string | null>): Promise<Map<string, string>> {
    const userIds = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    return userIds.length ? this.staff.staffNames(organizationId, userIds) : new Map();
  }

  private async compose(organizationId: string, patientId: string, record: PatientHistoryRecord, sensitive: boolean): Promise<PatientHistoryView> {
    const all = [...record.procedures, ...record.conditions, ...record.medications, ...record.family, ...record.social];
    const names = await this.names(organizationId, [
      ...all.flatMap((r) => [r.recordedBy, r.enteredInErrorBy]),
      ...record.medications.map((r) => r.stopRecordedBy),
      ...record.familyReviews.map((r) => r.reviewedBy),
    ]);
    const current = record.social.find((r) => !r.enteredInErrorAt) ?? null;
    const reviews = record.familyReviews.map((r) => reviewView(r, names));
    const entries = record.family.map((r) => familyView(r, names));
    const versions = record.social.map((r) => socialView(r, names, sensitive, current?.id ?? null));
    return {
      patientId,
      sensitiveAccess: sensitive,
      procedures: record.procedures.map((r) => procedureView(r, names)),
      conditions: record.conditions.map((r) => conditionView(r, names)),
      medications: record.medications.map((r) => medicationView(r, names)),
      family: {
        state: familyHistoryState(record.family.filter((r) => !r.enteredInErrorAt).length, record.familyReviews[0] ?? null),
        latestReview: reviews[0] ?? null,
        reviews,
        entries,
      },
      social: { current: versions.find((v) => v.current) ?? null, versions },
    };
  }

  private async procedureViews(organizationId: string, rows: PastProcedureRecord[]) {
    const names = await this.names(
      organizationId,
      rows.flatMap((r) => [r.recordedBy, r.enteredInErrorBy]),
    );
    return rows.map((r) => procedureView(r, names));
  }

  private async conditionViews(organizationId: string, rows: PastConditionRecord[]) {
    const names = await this.names(
      organizationId,
      rows.flatMap((r) => [r.recordedBy, r.enteredInErrorBy]),
    );
    return rows.map((r) => conditionView(r, names));
  }

  private async medicationViews(organizationId: string, rows: ReportedMedicationRecord[]) {
    const names = await this.names(
      organizationId,
      rows.flatMap((r) => [r.recordedBy, r.enteredInErrorBy, r.stopRecordedBy]),
    );
    return rows.map((r) => medicationView(r, names));
  }

  private async familyViews(organizationId: string, rows: FamilyHistoryRecord[]) {
    const names = await this.names(
      organizationId,
      rows.flatMap((r) => [r.recordedBy, r.enteredInErrorBy]),
    );
    return rows.map((r) => familyView(r, names));
  }

  private async reviewViews(organizationId: string, rows: FamilyReviewRecord[]) {
    const names = await this.names(
      organizationId,
      rows.map((r) => r.reviewedBy),
    );
    return rows.map((r) => reviewView(r, names));
  }

  private async socialViews(organizationId: string, rows: SocialHistoryRecord[], sensitive: boolean, currentId: string | null) {
    const names = await this.names(
      organizationId,
      rows.flatMap((r) => [r.recordedBy, r.enteredInErrorBy]),
    );
    return rows.map((r) => socialView(r, names, sensitive, currentId));
  }
}

function meta(
  r: { id: string; patientId: string; encounterId: string | null; recordedAt: Date; recordedBy: string } & {
    enteredInErrorAt: Date | null;
    enteredInErrorReason: string | null;
    enteredInErrorBy: string | null;
  },
  names: Map<string, string>,
): EntryMeta {
  return {
    id: r.id,
    patientId: r.patientId,
    encounterId: r.encounterId,
    recordedAt: iso(r.recordedAt),
    recordedByName: names.get(r.recordedBy) ?? null,
    enteredInError:
      r.enteredInErrorAt && r.enteredInErrorReason
        ? { at: iso(r.enteredInErrorAt), reason: r.enteredInErrorReason, byName: r.enteredInErrorBy ? (names.get(r.enteredInErrorBy) ?? null) : null }
        : null,
  };
}

function procedureView(r: PastProcedureRecord, names: Map<string, string>): PastProcedureView {
  return {
    ...meta(r, names),
    description: r.description,
    codeSystem: r.codeSystem,
    code: r.code,
    performed: partialDateText(r.performedDate, r.performedPrecision),
    performedPrecision: r.performedPrecision,
    performer: r.performer,
    bodySite: r.bodySite,
    notes: r.notes,
    source: r.source,
    reportedBy: r.reportedBy,
    sourceDescription: r.sourceDescription,
    sourceReference: r.sourceReference,
    declaredSource: r.declaredSource,
  };
}

function conditionView(r: PastConditionRecord, names: Map<string, string>): PastConditionView {
  return {
    ...meta(r, names),
    description: r.description,
    codeSystem: r.codeSystem,
    code: r.code,
    onset: partialDateText(r.onsetDate, r.onsetPrecision),
    onsetPrecision: r.onsetPrecision,
    status: r.reportedStatus,
    diagnosedBy: r.diagnosedBy,
    notes: r.notes,
    source: r.source,
    reportedBy: r.reportedBy,
    sourceDescription: r.sourceDescription,
  };
}

function medicationView(r: ReportedMedicationRecord, names: Map<string, string>): ReportedMedicationView {
  return {
    ...meta(r, names),
    medication: r.medication,
    codeSystem: r.codeSystem,
    code: r.code,
    dose: r.doseText,
    reason: r.reason,
    prescribedBy: r.prescribedBy,
    started: partialDateText(r.startedDate, r.startedPrecision),
    startedPrecision: r.startedPrecision,
    reportedStatus: r.reportedStatus,
    status: medicationState(r),
    stopped: partialDateText(r.stoppedDate, r.stoppedPrecision),
    stoppedPrecision: r.stoppedPrecision,
    stopRecorded: r.stopRecordedAt
      ? { at: iso(r.stopRecordedAt), byName: r.stopRecordedBy ? (names.get(r.stopRecordedBy) ?? null) : null, note: r.stopNote }
      : null,
    notes: r.notes,
    source: r.source,
    reportedBy: r.reportedBy,
    sourceDescription: r.sourceDescription,
  };
}

function familyView(r: FamilyHistoryRecord, names: Map<string, string>): FamilyHistoryView {
  return {
    ...meta(r, names),
    relationship: r.relationship,
    relationshipText: r.relationshipText,
    relative: relativeText(r.relationship, r.relationshipText),
    condition: r.condition,
    codeSystem: r.codeSystem,
    code: r.code,
    onsetAge: r.onsetAge,
    deceased: r.deceased,
    causeOfDeath: r.causeOfDeath,
    notes: r.notes,
    source: r.source,
    reportedBy: r.reportedBy,
    sourceReference: r.sourceReference,
    declaredSource: r.declaredSource,
  };
}

function reviewView(r: FamilyReviewRecord, names: Map<string, string>): FamilyReviewView {
  return {
    id: r.id,
    patientId: r.patientId,
    encounterId: r.encounterId,
    outcome: r.outcome,
    unknownReason: r.unknownReason,
    notes: r.notes,
    reviewedAt: iso(r.reviewedAt),
    reviewedByName: names.get(r.reviewedBy) ?? null,
  };
}

function socialView(r: SocialHistoryRecord, names: Map<string, string>, sensitive: boolean, currentId: string | null): SocialHistoryView {
  const fields = socialFields(r);
  return {
    ...meta(r, names),
    ...fields,
    substanceUse: sensitive ? fields.substanceUse : null,
    sexualHistory: sensitive ? fields.sexualHistory : null,
    supersedesId: r.supersedesId,
    effectiveDate: r.effectiveDate,
    sensitiveWithheld: !sensitive,
    current: r.id === currentId,
  };
}
