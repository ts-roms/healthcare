import { Inject, Injectable } from "@nestjs/common";
import { AuditService, type PatientAuditContext } from "@healthcare/audit";
import {
  asPgError,
  BusinessRuleError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  filedAsPatient,
  localDate,
  NotFoundError,
  PgErrorCode,
  PH_TIMEZONE,
} from "@healthcare/core";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { found } from "../clinic-support";
import type { PortalHistorySubmissionInput } from "./history.dto";
import {
  changedSocialFields,
  medicationState,
  nextSocialVersion,
  type PartialDate,
  partialDateInFuture,
  parsePartialDate,
  SOCIAL_FIELDS,
  type SocialFields,
  socialHasContent,
  stopBeforeStart,
} from "./history.rules";
import {
  familyHistoryEntry,
  type HistoryInformant,
  type HistorySection,
  pastCondition,
  pastProcedure,
  patientHistorySubmission,
  type PatientHistorySubmissionRecord,
  reportedMedication,
  socialHistory,
} from "./history.schema";

/** The MyHealth account writing to a patient's history (the patient themself, or a guardian acting under a grant). */
export interface PortalHistoryWriter {
  organizationId: string;
  patientId: string;
  portalAccountId: string;
  /** The guardian's grant when acting for a dependent; the answers are then recorded as reported by a relative. */
  proxyGrantId: string | null;
  audit: PatientAuditContext;
}

export interface HistorySubmissionView {
  id: string;
  submittedAt: string;
  sections: HistorySection[];
  entryIds: string[];
  /** Answered by someone acting for the patient. */
  byProxy: boolean;
  /** A retry with the same Idempotency-Key: the first submission, nothing written again. */
  replayed: boolean;
}

export type PortalSection = Exclude<HistorySection, "family_review">;

const iso = (d: Date) => d.toISOString();

/**
 * The patient's own answers in MyHealth (docs/domains/patient-history.md, "Reported by the patient in MyHealth"): a
 * history questionnaire written as ordinary history entries — reported by the patient (or a relative when a guardian
 * answers), through the portal, with no clinician's recorder, notes or consultation — and a medicine the patient
 * marks as stopped. Nothing is reviewed into the record: the history was never a clinical judgement of the
 * organization, and the clinic corrects a mistake the usual way (entered in error, a new entry). Substance use and
 * sexual history are not asked; a social history version from MyHealth carries them over unchanged. Every write is
 * audited as the patient and raises the same events as a staff record. Dates are read in Asia/Manila (no facility).
 */
@Injectable()
export class PatientHistoryPortalService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  /** The questionnaires the patient (or someone acting for them) completed, newest first. */
  async submissions(organizationId: string, patientId: string): Promise<HistorySubmissionView[]> {
    const rows = await this.db
      .select()
      .from(patientHistorySubmission)
      .where(and(eq(patientHistorySubmission.organizationId, organizationId), filedAsPatient(patientHistorySubmission.patientId, patientId)))
      .orderBy(desc(patientHistorySubmission.submittedAt))
      .limit(50);
    return rows.map((r) => view(r, false));
  }

  /** A questionnaire answered in one go; a retry with the same Idempotency-Key returns the first submission. */
  async submit(writer: PortalHistoryWriter, input: PortalHistorySubmissionInput, idempotencyKey: string | null): Promise<HistorySubmissionView> {
    if (idempotencyKey) {
      const earlier = await this.replay(writer, idempotencyKey);
      if (earlier) return earlier;
    }
    const today = localDate(new Date(), PH_TIMEZONE);
    const informant: HistoryInformant = writer.proxyGrantId ? "relative" : "patient";
    // Dates are checked before anything is written, so a refusal leaves nothing behind.
    const medications = input.medications.map((m) => {
      const started = pastDate(m.started, today, "The start date is in the future");
      const stopped = pastDate(m.stopped, today, "The stop date is in the future");
      if (stopBeforeStart(started, stopped)) throw new BusinessRuleError("The stop date is before the start date", "stop_before_start");
      return { ...m, started, stopped };
    });
    const conditions = input.conditions.map((c) => ({ ...c, onset: pastDate(c.onset, today, "The onset date is in the future") }));
    const procedures = input.procedures.map((p) => ({ ...p, performed: pastDate(p.performed, today, "The procedure date is in the future") }));
    const base = {
      organizationId: writer.organizationId,
      patientId: writer.patientId,
      source: "reported" as const,
      reportedBy: informant,
      recordedVia: "patient_portal" as const,
      recordedBy: null,
      portalAccountId: writer.portalAccountId,
      proxyGrantId: writer.proxyGrantId,
    };
    try {
      const row = await this.db.transaction(async (tx) => {
        const entryIds: string[] = [];
        const sections = new Set<PortalSection>();
        const record = async (section: PortalSection, id: string, metadata: Record<string, unknown>) => {
          entryIds.push(id);
          sections.add(section);
          await this.recorded(tx, writer, section, id, metadata);
        };
        for (const m of medications) {
          const [inserted] = await tx
            .insert(reportedMedication)
            .values({
              ...base,
              medication: m.medication,
              doseText: m.dose ?? null,
              reason: m.reason ?? null,
              prescribedBy: m.prescribedBy ?? null,
              startedDate: m.started?.date ?? null,
              startedPrecision: m.started?.precision ?? null,
              reportedStatus: m.status,
              stoppedDate: m.stopped?.date ?? null,
              stoppedPrecision: m.stopped?.precision ?? null,
            })
            .returning({ id: reportedMedication.id });
          await record("medication", found(inserted, "Medication taken").id, { status: m.status });
        }
        for (const c of conditions) {
          const [inserted] = await tx
            .insert(pastCondition)
            .values({
              ...base,
              description: c.description,
              onsetDate: c.onset?.date ?? null,
              onsetPrecision: c.onset?.precision ?? null,
              reportedStatus: c.status,
              diagnosedBy: c.diagnosedBy ?? null,
            })
            .returning({ id: pastCondition.id });
          await record("condition", found(inserted, "Past condition").id, {});
        }
        for (const p of procedures) {
          const [inserted] = await tx
            .insert(pastProcedure)
            .values({
              ...base,
              description: p.description,
              performedDate: p.performed?.date ?? null,
              performedPrecision: p.performed?.precision ?? null,
              performer: p.performer ?? null,
              bodySite: p.bodySite ?? null,
            })
            .returning({ id: pastProcedure.id });
          await record("procedure", found(inserted, "Past procedure").id, {});
        }
        for (const f of input.family) {
          const [inserted] = await tx
            .insert(familyHistoryEntry)
            .values({
              ...base,
              relationship: f.relationship,
              relationshipText: f.relationshipText ?? null,
              condition: f.condition,
              onsetAge: f.onsetAge ?? null,
              deceased: f.deceased ?? null,
              causeOfDeath: f.deceased ? (f.causeOfDeath ?? null) : null,
            })
            .returning({ id: familyHistoryEntry.id });
          await record("family", found(inserted, "Family history entry").id, { relationship: f.relationship });
        }
        if (input.social) {
          const socialId = await this.socialVersion(tx, writer, input.social, today, base);
          if (socialId) await record("social", socialId, {});
        }
        if (entryIds.length === 0) throw new BusinessRuleError("Nothing in the questionnaire is new", "history_submission_empty");
        const [submission] = await tx
          .insert(patientHistorySubmission)
          .values({
            organizationId: writer.organizationId,
            patientId: writer.patientId,
            portalAccountId: writer.portalAccountId,
            proxyGrantId: writer.proxyGrantId,
            sections: [...sections],
            entryIds,
            idempotencyKey,
          })
          .returning();
        const created = found(submission, "History submission");
        await this.audit.record(tx, writer.audit, {
          action: "portal.health-history-submit",
          resourceType: "patient_history_submission",
          resourceId: created.id,
          patientId: writer.patientId,
          metadata: { sections: created.sections, entries: entryIds.length, byProxy: writer.proxyGrantId !== null },
        });
        return created;
      });
      return view(row, false);
    } catch (error) {
      const pg = asPgError(error);
      if (pg?.code === PgErrorCode.uniqueViolation && idempotencyKey) {
        const earlier = await this.replay(writer, idempotencyKey);
        if (earlier) return earlier;
      }
      if (pg?.code === PgErrorCode.foreignKeyViolation && pg.constraint?.includes("patient_id_fkey")) throw new NotFoundError("Patient");
      throw error;
    }
  }

  /** The patient no longer takes a medicine they reported in MyHealth: once, with the stop date as known. */
  async stopMedication(writer: PortalHistoryWriter, entryId: string, input: { stopped?: string; note?: string }) {
    const today = localDate(new Date(), PH_TIMEZONE);
    const stopped = pastDate(input.stopped, today, "The stop date is in the future");
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(reportedMedication)
        .where(
          and(
            eq(reportedMedication.organizationId, writer.organizationId),
            eq(reportedMedication.id, entryId),
            filedAsPatient(reportedMedication.patientId, writer.patientId),
          ),
        )
        .for("update");
      const entry = found(current, "Medication taken");
      // Only what the patient reported in MyHealth; what the clinic recorded is changed at the clinic.
      if (entry.recordedVia !== "patient_portal")
        throw new BusinessRuleError("This medicine was recorded by the clinic: tell the clinic", "recorded_by_clinic");
      if (entry.enteredInErrorAt) throw new BusinessRuleError("The entry is marked entered in error", "already_entered_in_error");
      if (medicationState(entry) === "stopped") throw new BusinessRuleError("The medicine is already recorded as stopped", "already_stopped");
      const started = entry.startedDate && entry.startedPrecision ? { date: entry.startedDate, precision: entry.startedPrecision } : null;
      if (stopBeforeStart(started, stopped)) throw new BusinessRuleError("The stop date is before the start date", "stop_before_start");
      const now = new Date();
      await tx
        .update(reportedMedication)
        .set({
          stopRecordedAt: now,
          stopPortalAccountId: writer.portalAccountId,
          stopNote: input.note ?? null,
          stoppedDate: stopped?.date ?? null,
          stoppedPrecision: stopped?.precision ?? null,
        })
        .where(eq(reportedMedication.id, entryId));
      await this.audit.record(tx, writer.audit, {
        action: "history.medication-stopped",
        resourceType: "patient_history",
        resourceId: entryId,
        patientId: entry.patientId,
        changes: { status: { from: entry.reportedStatus, to: "stopped" } },
        metadata: { section: "medication", recordedVia: "patient_portal", stoppedPrecision: stopped?.precision ?? null },
      });
      await this.events.record(tx, {
        type: "PatientHistoryMedicationStopped",
        organizationId: writer.organizationId,
        aggregateType: "patient_history",
        aggregateId: entryId,
        facilityId: null,
        patientId: entry.patientId,
        payload: { entryId, section: "medication" },
      });
      return { id: entryId, status: "stopped" as const, stopped: input.stopped ?? null, stoppedAt: iso(now) };
    });
  }

  // ---- internals ------------------------------------------------------------------------------------------------------

  /**
   * A new social history version from the patient's answers on top of the current one: the parts the patient may not
   * set (substance use, sexual history) and the clinician's notes are carried over. Nothing is written when nothing
   * changed. The id of the version written, or null.
   */
  private async socialVersion(
    tx: DbExecutor,
    writer: PortalHistoryWriter,
    answers: NonNullable<PortalHistorySubmissionInput["social"]>,
    today: string,
    base: { recordedVia: "patient_portal"; portalAccountId: string; proxyGrantId: string | null },
  ): Promise<string | null> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('social_history'), hashtext(${writer.patientId}::text))`);
    const [current] = await tx
      .select()
      .from(socialHistory)
      .where(
        and(
          eq(socialHistory.organizationId, writer.organizationId),
          filedAsPatient(socialHistory.patientId, writer.patientId),
          isNull(socialHistory.enteredInErrorAt),
        ),
      )
      .orderBy(desc(socialHistory.recordedAt))
      .limit(1);
    const before: SocialFields | null = current ? (Object.fromEntries(SOCIAL_FIELDS.map((k) => [k, current[k]])) as unknown as SocialFields) : null;
    // The patient's notes field is never set from MyHealth; sensitive fields are carried over.
    const next = nextSocialVersion(before, { ...answers, notes: undefined, substanceUse: undefined, sexualHistory: undefined });
    if (next.tobaccoQuitYear !== null && next.tobaccoQuitYear > Number(today.slice(0, 4))) {
      throw new BusinessRuleError("The year stopped is after today", "quit_year_in_future");
    }
    if (!socialHasContent(next)) return null;
    if (current && changedSocialFields(before, next).length === 0) return null;
    const effectiveDate = current && current.effectiveDate > today ? current.effectiveDate : today;
    const [inserted] = await tx
      .insert(socialHistory)
      .values({
        organizationId: writer.organizationId,
        patientId: writer.patientId,
        supersedesId: current?.id ?? null,
        effectiveDate,
        ...next,
        notes: current?.notes ?? null,
        recordedBy: null,
        ...base,
      })
      .returning({ id: socialHistory.id });
    return found(inserted, "Social history").id;
  }

  private async recorded(tx: DbExecutor, writer: PortalHistoryWriter, section: HistorySection, id: string, metadata: Record<string, unknown>) {
    await this.audit.record(tx, writer.audit, {
      action: "history.record",
      resourceType: "patient_history",
      resourceId: id,
      patientId: writer.patientId,
      metadata: { section, source: "reported", recordedVia: "patient_portal", ...metadata },
    });
    await this.events.record(tx, {
      type: "PatientHistoryRecorded",
      organizationId: writer.organizationId,
      aggregateType: "patient_history",
      aggregateId: id,
      facilityId: null,
      patientId: writer.patientId,
      payload: { entryId: id, section },
    });
  }

  private async replay(writer: PortalHistoryWriter, idempotencyKey: string): Promise<HistorySubmissionView | null> {
    const [row] = await this.db
      .select()
      .from(patientHistorySubmission)
      .where(and(eq(patientHistorySubmission.portalAccountId, writer.portalAccountId), eq(patientHistorySubmission.idempotencyKey, idempotencyKey)));
    return row ? view(row, true) : null;
  }
}

/** A past date as precise as given; refused when it starts after today. */
function pastDate(value: string | undefined, today: string, futureMessage: string): PartialDate | null {
  if (!value) return null;
  const parsed = parsePartialDate(value);
  if (partialDateInFuture(parsed, today)) throw new BusinessRuleError(futureMessage, "date_in_future");
  return parsed;
}

function view(r: PatientHistorySubmissionRecord, replayed: boolean): HistorySubmissionView {
  return { id: r.id, submittedAt: iso(r.submittedAt), sections: r.sections, entryIds: r.entryIds, byProxy: r.proxyGrantId !== null, replayed };
}
