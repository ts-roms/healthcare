import { Inject, Injectable } from "@nestjs/common";
import { type Actor, DATABASE, type Database, localDate, localDayBounds, requireFacilityId } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { sql } from "drizzle-orm";
import { appointment, encounter, practitioner, visit } from "../clinic.schema";

/** Operational snapshot of one facility for one day (CLAUDE.md §28, clinic). */
@Injectable()
export class ClinicDashboardService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly organizations: OrganizationService,
  ) {}

  async forFacility(actor: Actor, requestedDate?: string) {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const date = requestedDate ?? localDate(new Date(), facility.timezone);
    const { start, end } = localDayBounds(date, facility.timezone);
    const from = start.toISOString();
    const to = end.toISOString();

    const [appointmentsByStatus, workload, queueByStatus, waits, encounters] = await Promise.all([
      this.db.execute<{ status: string; count: number }>(sql`
        SELECT status, count(*)::int AS count FROM ${appointment}
        WHERE facility_id = ${facilityId} AND starts_at >= ${from}::timestamptz AND starts_at < ${to}::timestamptz
        GROUP BY status`),
      this.db.execute<{ practitioner_id: string; display_name: string; booked: number; seen: number; waiting: number }>(sql`
        SELECT p.id AS practitioner_id, p.display_name,
               count(a.id) FILTER (WHERE a.status NOT IN ('cancelled', 'no_show'))::int AS booked,
               count(a.id) FILTER (WHERE a.status = 'completed')::int AS seen,
               (SELECT count(*)::int FROM ${visit} v WHERE v.assigned_practitioner_id = p.id AND v.facility_id = ${facilityId}
                  AND v.queue_date = ${date}::date AND v.status IN ('waiting', 'in_triage', 'awaiting_consultation')) AS waiting
        FROM ${practitioner} p
        JOIN ${appointment} a ON a.practitioner_id = p.id
          AND a.facility_id = ${facilityId} AND a.starts_at >= ${from}::timestamptz AND a.starts_at < ${to}::timestamptz
        GROUP BY p.id, p.display_name
        ORDER BY p.display_name`),
      this.db.execute<{ status: string; count: number }>(sql`
        SELECT status, count(*)::int AS count FROM ${visit}
        WHERE facility_id = ${facilityId} AND queue_date = ${date}::date
        GROUP BY status`),
      this.db.execute<{ average_wait_minutes: number | null; longest_current_wait_minutes: number | null }>(sql`
        SELECT round(avg(extract(epoch FROM consultation_started_at - checked_in_at) / 60))::int AS average_wait_minutes,
               round(max(extract(epoch FROM now() - checked_in_at) / 60)
                 FILTER (WHERE status IN ('waiting', 'in_triage', 'awaiting_consultation')))::int AS longest_current_wait_minutes
        FROM ${visit}
        WHERE facility_id = ${facilityId} AND queue_date = ${date}::date`),
      this.db.execute<{ in_progress: number; completed: number }>(sql`
        SELECT count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
               count(*) FILTER (WHERE status = 'completed' AND completed_at >= ${from}::timestamptz AND completed_at < ${to}::timestamptz)::int AS completed
        FROM ${encounter}
        WHERE facility_id = ${facilityId} AND (status = 'in_progress' OR completed_at >= ${from}::timestamptz)`),
    ]);

    const appointmentCounts = toCounts(appointmentsByStatus.rows);
    const scheduled = Object.entries(appointmentCounts)
      .filter(([status]) => status !== "cancelled")
      .reduce((sum, [, count]) => sum + count, 0);
    const noShows = appointmentCounts["no_show"] ?? 0;
    const queueCounts = toCounts(queueByStatus.rows);
    return {
      facilityId,
      date,
      appointments: { byStatus: appointmentCounts, total: scheduled, noShowRate: scheduled ? Math.round((noShows / scheduled) * 1000) / 1000 : 0 },
      queue: {
        byStatus: queueCounts,
        waiting: (queueCounts["waiting"] ?? 0) + (queueCounts["in_triage"] ?? 0) + (queueCounts["awaiting_consultation"] ?? 0),
        inConsultation: queueCounts["in_consultation"] ?? 0,
        walkedOut: queueCounts["left_without_being_seen"] ?? 0,
        averageWaitMinutes: waits.rows[0]?.average_wait_minutes ?? null,
        longestCurrentWaitMinutes: waits.rows[0]?.longest_current_wait_minutes ?? null,
      },
      encounters: { inProgress: encounters.rows[0]?.in_progress ?? 0, completedToday: encounters.rows[0]?.completed ?? 0 },
      providerWorkload: workload.rows.map((w) => ({
        practitionerId: w.practitioner_id,
        displayName: w.display_name,
        booked: w.booked,
        seen: w.seen,
        waiting: w.waiting,
      })),
    };
  }

  /**
   * How busy each local day is at the selected facility, as counts: the appointments scheduled (cancelled ones left out) and
   * how many of them hold a slot (no-shows do not), against the slots the weekly schedules offer that day. The slots are what is left of each schedule after the
   * practitioner's leave and the facility's closures, counted the way the availability search cuts a schedule into
   * slots (a stretch shorter than a slot adds none). `to` is not included. No patient is named.
   */
  async dailyLoad(actor: Actor, range: { from: string; to: string }) {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const timeZone = facility.timezone;
    const start = localDayBounds(range.from, timeZone).start.toISOString();
    const end = localDayBounds(range.to, timeZone).start.toISOString();

    const [booked, capacity] = await Promise.all([
      this.db.execute<{ day: string; scheduled: number; booked: number }>(sql`
        SELECT ((starts_at AT TIME ZONE ${timeZone})::date)::text AS day,
               count(*) FILTER (WHERE status <> 'cancelled')::int AS scheduled,
               count(*) FILTER (WHERE status NOT IN ('cancelled', 'no_show'))::int AS booked
        FROM ${appointment}
        WHERE organization_id = ${actor.organizationId} AND facility_id = ${facilityId}
          AND starts_at >= ${start}::timestamptz AND starts_at < ${end}::timestamptz
        GROUP BY 1`),
      this.db.execute<{ day: string; slots: number }>(sql`
        WITH days AS (
          SELECT d::date AS day FROM generate_series(${range.from}::date, ${range.to}::date - 1, interval '1 day') AS d
        ),
        scheduled AS (
          SELECT d.day, s.facility_id, s.practitioner_id, s.slot_minutes,
                 tstzrange((d.day + s.start_time) AT TIME ZONE ${timeZone}, (d.day + s.end_time) AT TIME ZONE ${timeZone}) AS r
          FROM practitioner_schedule s
          JOIN days d ON extract(dow FROM d.day) = s.day_of_week AND d.day >= s.valid_from AND (s.valid_until IS NULL OR d.day <= s.valid_until)
          WHERE s.organization_id = ${actor.organizationId} AND s.facility_id = ${facilityId}
            AND (s.retired_at IS NULL OR s.retired_at > (d.day::timestamp AT TIME ZONE ${timeZone}))
        ),
        open AS (
          SELECT sc.day, sc.slot_minutes,
                 tstzmultirange(sc.r) - coalesce((
                   SELECT range_agg(tstzrange(x.starts_at, x.ends_at))
                   FROM schedule_exception x
                   WHERE x.organization_id = ${actor.organizationId} AND x.facility_id = sc.facility_id
                     AND (x.practitioner_id IS NULL OR x.practitioner_id = sc.practitioner_id)
                     AND tstzrange(x.starts_at, x.ends_at) && sc.r
                 ), '{}'::tstzmultirange) AS m
          FROM scheduled sc
        )
        SELECT o.day::text AS day,
               coalesce(sum((SELECT coalesce(sum(floor(extract(epoch FROM upper(u) - lower(u)) / 60 / o.slot_minutes)), 0) FROM unnest(o.m) AS u)), 0)::int AS slots
        FROM open o
        GROUP BY 1`),
    ]);

    const countsByDay = new Map(booked.rows.map((r) => [r.day, { scheduled: Number(r.scheduled), booked: Number(r.booked) }]));
    const slotsByDay = new Map(capacity.rows.map((r) => [r.day, Number(r.slots)]));
    const days: Array<{ date: string; scheduled: number; booked: number; slots: number }> = [];
    for (let date = range.from; date < range.to; date = nextDate(date)) {
      days.push({ date, scheduled: countsByDay.get(date)?.scheduled ?? 0, booked: countsByDay.get(date)?.booked ?? 0, slots: slotsByDay.get(date) ?? 0 });
    }
    return { facilityId, timeZone, from: range.from, to: range.to, days };
  }
}

/** The calendar date after `date` (both `YYYY-MM-DD`). */
function nextDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function toCounts(rows: Array<{ status: string; count: number }>): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
}
