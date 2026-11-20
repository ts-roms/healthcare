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
 * What `security.unusual-access` reads from the audit trail, per staff account, at a moment: distinct patients opened in
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
}
