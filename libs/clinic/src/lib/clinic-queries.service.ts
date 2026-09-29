import { Inject, Injectable } from "@nestjs/common";
import {
  DATABASE,
  type Database,
  localDate,
  localDayBounds,
  timelineFacility,
  timelineInstant,
  timelineRange,
  type TimelineWindow,
  filedAsPatient,
} from "@healthcare/core";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import { facility } from "@healthcare/organization";
import {
  allergyIntolerance,
  allergyReview,
  appointment,
  diagnosis,
  encounter,
  encounterNoteRevision,
  externalHistoryEntry,
  practitioner,
  visit,
  visitType,
  vitalSignSet,
} from "./clinic.schema";
import { publicView } from "./clinic-support";
import { canApply } from "./domain/appointment-state";
import { patientMayChange } from "./domain/patient-booking";
import { ClinicConfigService } from "./config/clinic-config.service";
import { TriageService, toVitalsView } from "./triage/triage.service";

/**
 * Read-only queries other domains may use through app-level adapters
 * (prescribing context, Patient 360). No auditing here: callers audit the
 * user-facing access they serve.
 */
@Injectable()
export class ClinicQueries {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ClinicConfigService,
    private readonly triage: TriageService,
  ) {}

  practitionerForUser(organizationId: string, userId: string) {
    return this.config.practitionerForUser(organizationId, userId);
  }

  /**
   * A patient's own appointments for the patient portal: upcoming ones and the
   * last year's, with where, when, with whom and the status. No staff notes or
   * reasons for cancellation. Not audited here: the portal endpoint audits.
   */
  async patientAppointments(organizationId: string, patientId: string, now = new Date()) {
    const since = new Date(now.getTime() - 365 * 86_400_000);
    const rows = await this.db
      .select({
        id: appointment.id,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        status: appointment.status,
        reason: appointment.reason,
        version: appointment.version,
        facilityId: appointment.facilityId,
        practitionerId: appointment.practitionerId,
        visitTypeId: appointment.visitTypeId,
        bookedByPatient: appointment.bookedByPatient,
        visitType: visitType.name,
        modality: visitType.modality,
        onlineBooking: visitType.onlineBooking,
        practitionerName: practitioner.displayName,
        facilityName: facility.name,
        timeZone: facility.timezone,
      })
      .from(appointment)
      .innerJoin(visitType, eq(visitType.id, appointment.visitTypeId))
      .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
      .innerJoin(facility, eq(facility.id, appointment.facilityId))
      .where(and(eq(appointment.organizationId, organizationId), filedAsPatient(appointment.patientId, patientId), gte(appointment.startsAt, since)))
      .orderBy(asc(appointment.startsAt))
      .limit(200);
    const changeable = (r: { status: (typeof rows)[number]["status"]; startsAt: Date }) => canApply("cancel", r.status) && patientMayChange(r.startsAt, now);
    return {
      // What the patient may still do themselves in MyHealth (the API enforces the same rules).
      upcoming: rows
        .filter((r) => r.endsAt >= now)
        .map(({ onlineBooking, ...r }) => ({ ...r, canCancel: changeable(r), canReschedule: changeable(r) && onlineBooking })),
      past: rows
        .filter((r) => r.endsAt < now)
        .reverse()
        .map(({ onlineBooking: _onlineBooking, ...r }) => ({ ...r, canCancel: false, canReschedule: false })),
    };
  }

  /** Practitioner display names by id (ordering provider labels). */
  async practitionerNames(organizationId: string, practitionerIds: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (practitionerIds.length === 0) return names;
    const rows = await this.db
      .select({ id: practitioner.id, displayName: practitioner.displayName })
      .from(practitioner)
      .where(and(eq(practitioner.organizationId, organizationId), inArray(practitioner.id, practitionerIds)));
    for (const row of rows) names.set(row.id, row.displayName);
    return names;
  }

  /** The staff account linked to a practitioner, if any. */
  async practitionerUserId(organizationId: string, practitionerId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ userId: practitioner.userId })
      .from(practitioner)
      .where(and(eq(practitioner.organizationId, organizationId), eq(practitioner.id, practitionerId)));
    return row?.userId ?? null;
  }

  async encounter(organizationId: string, encounterId: string) {
    const [row] = await this.db
      .select()
      .from(encounter)
      .where(and(eq(encounter.organizationId, organizationId), eq(encounter.id, encounterId)));
    return row;
  }

  /** What billing needs from a signed encounter: the visit type's code and the local service date. */
  async billableEncounter(organizationId: string, encounterId: string) {
    const [row] = await this.db
      .select({
        id: encounter.id,
        patientId: encounter.patientId,
        facilityId: encounter.facilityId,
        status: encounter.status,
        at: sql<Date>`coalesce(${encounter.completedAt}, ${encounter.startedAt})`,
        visitTypeCode: visitType.code,
        timeZone: facility.timezone,
      })
      .from(encounter)
      .innerJoin(facility, eq(facility.id, encounter.facilityId))
      .leftJoin(visit, eq(visit.id, encounter.visitId))
      .leftJoin(visitType, eq(visitType.id, visit.visitTypeId))
      .where(and(eq(encounter.organizationId, organizationId), eq(encounter.id, encounterId)));
    if (!row) return undefined;
    return {
      id: row.id,
      patientId: row.patientId,
      facilityId: row.facilityId,
      status: row.status,
      visitTypeCode: row.visitTypeCode,
      serviceDate: localDate(new Date(row.at), row.timeZone),
    };
  }

  allergySummary(organizationId: string, patientId: string) {
    return this.triage.allergySummary(organizationId, patientId);
  }

  /** Clinical snapshot for Patient 360: allergies, problem list, recent care, latest vitals, upcoming visits. */
  async clinicalSummary(organizationId: string, patientId: string) {
    const [allergies, problems, encounters, vitals, upcoming] = await Promise.all([
      this.allergySummary(organizationId, patientId),
      this.db
        .select()
        .from(diagnosis)
        .where(
          and(
            eq(diagnosis.organizationId, organizationId),
            filedAsPatient(diagnosis.patientId, patientId),
            eq(diagnosis.status, "active"),
            or(eq(diagnosis.isChronic, true), gte(diagnosis.recordedAt, new Date(Date.now() - 90 * 86_400_000))),
          ),
        )
        .orderBy(desc(diagnosis.isChronic), desc(diagnosis.recordedAt))
        .limit(50),
      this.db
        .select()
        .from(encounter)
        .where(
          and(
            eq(encounter.organizationId, organizationId),
            filedAsPatient(encounter.patientId, patientId),
            inArray(encounter.status, ["in_progress", "completed"]),
          ),
        )
        .orderBy(desc(encounter.startedAt))
        .limit(5),
      this.db
        .select()
        .from(vitalSignSet)
        .where(and(eq(vitalSignSet.organizationId, organizationId), filedAsPatient(vitalSignSet.patientId, patientId), eq(vitalSignSet.status, "final")))
        .orderBy(desc(vitalSignSet.measuredAt))
        .limit(3),
      this.db
        .select()
        .from(appointment)
        .where(
          and(
            eq(appointment.organizationId, organizationId),
            filedAsPatient(appointment.patientId, patientId),
            inArray(appointment.status, ["booked", "confirmed"]),
            gte(appointment.startsAt, new Date()),
          ),
        )
        .orderBy(asc(appointment.startsAt))
        .limit(5),
    ]);
    return {
      allergies,
      problemList: problems.map(publicView),
      recentEncounters: encounters.map(publicView),
      latestVitals: vitals.map(toVitalsView),
      upcomingAppointments: upcoming.map(publicView),
    };
  }

  /**
   * The patient's whole clinic record for a record export (FHIR): encounters with their visit type, diagnoses,
   * allergies (with their source) and the latest allergy review, vital signs, appointments and the external history
   * accepted from imports. Not audited here: the caller audits.
   */
  async patientRecord(organizationId: string, patientId: string) {
    const [encounters, diagnoses, allergies, [review], vitals, appointments, externalHistory] = await Promise.all([
      this.db
        .select({ encounter, visitTypeName: visitType.name })
        .from(encounter)
        .leftJoin(visit, eq(visit.id, encounter.visitId))
        .leftJoin(visitType, eq(visitType.id, visit.visitTypeId))
        .where(and(eq(encounter.organizationId, organizationId), filedAsPatient(encounter.patientId, patientId)))
        .orderBy(asc(encounter.startedAt)),
      this.db
        .select()
        .from(diagnosis)
        .where(and(eq(diagnosis.organizationId, organizationId), filedAsPatient(diagnosis.patientId, patientId)))
        .orderBy(asc(diagnosis.recordedAt)),
      this.db
        .select()
        .from(allergyIntolerance)
        .where(and(eq(allergyIntolerance.organizationId, organizationId), filedAsPatient(allergyIntolerance.patientId, patientId)))
        .orderBy(asc(allergyIntolerance.recordedAt)),
      this.db
        .select()
        .from(allergyReview)
        .where(and(eq(allergyReview.organizationId, organizationId), filedAsPatient(allergyReview.patientId, patientId)))
        .orderBy(desc(allergyReview.reviewedAt))
        .limit(1),
      this.db
        .select()
        .from(vitalSignSet)
        .where(and(eq(vitalSignSet.organizationId, organizationId), filedAsPatient(vitalSignSet.patientId, patientId)))
        .orderBy(asc(vitalSignSet.measuredAt)),
      this.db
        .select({ appointment, visitTypeName: visitType.name, modality: visitType.modality, practitionerName: practitioner.displayName })
        .from(appointment)
        .innerJoin(visitType, eq(visitType.id, appointment.visitTypeId))
        .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
        .where(and(eq(appointment.organizationId, organizationId), filedAsPatient(appointment.patientId, patientId)))
        .orderBy(asc(appointment.startsAt)),
      this.db
        .select({
          id: externalHistoryEntry.id,
          kind: externalHistoryEntry.kind,
          category: externalHistoryEntry.category,
          display: externalHistoryEntry.display,
          codeSystem: externalHistoryEntry.codeSystem,
          code: externalHistoryEntry.code,
          valueText: externalHistoryEntry.valueText,
          statusText: externalHistoryEntry.statusText,
          effectiveText: externalHistoryEntry.effectiveText,
          declaredSource: externalHistoryEntry.declaredSource,
          status: externalHistoryEntry.status,
          recordedAt: externalHistoryEntry.recordedAt,
          enteredInErrorAt: externalHistoryEntry.enteredInErrorAt,
        })
        .from(externalHistoryEntry)
        .where(and(eq(externalHistoryEntry.organizationId, organizationId), filedAsPatient(externalHistoryEntry.patientId, patientId)))
        .orderBy(asc(externalHistoryEntry.recordedAt)),
    ]);
    return {
      encounters: encounters.map((r) => ({ ...r.encounter, visitTypeName: r.visitTypeName })),
      diagnoses,
      allergies,
      allergyReview: review ?? null,
      vitals,
      appointments: appointments.map((r) => ({ ...r.appointment, visitTypeName: r.visitTypeName, modality: r.modality, practitionerName: r.practitionerName })),
      /** Accepted from imports: labelled external records, never the clinic's own (entries in error included, marked). */
      externalHistory,
    };
  }

  /**
   * The note of each of the patient's signed consultations as it stands: the latest signed or amendment revision (never
   * a draft), for a copy of the record. Not audited here: the caller audits.
   */
  async signedNotes(organizationId: string, patientId: string) {
    const rows = await this.db
      .selectDistinctOn([encounterNoteRevision.encounterId], {
        encounterId: encounterNoteRevision.encounterId,
        revisionNumber: encounterNoteRevision.revisionNumber,
        kind: encounterNoteRevision.kind,
        subjective: encounterNoteRevision.subjective,
        objective: encounterNoteRevision.objective,
        assessment: encounterNoteRevision.assessment,
        plan: encounterNoteRevision.plan,
        amendmentReason: encounterNoteRevision.amendmentReason,
        authoredAt: encounterNoteRevision.authoredAt,
      })
      .from(encounterNoteRevision)
      .innerJoin(encounter, eq(encounter.id, encounterNoteRevision.encounterId))
      .where(
        and(
          eq(encounterNoteRevision.organizationId, organizationId),
          eq(encounter.patientId, patientId),
          inArray(encounterNoteRevision.kind, ["signed", "amendment"]),
        ),
      )
      .orderBy(encounterNoteRevision.encounterId, desc(encounterNoteRevision.revisionNumber));
    return new Map(rows.map((r) => [r.encounterId, r]));
  }

  /** Diagnoses recorded in the given encounters (claim preparation). Not audited here. */
  diagnosesForEncounters(organizationId: string, encounterIds: string[]) {
    if (encounterIds.length === 0) return Promise.resolve([]);
    return this.db
      .select()
      .from(diagnosis)
      .where(and(eq(diagnosis.organizationId, organizationId), inArray(diagnosis.encounterId, encounterIds)))
      .orderBy(asc(diagnosis.recordedAt));
  }

  /** One diagnosis with its encounter, facility and clinician (case reporting). Not audited here. */
  async diagnosisWithEncounter(organizationId: string, diagnosisId: string) {
    const [row] = await this.db
      .select({ diagnosis, encounter, facilityName: facility.name, practitionerName: practitioner.displayName })
      .from(diagnosis)
      .innerJoin(encounter, eq(encounter.id, diagnosis.encounterId))
      .innerJoin(facility, eq(facility.id, encounter.facilityId))
      .leftJoin(practitioner, eq(practitioner.id, encounter.practitionerId))
      .where(and(eq(diagnosis.organizationId, organizationId), eq(diagnosis.id, diagnosisId)));
    return row;
  }

  /**
   * Coded diagnoses recorded in [start, end), not entered in error, in (recorded_at, id) order after the cursor — for
   * checking earlier diagnoses against DOH reportable-condition rules. `recordedAt` is returned as text at full
   * (microsecond) precision so it can serve as the next page's cursor.
   */
  codedDiagnosesRecorded(
    organizationId: string,
    range: { start: Date; end: Date },
    after: { recordedAt: string; diagnosisId: string } | null,
    limit: number,
  ): Promise<Array<{ id: string; codeSystemKey: string | null; code: string; recordedAt: string }>> {
    return this.db
      .select({
        id: diagnosis.id,
        codeSystemKey: diagnosis.codeSystemKey,
        code: sql<string>`${diagnosis.code}`,
        recordedAt: sql<string>`${diagnosis.recordedAt}::text`,
      })
      .from(diagnosis)
      .where(
        and(
          eq(diagnosis.organizationId, organizationId),
          gte(diagnosis.recordedAt, range.start),
          lt(diagnosis.recordedAt, range.end),
          isNotNull(diagnosis.code),
          ne(diagnosis.status, "entered_in_error"),
          after ? sql`(${diagnosis.recordedAt}, ${diagnosis.id}) > (${after.recordedAt}::timestamptz, ${after.diagnosisId}::uuid)` : undefined,
        ),
      )
      .orderBy(asc(diagnosis.recordedAt), asc(diagnosis.id))
      .limit(limit);
  }

  /**
   * Encounters of practitioners of one profession (e.g. dentists) started at a facility on a local date, earliest
   * first (the dental worklist). Encounters entered in error are left out.
   */
  async encountersOfProfession(organizationId: string, facilityId: string, date: string, profession: (typeof practitioner.$inferSelect)["profession"]) {
    const [site] = await this.db.select({ timezone: facility.timezone }).from(facility).where(eq(facility.id, facilityId));
    if (!site) return [];
    const { start, end } = localDayBounds(date, site.timezone);
    return this.db
      .select({
        encounterId: encounter.id,
        patientId: encounter.patientId,
        practitionerId: encounter.practitionerId,
        practitionerName: practitioner.displayName,
        status: encounter.status,
        startedAt: encounter.startedAt,
        chiefComplaint: encounter.chiefComplaint,
      })
      .from(encounter)
      .innerJoin(practitioner, eq(practitioner.id, encounter.practitionerId))
      .where(
        and(
          eq(encounter.organizationId, organizationId),
          eq(encounter.facilityId, facilityId),
          eq(practitioner.profession, profession),
          ne(encounter.status, "entered_in_error"),
          gte(encounter.startedAt, start),
          lt(encounter.startedAt, end),
        ),
      )
      .orderBy(asc(encounter.startedAt));
  }

  // ---- Patient timeline (composed in apps/api) ----------------------------------------------------------------
  // Each returns at most `window.limit` rows of one source, newest first, with ids, times, statuses and short display
  // fields only: no notes, reasons, complaints or other free text. Not audited here: the caller audits.

  /** Appointments at their scheduled start (cancelled and no-show ones included, with their status). */
  timelineAppointments(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = appointment.startsAt;
    return this.db
      .select({
        id: appointment.id,
        patientId: appointment.patientId,
        at: timelineInstant(at),
        facilityId: appointment.facilityId,
        status: appointment.status,
        modality: visitType.modality,
        visitTypeName: visitType.name,
        practitionerId: appointment.practitionerId,
        practitionerName: practitioner.displayName,
        bookedByPatient: appointment.bookedByPatient,
      })
      .from(appointment)
      .innerJoin(visitType, eq(visitType.id, appointment.visitTypeId))
      .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId))
      .where(
        and(
          eq(appointment.organizationId, organizationId),
          filedAsPatient(appointment.patientId, patientId),
          timelineFacility(appointment.facilityId, window),
          timelineRange("appointment", at, appointment.id, window),
        ),
      )
      .orderBy(desc(at), desc(appointment.id))
      .limit(window.limit);
  }

  /**
   * Encounters (in person or online) at their start, with the codes of their diagnoses (never the diagnosis text or
   * notes). Entered-in-error encounters are included with their status; diagnoses entered in error are left out.
   */
  timelineEncounters(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = encounter.startedAt;
    return this.db
      .select({
        id: encounter.id,
        patientId: encounter.patientId,
        at: timelineInstant(at),
        facilityId: encounter.facilityId,
        status: encounter.status,
        modality: encounter.modality,
        visitTypeName: visitType.name,
        practitionerName: practitioner.displayName,
        appointmentId: encounter.appointmentId,
        completedAt: encounter.completedAt,
        // The outer table is named literally (Drizzle leaves columns unqualified when a select has no joins).
        diagnosisCount: sql<number>`(SELECT count(*)::int FROM ${diagnosis} d WHERE d.encounter_id = encounter.id AND d.status <> 'entered_in_error')`,
        diagnosisCodes: sql<string[]>`coalesce((SELECT array_agg(d.code ORDER BY d.rank = 'primary' DESC, d.recorded_at) FROM ${diagnosis} d
          WHERE d.encounter_id = encounter.id AND d.status <> 'entered_in_error' AND d.code IS NOT NULL), '{}')`,
      })
      .from(encounter)
      .innerJoin(practitioner, eq(practitioner.id, encounter.practitionerId))
      .leftJoin(visit, eq(visit.id, encounter.visitId))
      .leftJoin(visitType, eq(visitType.id, visit.visitTypeId))
      .where(
        and(
          eq(encounter.organizationId, organizationId),
          filedAsPatient(encounter.patientId, patientId),
          timelineFacility(encounter.facilityId, window),
          timelineRange("encounter", at, encounter.id, window),
        ),
      )
      .orderBy(desc(at), desc(encounter.id))
      .limit(window.limit);
  }

  /** Vital sign sets at the time measured (no values: the record shows them). */
  timelineVitals(organizationId: string, patientId: string, window: TimelineWindow) {
    const at = vitalSignSet.measuredAt;
    return this.db
      .select({
        id: vitalSignSet.id,
        patientId: vitalSignSet.patientId,
        at: timelineInstant(at),
        facilityId: vitalSignSet.facilityId,
        status: vitalSignSet.status,
        encounterId: vitalSignSet.encounterId,
        visitId: vitalSignSet.visitId,
      })
      .from(vitalSignSet)
      .where(
        and(
          eq(vitalSignSet.organizationId, organizationId),
          filedAsPatient(vitalSignSet.patientId, patientId),
          timelineFacility(vitalSignSet.facilityId, window),
          timelineRange("vitals", at, vitalSignSet.id, window),
        ),
      )
      .orderBy(desc(at), desc(vitalSignSet.id))
      .limit(window.limit);
  }

  /**
   * External history accepted from imports, when it was accepted (the other provider's dates are free text). Kind,
   * code and declared source only. Entries have no facility, so a facility filter leaves them out.
   */
  timelineExternalHistory(organizationId: string, patientId: string, window: TimelineWindow) {
    if (window.facilityIds) return Promise.resolve([]);
    const at = externalHistoryEntry.recordedAt;
    return this.db
      .select({
        id: externalHistoryEntry.id,
        patientId: externalHistoryEntry.patientId,
        at: timelineInstant(at),
        kind: externalHistoryEntry.kind,
        codeSystem: externalHistoryEntry.codeSystem,
        code: externalHistoryEntry.code,
        declaredSource: externalHistoryEntry.declaredSource,
        status: externalHistoryEntry.status,
      })
      .from(externalHistoryEntry)
      .where(
        and(
          eq(externalHistoryEntry.organizationId, organizationId),
          filedAsPatient(externalHistoryEntry.patientId, patientId),
          timelineRange("external_history", at, externalHistoryEntry.id, window),
        ),
      )
      .orderBy(desc(at), desc(externalHistoryEntry.id))
      .limit(window.limit);
  }

  // ---- Patient 360 workspace (composed in apps/api) ------------------------------------------------------------
  // Short display fields only: never notes, complaints, reasons or diagnosis notes. Not audited here: the caller audits.

  /**
   * The patient's consultations in progress (any facility, at most `limit`, latest first) and recent consultations
   * (in progress or signed; entered-in-error ones left out), each with its visit type, clinician (and the clinician's
   * staff account, so the caller can tell "mine" without exposing it) and whether a note draft exists; recent ones
   * carry their diagnoses (code and display, none entered in error).
   */
  async workspaceEncounters(organizationId: string, patientId: string, limits: { open: number; recent: number }) {
    const columns = {
      id: encounter.id,
      patientId: encounter.patientId,
      facilityId: encounter.facilityId,
      status: encounter.status,
      modality: encounter.modality,
      appointmentId: encounter.appointmentId,
      startedAt: encounter.startedAt,
      completedAt: encounter.completedAt,
      practitionerId: encounter.practitionerId,
      practitionerName: practitioner.displayName,
      practitionerUserId: practitioner.userId,
      visitTypeName: visitType.name,
      // The outer table is named literally (Drizzle leaves columns unqualified in some selects).
      hasNoteDraft: sql<boolean>`EXISTS (SELECT 1 FROM ${encounterNoteRevision} r WHERE r.encounter_id = ${encounter.id} AND r.kind = 'draft')`,
    };
    const base = () =>
      this.db
        .select(columns)
        .from(encounter)
        .innerJoin(practitioner, eq(practitioner.id, encounter.practitionerId))
        .leftJoin(visit, eq(visit.id, encounter.visitId))
        .leftJoin(visitType, eq(visitType.id, visit.visitTypeId));
    const scope = and(eq(encounter.organizationId, organizationId), filedAsPatient(encounter.patientId, patientId));
    const [open, recent] = await Promise.all([
      base()
        .where(and(scope, eq(encounter.status, "in_progress")))
        .orderBy(desc(encounter.startedAt), desc(encounter.id))
        .limit(limits.open),
      base()
        .where(and(scope, ne(encounter.status, "entered_in_error")))
        .orderBy(desc(encounter.startedAt), desc(encounter.id))
        .limit(limits.recent),
    ]);
    const ids = [...new Set([...open, ...recent].map((e) => e.id))];
    const diagnoses = ids.length
      ? await this.db
          .select({
            id: diagnosis.id,
            encounterId: diagnosis.encounterId,
            codeSystemKey: diagnosis.codeSystemKey,
            code: diagnosis.code,
            display: diagnosis.display,
            rank: diagnosis.rank,
            certainty: diagnosis.certainty,
            isChronic: diagnosis.isChronic,
            status: diagnosis.status,
          })
          .from(diagnosis)
          .where(and(eq(diagnosis.organizationId, organizationId), inArray(diagnosis.encounterId, ids), ne(diagnosis.status, "entered_in_error")))
          .orderBy(sql`${diagnosis.rank} = 'primary' DESC`, asc(diagnosis.recordedAt))
      : [];
    const withDiagnoses = <T extends { id: string }>(e: T) => ({ ...e, diagnoses: diagnoses.filter((d) => d.encounterId === e.id) });
    return { open: open.map(withDiagnoses), recent: recent.map(withDiagnoses) };
  }

  /**
   * The patient's visit in today's queue at a facility that has not ended yet (waiting, in triage, awaiting or in
   * consultation), if any: what a consultation can be started from. No complaint or notes.
   */
  async workspaceActiveVisit(organizationId: string, patientId: string, facilityId: string) {
    const [site] = await this.db.select({ timezone: facility.timezone }).from(facility).where(eq(facility.id, facilityId));
    if (!site) return null;
    const [row] = await this.db
      .select({
        id: visit.id,
        facilityId: visit.facilityId,
        status: visit.status,
        queueNumber: visit.queueNumber,
        queueDate: visit.queueDate,
        priority: visit.priority,
        appointmentId: visit.appointmentId,
        checkedInAt: visit.checkedInAt,
        modality: visitType.modality,
        visitTypeName: visitType.name,
      })
      .from(visit)
      .innerJoin(visitType, eq(visitType.id, visit.visitTypeId))
      .where(
        and(
          eq(visit.organizationId, organizationId),
          filedAsPatient(visit.patientId, patientId),
          eq(visit.facilityId, facilityId),
          eq(visit.queueDate, localDate(new Date(), site.timezone)),
          inArray(visit.status, ["waiting", "in_triage", "awaiting_consultation", "in_consultation"]),
        ),
      )
      .orderBy(desc(visit.checkedInAt))
      .limit(1);
    return row ?? null;
  }

  // ---- Patient merge (composed in apps/api) --------------------------------------------------------------------

  /**
   * Work in progress filed under exactly this record id that a merge would strand: consultations in progress, queue
   * visits not ended, and booked or confirmed appointments that have not ended (reminders are never sent to a merged
   * record). Short display fields only.
   */
  async mergeWorkInProgress(organizationId: string, patientId: string) {
    const [encounters, visits, appointments] = await Promise.all([
      this.db
        .select({ id: encounter.id, modality: encounter.modality, startedAt: encounter.startedAt, practitionerName: practitioner.displayName })
        .from(encounter)
        .innerJoin(practitioner, eq(practitioner.id, encounter.practitionerId))
        .where(and(eq(encounter.organizationId, organizationId), eq(encounter.patientId, patientId), eq(encounter.status, "in_progress")))
        .orderBy(asc(encounter.startedAt)),
      this.db
        .select({ id: visit.id, queueDate: visit.queueDate, queueNumber: visit.queueNumber, status: visit.status, checkedInAt: visit.checkedInAt })
        .from(visit)
        .where(
          and(
            eq(visit.organizationId, organizationId),
            eq(visit.patientId, patientId),
            inArray(visit.status, ["waiting", "in_triage", "awaiting_consultation", "in_consultation"]),
          ),
        )
        .orderBy(asc(visit.checkedInAt)),
      this.db
        .select({ id: appointment.id, startsAt: appointment.startsAt, status: appointment.status, visitTypeName: visitType.name })
        .from(appointment)
        .innerJoin(visitType, eq(visitType.id, appointment.visitTypeId))
        .where(
          and(
            eq(appointment.organizationId, organizationId),
            eq(appointment.patientId, patientId),
            inArray(appointment.status, ["booked", "confirmed"]),
            gte(appointment.endsAt, new Date()),
          ),
        )
        .orderBy(asc(appointment.startsAt)),
    ]);
    return { encounters, visits, appointments };
  }

  /** Practitioner records by id (record exports). */
  practitioners(organizationId: string, practitionerIds: string[]) {
    if (practitionerIds.length === 0) return Promise.resolve([]);
    return this.db
      .select()
      .from(practitioner)
      .where(and(eq(practitioner.organizationId, organizationId), inArray(practitioner.id, practitionerIds)));
  }
}
