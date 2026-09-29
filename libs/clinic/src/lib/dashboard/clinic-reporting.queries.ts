import { Inject, Injectable } from "@nestjs/common";
import { canonicalPatientId, DATABASE, type Database, reportingDay, reportingFacility, reportingRange, type ReportingWindow } from "@healthcare/core";
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
          patientsSeen: sql<number>`count(distinct ${canonicalPatientId(encounter.patientId)})::int`,
        })
        .from(encounter)
        .where(this.completedEncounters(organizationId, window)),
      // Patients seen in the window who had a completed encounter before it (anywhere in the organization).
      this.db
        .select({ patients: sql<number>`count(distinct ${canonicalPatientId(encounter.patientId)})::int` })
        .from(encounter)
        .where(
          and(
            this.completedEncounters(organizationId, window),
            sql`exists (select 1 from ${encounter} earlier where earlier.organization_id = ${encounter.organizationId}
              and earlier.patient_id = ANY(patient_record_ids(${canonicalPatientId(encounter.patientId)})) and earlier.status = 'completed'
              and earlier.completed_at < ${window.from.toISOString()}::timestamptz)`,
          ),
        ),
      this.providerFigures(organizationId, window),
      this.db
        .select({
          date: reportingDay(encounter.completedAt, window),
          encounters: sql<number>`count(*)::int`,
          patientsSeen: sql<number>`count(distinct ${canonicalPatientId(encounter.patientId)})::int`,
        })
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

  /**
   * Per practitioner: completed encounters (and their distinct patients), appointments booked (not cancelled; no-shows
   * included) with their booked minutes, no-shows, and the schedule minutes available; busiest first.
   */
  private async providerFigures(organizationId: string, window: ReportingWindow) {
    const [seen, booked, availability] = await Promise.all([
      this.db
        .select({
          practitionerId: encounter.practitionerId,
          encounters: sql<number>`count(*)::int`,
          patients: sql<number>`count(distinct ${canonicalPatientId(encounter.patientId)})::int`,
        })
        .from(encounter)
        .where(this.completedEncounters(organizationId, window))
        .groupBy(encounter.practitionerId),
      this.db
        .select({
          practitionerId: appointment.practitionerId,
          appointments: sql<number>`count(*)::int`,
          noShows: sql<number>`count(*) filter (where ${appointment.status} = 'no_show')::int`,
          bookedMinutes: sql<number>`coalesce(sum(extract(epoch from ${appointment.endsAt} - ${appointment.startsAt}) / 60), 0)::int`,
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
      this.availableMinutes(organizationId, window),
    ]);
    const ids = [...new Set([...seen, ...booked, ...availability].map((r) => r.practitionerId).filter((id): id is string => !!id))];
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
          bookedMinutes: b?.bookedMinutes ?? 0,
          availableMinutes: availability.find((r) => r.practitionerId === id)?.availableMinutes ?? 0,
        };
      })
      .sort((x, y) => y.encounters - x.encounters || y.appointments - x.appointments || x.displayName.localeCompare(y.displayName));
  }

  /**
   * Schedule minutes available per practitioner: on each local day of the window, the weekly schedules at the
   * facilities in scope that were valid that day (a retired schedule until it was retired), less the practitioner's
   * leave and facility closures overlapping them (a multirange difference, so overlapping exceptions are not
   * subtracted twice). Schedule times are read in the window's time zone.
   */
  private async availableMinutes(organizationId: string, window: ReportingWindow): Promise<Array<{ practitionerId: string; availableMinutes: number }>> {
    const facilities = window.facilityIds ? sql`and ${reportingFacility(sql.raw("s.facility_id"), window)}` : sql``;
    const fromDate = sql`(${window.from.toISOString()}::timestamptz at time zone ${window.timeZone})::date`;
    const toDate = sql`((${window.to.toISOString()}::timestamptz - interval '1 microsecond') at time zone ${window.timeZone})::date`;
    const result = await this.db.execute<{ practitioner_id: string; available_minutes: number }>(sql`
      with days as (
        select d::date as day from generate_series(${fromDate}, ${toDate}, interval '1 day') as d
      ),
      slots as (
        select s.practitioner_id, s.facility_id,
               tstzrange((d.day + s.start_time) at time zone ${window.timeZone}, (d.day + s.end_time) at time zone ${window.timeZone}) as r
        from practitioner_schedule s
        join days d on extract(dow from d.day) = s.day_of_week and d.day >= s.valid_from and (s.valid_until is null or d.day <= s.valid_until)
        where s.organization_id = ${organizationId} ${facilities}
          and (s.retired_at is null or s.retired_at > (d.day::timestamp at time zone ${window.timeZone}))
      ),
      free as (
        select sl.practitioner_id,
               tstzmultirange(sl.r) - coalesce((
                 select range_agg(tstzrange(x.starts_at, x.ends_at))
                 from schedule_exception x
                 where x.organization_id = ${organizationId} and x.facility_id = sl.facility_id
                   and (x.practitioner_id is null or x.practitioner_id = sl.practitioner_id)
                   and tstzrange(x.starts_at, x.ends_at) && sl.r
               ), '{}'::tstzmultirange) as m
        from slots sl
      )
      select f.practitioner_id,
             coalesce(sum((select coalesce(sum(extract(epoch from upper(u) - lower(u)) / 60), 0) from unnest(f.m) as u)), 0)::int as available_minutes
      from free f
      group by 1`);
    return result.rows.map((r) => ({ practitionerId: r.practitioner_id, availableMinutes: r.available_minutes }));
  }

  /**
   * Retention counts over the patients seen (completed encounter) in the window at the facilities in scope: how many
   * also had a completed encounter there in the look-back before the window, and — for those whose first encounter in
   * the window is more than `returnWindowDays` before `asOfDate` (their follow-up window has fully elapsed) — how many
   * had another completed encounter there on a later local day, at most `returnWindowDays` after it. Counts only.
   */
  async retention(organizationId: string, window: ReportingWindow, params: { lookbackStart: Date; returnWindowDays: number; asOfDate: string }) {
    const facilities = window.facilityIds ? sql`and ${reportingFacility(sql.raw("e.facility_id"), window)}` : sql``;
    const scope = sql`e.organization_id = ${organizationId} and e.status = 'completed' ${facilities}`;
    const localDay = (column: string) => sql`(${sql.raw(column)} at time zone ${window.timeZone})::date`;
    const result = await this.db.execute<{ seen: number; retained: number; return_cohort: number; returned: number }>(sql`
      with idx as (
        select patient_canonical_id(e.patient_id) as patient_id, min(e.completed_at) as first_at
        from encounter e
        where ${scope} and ${reportingRange(sql.raw("e.completed_at"), window)}
        group by 1
      ),
      flagged as (
        select idx.patient_id,
               exists (
                 select 1 from encounter e
                 where ${scope} and e.patient_id = ANY(patient_record_ids(idx.patient_id))
                   and e.completed_at >= ${params.lookbackStart.toISOString()}::timestamptz and e.completed_at < ${window.from.toISOString()}::timestamptz
               ) as retained,
               ${localDay("idx.first_at")} + ${params.returnWindowDays}::int < ${params.asOfDate}::date as eligible,
               exists (
                 select 1 from encounter e
                 where ${scope} and e.patient_id = ANY(patient_record_ids(idx.patient_id))
                   and ${localDay("e.completed_at")} > ${localDay("idx.first_at")}
                   and ${localDay("e.completed_at")} <= ${localDay("idx.first_at")} + ${params.returnWindowDays}::int
               ) as returned
        from idx
      )
      select count(*)::int as seen,
             count(*) filter (where retained)::int as retained,
             count(*) filter (where eligible)::int as return_cohort,
             count(*) filter (where eligible and returned)::int as returned
      from flagged`);
    const r = result.rows[0];
    return { seen: r?.seen ?? 0, retained: r?.retained ?? 0, returnCohort: r?.return_cohort ?? 0, returned: r?.returned ?? 0 };
  }
}
