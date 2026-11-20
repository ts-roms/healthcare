import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { sql } from "drizzle-orm";

export interface AccessFigures {
  userId: string;
  patients: number;
  usualDays: number[];
  offHoursPatients: number;
  denials: number;
}

/**
 * What the assistant's rules read from the audit trail. `security.unusual-access`: per staff account, at a moment: distinct patients opened in
 * the window, outside working hours (in the facility's time zone), refusals, and distinct patients per earlier working
 * day. Counts only — never which patients. The API adds names and audits the request.
 */
@Injectable()
export class AuditAssistantQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async accessFigures(
    organizationId: string,
    window: { asOf: Date; windowHours: number; historyDays: number; timeZone: string; workStartHour: number; workEndHour: number },
  ): Promise<AccessFigures[]> {
    const asOf = window.asOf.toISOString();
    const from = new Date(window.asOf.getTime() - window.windowHours * 3_600_000).toISOString();
    const historyFrom = new Date(window.asOf.getTime() - (window.windowHours * 3_600_000 + window.historyDays * 86_400_000)).toISOString();
    const { rows: current } = await this.db.execute<{ user_id: string; patients: number; off_hours: number; denials: number }>(sql`
      SELECT actor_user_id AS user_id,
             count(DISTINCT patient_id) FILTER (WHERE outcome = 'success' AND patient_id IS NOT NULL)::int AS patients,
             count(DISTINCT patient_id) FILTER (
               WHERE outcome = 'success' AND patient_id IS NOT NULL
                 AND (extract(hour FROM occurred_at AT TIME ZONE ${window.timeZone}) < ${window.workStartHour}
                      OR extract(hour FROM occurred_at AT TIME ZONE ${window.timeZone}) >= ${window.workEndHour})
             )::int AS off_hours,
             count(*) FILTER (WHERE outcome = 'denied')::int AS denials
      FROM audit_event
      WHERE organization_id = ${organizationId}::uuid
        AND actor_type = 'user' AND actor_user_id IS NOT NULL
        AND occurred_at > ${from}::timestamptz AND occurred_at <= ${asOf}::timestamptz
      GROUP BY actor_user_id
    `);
    if (current.length === 0) return [];
    const { rows: history } = await this.db.execute<{ user_id: string; patients: number }>(sql`
      SELECT actor_user_id AS user_id, (occurred_at AT TIME ZONE ${window.timeZone})::date AS day, count(DISTINCT patient_id)::int AS patients
      FROM audit_event
      WHERE organization_id = ${organizationId}::uuid
        AND actor_type = 'user' AND actor_user_id IS NOT NULL
        AND outcome = 'success' AND patient_id IS NOT NULL
        AND occurred_at > ${historyFrom}::timestamptz AND occurred_at <= ${from}::timestamptz
      GROUP BY 1, 2
      ORDER BY 2
    `);
    return current.map((c) => ({
      userId: c.user_id,
      patients: c.patients,
      usualDays: history.filter((h) => h.user_id === c.user_id).map((h) => h.patients),
      offHoursPatients: c.off_hours,
      denials: c.denials,
    }));
  }

  /**
   * `crm.send-hour`: MyHealth visits per local hour (0 to 23) in the days up to `asOf` — an account that did anything in
   * MyHealth in an hour of a day counts once for that hour. Counts only: no account, patient or action.
   */
  async portalVisitsByHour(organizationId: string, window: { asOf: Date; lookbackDays: number; timeZone: string }): Promise<number[]> {
    const from = new Date(window.asOf.getTime() - window.lookbackDays * 86_400_000).toISOString();
    const { rows } = await this.db.execute<{ hour: number; visits: number }>(sql`
      SELECT hour, count(*)::int AS visits
      FROM (
        SELECT DISTINCT actor_user_id,
               (occurred_at AT TIME ZONE ${window.timeZone})::date AS day,
               extract(hour FROM occurred_at AT TIME ZONE ${window.timeZone})::int AS hour
        FROM audit_event
        WHERE organization_id = ${organizationId}::uuid
          AND actor_type = 'patient' AND actor_user_id IS NOT NULL AND outcome = 'success'
          AND occurred_at > ${from}::timestamptz AND occurred_at <= ${window.asOf.toISOString()}::timestamptz
      ) visits
      GROUP BY hour
    `);
    const hourly = Array.from({ length: 24 }, () => 0);
    for (const row of rows) hourly[Number(row.hour)] = Number(row.visits);
    return hourly;
  }
}
