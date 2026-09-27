import { Inject, Injectable } from '@nestjs/common';
import { type Actor, DATABASE, type Database, localDate, localDayBounds, requireFacilityId } from '@healthcare/core';
import { OrganizationService } from '@healthcare/organization';
import { sql } from 'drizzle-orm';
import { appointment, encounter, practitioner, visit } from '../clinic.schema';

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
      .filter(([status]) => status !== 'cancelled')
      .reduce((sum, [, count]) => sum + count, 0);
    const noShows = appointmentCounts['no_show'] ?? 0;
    const queueCounts = toCounts(queueByStatus.rows);
    return {
      facilityId,
      date,
      appointments: { byStatus: appointmentCounts, total: scheduled, noShowRate: scheduled ? Math.round((noShows / scheduled) * 1000) / 1000 : 0 },
      queue: {
        byStatus: queueCounts,
        waiting: (queueCounts['waiting'] ?? 0) + (queueCounts['in_triage'] ?? 0) + (queueCounts['awaiting_consultation'] ?? 0),
        inConsultation: queueCounts['in_consultation'] ?? 0,
        walkedOut: queueCounts['left_without_being_seen'] ?? 0,
        averageWaitMinutes: waits.rows[0]?.average_wait_minutes ?? null,
        longestCurrentWaitMinutes: waits.rows[0]?.longest_current_wait_minutes ?? null,
      },
      encounters: { inProgress: encounters.rows[0]?.in_progress ?? 0, completedToday: encounters.rows[0]?.completed ?? 0 },
      providerWorkload: workload.rows.map((w) => ({ practitionerId: w.practitioner_id, displayName: w.display_name, booked: w.booked, seen: w.seen, waiting: w.waiting })),
    };
  }
}

function toCounts(rows: Array<{ status: string; count: number }>): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
}
