import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, reportingDay, reportingFacility, reportingRange, type ReportingWindow } from "@healthcare/core";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { appointment, encounter, practitioner, visit } from "../clinic.schema";

/**
 * Clinic figures for management reporting over a window (composed with other domains' figures in the API). Counts
 * only: no patient is named. Entered-in-error encounters and cancelled appointments are left out of the totals.
 */
@Injectable()
export class ClinicReportingQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async figures(organizationId: string, window: ReportingWindow) {
    const [appointments, visits, encounters, returning, providers, daily] = await Promise.all([
      this.db
        .select({
          booked: sql<number>`count(*) filter (where ${appointment.status} <> 'cancelled')::int`,
          completed: sql<number>`count(*) filter (where ${appointment.status} = 'completed')::int`,
          noShow: sql<number>`count(*) filter (where ${appointment.status} = 'no_show')::int`,
          cancelled: sql<number>`count(*) filter (where ${appointment.status} = 'cancelled')::int`,
          selfBooked: sql<number>`count(*) filter (where ${appointment.bookedByPatient} and ${appointment.status} <> 'cancelled')::int`,
        })
        .from(appointment)
        .where(
          and(eq(appointment.organizationId, organizationId), reportingRange(appointment.startsAt, window), reportingFacility(appointment.facilityId, window)),
        ),
      this.db
        .select({
          checkedIn: sql<number>`count(*)::int`,
          walkIns: sql<number>`count(*) filter (where ${visit.arrivalMode} = 'walk_in')::int`,
          leftWithoutBeingSeen: sql<number>`count(*) filter (where ${visit.status} = 'left_without_being_seen')::int`,
          averageWaitMinutes: sql<
            number | null
          >`round(avg(extract(epoch from ${visit.consultationStartedAt} - ${visit.checkedInAt}) / 60) filter (where ${visit.consultationStartedAt} is not null))::int`,
        })
        .from(visit)
        .where(and(eq(visit.organizationId, organizationId), reportingRange(visit.checkedInAt, window), reportingFacility(visit.facilityId, window))),
      this.db
        .select({
          completed: sql<number>`count(*)::int`,
          telemedicine: sql<number>`count(*) filter (where ${encounter.modality} = 'telemedicine')::int`,
          patientsSeen: sql<number>`count(distinct ${encounter.patientId})::int`,
        })
        .from(encounter)
        .where(this.completedEncounters(organizationId, window)),
      // Patients seen in the window who had a completed encounter before it (anywhere in the organization).
      this.db
        .select({ patients: sql<number>`count(distinct ${encounter.patientId})::int` })
        .from(encounter)
        .where(
          and(
            this.completedEncounters(organizationId, window),
            sql`exists (select 1 from ${encounter} earlier where earlier.organization_id = ${encounter.organizationId}
              and earlier.patient_id = ${encounter.patientId} and earlier.status = 'completed'
              and earlier.completed_at < ${window.from.toISOString()}::timestamptz)`,
          ),
        ),
      this.providerFigures(organizationId, window),
      this.db
        .select({ date: reportingDay(encounter.completedAt, window), encounters: sql<number>`count(*)::int` })
        .from(encounter)
        .where(this.completedEncounters(organizationId, window))
        .groupBy(sql`1`),
    ]);
    const a = appointments[0] ?? { booked: 0, completed: 0, noShow: 0, cancelled: 0, selfBooked: 0 };
    const e = encounters[0] ?? { completed: 0, telemedicine: 0, patientsSeen: 0 };
    return {
      appointments: { ...a, noShowRate: a.booked ? Math.round((a.noShow / a.booked) * 1000) / 1000 : null },
      visits: visits[0] ?? { checkedIn: 0, walkIns: 0, leftWithoutBeingSeen: 0, averageWaitMinutes: null },
      encounters: { ...e, returningPatients: returning[0]?.patients ?? 0 },
      providers,
      daily: daily.sort((x, y) => x.date.localeCompare(y.date)),
    };
  }

  private completedEncounters(organizationId: string, window: ReportingWindow) {
    return and(
      eq(encounter.organizationId, organizationId),
      eq(encounter.status, "completed"),
      reportingRange(encounter.completedAt, window),
      reportingFacility(encounter.facilityId, window),
    );
  }

  /** Per practitioner: completed encounters, appointments booked (not cancelled) and no-shows; busiest first. */
  private async providerFigures(organizationId: string, window: ReportingWindow) {
    const [seen, booked] = await Promise.all([
      this.db
        .select({
          practitionerId: encounter.practitionerId,
          encounters: sql<number>`count(*)::int`,
          patients: sql<number>`count(distinct ${encounter.patientId})::int`,
        })
        .from(encounter)
        .where(this.completedEncounters(organizationId, window))
        .groupBy(encounter.practitionerId),
      this.db
        .select({
          practitionerId: appointment.practitionerId,
          appointments: sql<number>`count(*)::int`,
          noShows: sql<number>`count(*) filter (where ${appointment.status} = 'no_show')::int`,
        })
        .from(appointment)
        .where(
          and(
            eq(appointment.organizationId, organizationId),
            ne(appointment.status, "cancelled"),
            reportingRange(appointment.startsAt, window),
            reportingFacility(appointment.facilityId, window),
          ),
        )
        .groupBy(appointment.practitionerId),
    ]);
    const ids = [...new Set([...seen, ...booked].map((r) => r.practitionerId).filter((id): id is string => !!id))];
    if (ids.length === 0) return [];
    const names = await this.db
      .select({ id: practitioner.id, displayName: practitioner.displayName })
      .from(practitioner)
      .where(and(eq(practitioner.organizationId, organizationId), inArray(practitioner.id, ids)))
      .orderBy(desc(practitioner.displayName));
    return ids
      .map((id) => {
        const s = seen.find((r) => r.practitionerId === id);
        const b = booked.find((r) => r.practitionerId === id);
        return {
          practitionerId: id,
          displayName: names.find((n) => n.id === id)?.displayName ?? "Practitioner",
          encounters: s?.encounters ?? 0,
          patients: s?.patients ?? 0,
          appointments: b?.appointments ?? 0,
          noShows: b?.noShows ?? 0,
        };
      })
      .sort((x, y) => y.encounters - x.encounters || y.appointments - x.appointments || x.displayName.localeCompare(y.displayName));
  }
}
