import { Inject, Injectable } from "@nestjs/common";
import { type Actor, DATABASE, type Database, localDayBounds, NotFoundError, filedAsPatient } from "@healthcare/core";
import { facility } from "@healthcare/organization";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { appointment, encounter, practitioner, visit, visitType } from "../clinic.schema";
import { EncounterService } from "../encounters/encounter.service";
import { PATIENT_DIRECTORY, type PatientDirectory } from "../ports";
import { VisitService } from "../queue/visit.service";

/**
 * What the telemedicine domain needs from the clinic, exported for the app's
 * adapter: online appointments, the patient's own check-in to the waiting
 * room, and starting a telemedicine encounter (the same encounter model as in
 * person, modality "telemedicine"). Reads are not audited here; callers audit.
 */
@Injectable()
export class OnlineVisitService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly visits: VisitService,
    private readonly encounters: EncounterService,
    @Inject(PATIENT_DIRECTORY) private readonly patients: PatientDirectory,
  ) {}

  async appointment(organizationId: string, appointmentId: string) {
    const [row] = await this.baseQuery().where(and(eq(appointment.organizationId, organizationId), eq(appointment.id, appointmentId)));
    return row;
  }

  /** Online appointments of one facility on one local day, with their visit and encounter. */
  async day(organizationId: string, facilityId: string, date: string) {
    const [tz] = await this.db.select({ timezone: facility.timezone }).from(facility).where(eq(facility.id, facilityId));
    if (!tz) throw new NotFoundError("Facility");
    const { start, end } = localDayBounds(date, tz.timezone);
    const rows = await this.baseQuery()
      .where(
        and(
          eq(appointment.organizationId, organizationId),
          eq(appointment.facilityId, facilityId),
          eq(visitType.modality, "telemedicine"),
          gte(appointment.startsAt, start),
          lt(appointment.startsAt, end),
        ),
      )
      .orderBy(asc(appointment.startsAt));
    const appointmentIds = rows.map((r) => r.id);
    const visits = appointmentIds.length
      ? await this.db
          .select({ id: visit.id, appointmentId: visit.appointmentId, status: visit.status, encounterId: encounter.id })
          .from(visit)
          .leftJoin(encounter, eq(encounter.visitId, visit.id))
          .where(inArray(visit.appointmentId, appointmentIds))
      : [];
    const patients = await this.patients.summaries(organizationId, [...new Set(rows.map((r) => r.patientId))]);
    return rows.map((r) => {
      const v = visits.find((x) => x.appointmentId === r.id);
      return { ...r, visitId: v?.id ?? null, visitStatus: v?.status ?? null, encounterId: v?.encounterId ?? null, patient: patients.get(r.patientId) ?? null };
    });
  }

  /** A patient's online appointments from yesterday on (for the portal). */
  async patientOnline(organizationId: string, patientId: string, now = new Date()) {
    return this.baseQuery()
      .where(
        and(
          eq(appointment.organizationId, organizationId),
          filedAsPatient(appointment.patientId, patientId),
          eq(visitType.modality, "telemedicine"),
          gte(appointment.endsAt, new Date(now.getTime() - 86_400_000)),
        ),
      )
      .orderBy(asc(appointment.startsAt))
      .limit(50);
  }

  async encounterForVisit(organizationId: string, visitId: string) {
    const [row] = await this.db
      .select({ id: encounter.id, status: encounter.status })
      .from(encounter)
      .where(and(eq(encounter.organizationId, organizationId), eq(encounter.visitId, visitId)));
    return row;
  }

  /** The patient enters the waiting room (idempotent). */
  checkIn(organizationId: string, appointmentId: string) {
    return this.visits.checkInOnline(organizationId, appointmentId);
  }

  /** Starts the telemedicine encounter for a checked-in online visit (the clinician's permission and identity are checked by the encounter service). */
  startEncounter(actor: Actor, visitId: string) {
    return this.encounters.startOnline(actor, visitId);
  }

  async encounterStatus(organizationId: string, encounterId: string) {
    const [row] = await this.db
      .select({ id: encounter.id, status: encounter.status, practitionerId: encounter.practitionerId })
      .from(encounter)
      .where(and(eq(encounter.organizationId, organizationId), eq(encounter.id, encounterId)));
    return row;
  }

  private baseQuery() {
    return this.db
      .select({
        id: appointment.id,
        patientId: appointment.patientId,
        facilityId: appointment.facilityId,
        practitionerId: appointment.practitionerId,
        practitionerName: practitioner.displayName,
        practitionerUserId: practitioner.userId,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        status: appointment.status,
        reason: appointment.reason,
        modality: visitType.modality,
        visitTypeName: visitType.name,
        timeZone: facility.timezone,
      })
      .from(appointment)
      .innerJoin(visitType, eq(visitType.id, appointment.visitTypeId))
      .innerJoin(facility, eq(facility.id, appointment.facilityId))
      .innerJoin(practitioner, eq(practitioner.id, appointment.practitionerId));
  }
}
