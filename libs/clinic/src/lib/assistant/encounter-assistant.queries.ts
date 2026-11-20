import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, filedAsPatient } from "@healthcare/core";
import { and, desc, eq, gt, gte, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import {
  allergyIntolerance,
  allergyReview,
  appointment,
  codingSystem,
  diagnosis,
  encounter,
  encounterNoteRevision,
  visit,
  visitType,
  vitalSignSet,
} from "../clinic.schema";
import type { CodeSuggestionTarget, UsedCode } from "./code-suggestions.rules";
import type { EncounterChecklistInput } from "./encounter-checklist.rules";

/**
 * What the consultation rules read (`clinic.encounter-checklist`, `clinic.code-suggestions`), at a moment: each state is
 * rebuilt from its times (started, signed, note revisions, vital signs, diagnoses, allergy reviews), so a past moment
 * reads what was true then. The checklist reads only whether things are recorded; the code suggestions read the
 * consultation's own text and the organization's past codes, counted. The API audits the request.
 */
@Injectable()
export class EncounterAssistantQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Consultations of the facility open at `asOf` that started in [dayStart, asOf] (a replay reads these). */
  async openOn(organizationId: string, facilityId: string, dayStart: Date, asOf: Date): Promise<string[]> {
    const rows = await this.db
      .select({ id: encounter.id })
      .from(encounter)
      .where(
        and(
          eq(encounter.organizationId, organizationId),
          eq(encounter.facilityId, facilityId),
          gte(encounter.startedAt, dayStart),
          lte(encounter.startedAt, asOf),
          ne(encounter.status, "entered_in_error"),
          or(isNull(encounter.completedAt), gt(encounter.completedAt, asOf)),
        ),
      );
    return rows.map((r) => r.id);
  }

  /** The consultation, if open at `asOf` (null when signed by then, or not this organization's). */
  async checklistInput(organizationId: string, encounterId: string, asOf: Date, vitalsWithinHours: number): Promise<EncounterChecklistInput | null> {
    const [enc] = await this.db
      .select()
      .from(encounter)
      .where(and(eq(encounter.organizationId, organizationId), eq(encounter.id, encounterId)));
    if (!enc || enc.status === "entered_in_error" || enc.startedAt > asOf || (enc.completedAt !== null && enc.completedAt <= asOf)) return null;

    const note = await this.latestNote(organizationId, encounterId, asOf);
    const since = new Date(asOf.getTime() - vitalsWithinHours * 60 * 60 * 1000);
    const [vitals] = await this.db
      .select({ id: vitalSignSet.id })
      .from(vitalSignSet)
      .where(
        and(
          eq(vitalSignSet.organizationId, organizationId),
          or(
            eq(vitalSignSet.encounterId, encounterId),
            enc.visitId ? eq(vitalSignSet.visitId, enc.visitId) : sql`false`,
            filedAsPatient(vitalSignSet.patientId, enc.patientId),
          ),
          gte(vitalSignSet.measuredAt, since),
          lte(vitalSignSet.recordedAt, asOf),
          or(isNull(vitalSignSet.enteredInErrorAt), gt(vitalSignSet.enteredInErrorAt, asOf)),
        ),
      )
      .limit(1);
    const diagnoses = await this.activeDiagnoses(organizationId, encounterId, asOf);
    const [review] = await this.db
      .select({ id: allergyReview.id })
      .from(allergyReview)
      .where(and(eq(allergyReview.organizationId, organizationId), filedAsPatient(allergyReview.patientId, enc.patientId), lte(allergyReview.reviewedAt, asOf)))
      .limit(1);
    const [allergy] = review
      ? [review]
      : await this.db
          .select({ id: allergyIntolerance.id })
          .from(allergyIntolerance)
          .where(
            and(
              eq(allergyIntolerance.organizationId, organizationId),
              filedAsPatient(allergyIntolerance.patientId, enc.patientId),
              lte(allergyIntolerance.recordedAt, asOf),
              ne(allergyIntolerance.status, "entered_in_error"),
            ),
          )
          .limit(1);
    const [coding] = await this.db
      .select({ id: codingSystem.id })
      .from(codingSystem)
      .where(and(eq(codingSystem.organizationId, organizationId), eq(codingSystem.status, "active")))
      .limit(1);
    return {
      encounterId,
      inPerson: enc.modality === "in_person",
      hasChiefComplaint: Boolean(enc.chiefComplaint?.trim()),
      hasVitals: Boolean(vitals),
      hasAssessment: Boolean(note?.assessment?.trim()),
      hasPlan: Boolean(note?.plan?.trim()),
      diagnoses: diagnoses.map((d) => ({ coded: d.code !== null && d.code.trim() !== "", primary: d.rank === "primary" })),
      allergiesReviewed: Boolean(allergy),
      codingAvailable: Boolean(coding),
    };
  }

  /** `clinic.code-suggestions`: the open consultation's uncoded diagnoses, or its assessment when it has no diagnosis yet. */
  async codeTargets(organizationId: string, encounterId: string, asOf: Date): Promise<CodeSuggestionTarget[]> {
    const [enc] = await this.db
      .select({ status: encounter.status, startedAt: encounter.startedAt, completedAt: encounter.completedAt })
      .from(encounter)
      .where(and(eq(encounter.organizationId, organizationId), eq(encounter.id, encounterId)));
    if (!enc || enc.status === "entered_in_error" || enc.startedAt > asOf || (enc.completedAt !== null && enc.completedAt <= asOf)) return [];
    const diagnoses = await this.activeDiagnoses(organizationId, encounterId, asOf);
    if (diagnoses.length > 0) {
      return diagnoses
        .filter((d) => d.code === null || d.code.trim() === "")
        .map((d) => ({ key: `diagnosis:${d.id}`, kind: "diagnosis" as const, text: d.display }));
    }
    const note = await this.latestNote(organizationId, encounterId, asOf);
    return note?.assessment?.trim() ? [{ key: `assessment:${encounterId}`, kind: "assessment", text: note.assessment }] : [];
  }

  /** The organization's coded diagnoses of the window before `asOf`, per active coding system and code, with the most common description. */
  async usedCodes(organizationId: string, asOf: Date, lookbackDays: number): Promise<UsedCode[]> {
    const since = new Date(asOf.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({
        codeSystemKey: diagnosis.codeSystemKey,
        code: diagnosis.code,
        display: sql<string>`mode() within group (order by ${diagnosis.display})`,
        uses: sql<number>`count(*)::int`,
      })
      .from(diagnosis)
      .innerJoin(codingSystem, and(eq(codingSystem.organizationId, diagnosis.organizationId), eq(codingSystem.key, diagnosis.codeSystemKey)))
      .where(
        and(
          eq(diagnosis.organizationId, organizationId),
          eq(codingSystem.status, "active"),
          isNotNull(diagnosis.code),
          ne(diagnosis.status, "entered_in_error"),
          gte(diagnosis.recordedAt, since),
          lt(diagnosis.recordedAt, asOf),
        ),
      )
      .groupBy(diagnosis.codeSystemKey, diagnosis.code);
    return rows.filter((r) => r.codeSystemKey && r.code).map((r) => ({ codeSystemKey: r.codeSystemKey!, code: r.code!, display: r.display, uses: r.uses }));
  }

  // ---- internals ---------------------------------------------------------------------------------------------------

  private async latestNote(organizationId: string, encounterId: string, asOf: Date) {
    const [note] = await this.db
      .select({ assessment: encounterNoteRevision.assessment, plan: encounterNoteRevision.plan })
      .from(encounterNoteRevision)
      .where(
        and(
          eq(encounterNoteRevision.organizationId, organizationId),
          eq(encounterNoteRevision.encounterId, encounterId),
          lte(encounterNoteRevision.authoredAt, asOf),
        ),
      )
      .orderBy(desc(encounterNoteRevision.revisionNumber))
      .limit(1);
    return note;
  }

  /** Diagnoses of the consultation recorded by `asOf` and not entered in error (their later status changes are not dated, so the current status stands). */
  private activeDiagnoses(organizationId: string, encounterId: string, asOf: Date) {
    return this.db
      .select({ id: diagnosis.id, code: diagnosis.code, codeSystemKey: diagnosis.codeSystemKey, display: diagnosis.display, rank: diagnosis.rank })
      .from(diagnosis)
      .where(
        and(
          eq(diagnosis.organizationId, organizationId),
          eq(diagnosis.encounterId, encounterId),
          lte(diagnosis.recordedAt, asOf),
          eq(diagnosis.status, "active"),
        ),
      )
      .orderBy(diagnosis.recordedAt);
  }

  /**
   * `laboratory.order-sets`, clinic side: the open consultation's visit type code (from its queue visit, else its
   * appointment) and its active diagnoses' codes. Null when the consultation is not open at the moment.
   */
  async orderSetContext(
    organizationId: string,
    encounterId: string,
    asOf: Date,
  ): Promise<{ visitTypeCode: string | null; diagnoses: Array<{ codeSystemKey: string | null; code: string | null }> } | null> {
    const [enc] = await this.db
      .select({
        status: encounter.status,
        startedAt: encounter.startedAt,
        completedAt: encounter.completedAt,
        visitId: encounter.visitId,
        appointmentId: encounter.appointmentId,
      })
      .from(encounter)
      .where(and(eq(encounter.organizationId, organizationId), eq(encounter.id, encounterId)));
    if (!enc || enc.status === "entered_in_error" || enc.startedAt > asOf || (enc.completedAt !== null && enc.completedAt <= asOf)) return null;
    let visitTypeCode: string | null = null;
    if (enc.visitId) {
      const [row] = await this.db
        .select({ code: visitType.code })
        .from(visit)
        .innerJoin(visitType, eq(visitType.id, visit.visitTypeId))
        .where(and(eq(visit.organizationId, organizationId), eq(visit.id, enc.visitId)));
      visitTypeCode = row?.code ?? null;
    }
    if (!visitTypeCode && enc.appointmentId) {
      const [row] = await this.db
        .select({ code: visitType.code })
        .from(appointment)
        .innerJoin(visitType, eq(visitType.id, appointment.visitTypeId))
        .where(and(eq(appointment.organizationId, organizationId), eq(appointment.id, enc.appointmentId)));
      visitTypeCode = row?.code ?? null;
    }
    const diagnoses = await this.activeDiagnoses(organizationId, encounterId, asOf);
    return { visitTypeCode, diagnoses: diagnoses.map((d) => ({ codeSystemKey: d.codeSystemKey, code: d.code })) };
  }
}
