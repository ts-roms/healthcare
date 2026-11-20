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

  /**
   * `laboratory.monitoring-gap`, clinic side: the consultation's patient and their chronic problems at the moment — the
   * active coded diagnoses marked chronic in any of their consultations (records linked to theirs included) recorded by
   * then, the long-term part of the problem list Patient 360 shows, each with the time it was first recorded. A
   * diagnosis's later status changes are not dated, so its current status stands. Codes only.
   */
  async chronicProblems(
    organizationId: string,
    encounterId: string,
    asOf: Date,
  ): Promise<{ patientId: string; problems: Array<{ codeSystemKey: string | null; code: string; firstRecordedAt: string }> } | null> {
    const [enc] = await this.db
      .select({ patientId: encounter.patientId })
      .from(encounter)
      .where(and(eq(encounter.organizationId, organizationId), eq(encounter.id, encounterId)));
    if (!enc) return null;
    const { rows } = await this.db.execute<{ code_system_key: string | null; code: string; first: string }>(sql`
      SELECT d.code_system_key, d.code, to_char(min(d.recorded_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS first
      FROM diagnosis d
      WHERE d.organization_id = ${organizationId}::uuid
        AND d.patient_id = ANY(patient_record_ids(${enc.patientId}::uuid))
        AND d.status = 'active' AND d.is_chronic AND d.code IS NOT NULL
        AND d.recorded_at <= ${asOf.toISOString()}::timestamptz
      GROUP BY d.code_system_key, d.code
    `);
    return { patientId: enc.patientId, problems: rows.map((r) => ({ codeSystemKey: r.code_system_key, code: r.code, firstRecordedAt: r.first })) };
  }

  /**
   * `telemedicine.in-person-care`, clinic side: whether the consultation is an online one and, for one, the patient's care
   * as of the moment — online consultations started in (`onlineSince`, `asOf`] (this one included), when the last
   * in-person consultation started and when vital signs were last measured (records linked to theirs included;
   * consultations opened in error as they are now, vital signs entered in error by then, left out). Counts and times only.
   */
  async careContinuity(
    organizationId: string,
    encounterId: string,
    window: { asOf: Date; onlineSince: Date },
  ): Promise<{ online: boolean; onlineConsultations: number; lastInPersonAt: string | null; lastVitalsAt: string | null } | null> {
    const [enc] = await this.db
      .select({ patientId: encounter.patientId, modality: encounter.modality })
      .from(encounter)
      .where(and(eq(encounter.organizationId, organizationId), eq(encounter.id, encounterId)));
    if (!enc) return null;
    if (enc.modality !== "telemedicine") return { online: false, onlineConsultations: 0, lastInPersonAt: null, lastVitalsAt: null };
    const asOf = window.asOf.toISOString();
    const iso = (column: ReturnType<typeof sql>) => sql`to_char((${column}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
    const { rows } = await this.db.execute<{ online: number; last_in_person: string | null }>(sql`
      SELECT
        count(*) FILTER (WHERE e.modality = 'telemedicine' AND e.started_at > ${window.onlineSince.toISOString()}::timestamptz AND e.started_at <= ${asOf}::timestamptz)::int AS online,
        ${iso(sql`max(e.started_at) FILTER (WHERE e.modality = 'in_person' AND e.started_at <= ${asOf}::timestamptz)`)} AS last_in_person
      FROM encounter e
      WHERE e.organization_id = ${organizationId}::uuid
        AND e.patient_id = ANY(patient_record_ids(${enc.patientId}::uuid))
        AND e.status <> 'entered_in_error'
    `);
    const { rows: vitals } = await this.db.execute<{ last: string | null }>(sql`
      SELECT ${iso(sql`max(v.measured_at)`)} AS last
      FROM vital_sign_set v
      WHERE v.organization_id = ${organizationId}::uuid
        AND v.patient_id = ANY(patient_record_ids(${enc.patientId}::uuid))
        AND v.measured_at <= ${asOf}::timestamptz
        AND (v.entered_in_error_at IS NULL OR v.entered_in_error_at > ${asOf}::timestamptz)
    `);
    return {
      online: true,
      onlineConsultations: Number(rows[0]?.online ?? 0),
      lastInPersonAt: rows[0]?.last_in_person ?? null,
      lastVitalsAt: vitals[0]?.last ?? null,
    };
  }
}
