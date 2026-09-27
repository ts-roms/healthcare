import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, asc, desc, eq, gte, inArray, or } from "drizzle-orm";
import { facility } from "@healthcare/organization";
import { appointment, diagnosis, encounter, practitioner, visitType, vitalSignSet } from "./clinic.schema";
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
      .where(and(eq(appointment.organizationId, organizationId), eq(appointment.patientId, patientId), gte(appointment.startsAt, since)))
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
            eq(diagnosis.patientId, patientId),
            eq(diagnosis.status, "active"),
            or(eq(diagnosis.isChronic, true), gte(diagnosis.recordedAt, new Date(Date.now() - 90 * 86_400_000))),
          ),
        )
        .orderBy(desc(diagnosis.isChronic), desc(diagnosis.recordedAt))
        .limit(50),
      this.db
        .select()
        .from(encounter)
        .where(and(eq(encounter.organizationId, organizationId), eq(encounter.patientId, patientId), inArray(encounter.status, ["in_progress", "completed"])))
        .orderBy(desc(encounter.startedAt))
        .limit(5),
      this.db
        .select()
        .from(vitalSignSet)
        .where(and(eq(vitalSignSet.organizationId, organizationId), eq(vitalSignSet.patientId, patientId), eq(vitalSignSet.status, "final")))
        .orderBy(desc(vitalSignSet.measuredAt))
        .limit(3),
      this.db
        .select()
        .from(appointment)
        .where(
          and(
            eq(appointment.organizationId, organizationId),
            eq(appointment.patientId, patientId),
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
}
