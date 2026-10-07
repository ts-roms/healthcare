import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, reportingFacility, reportingRange, type ReportingWindow } from "@healthcare/core";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { telemedicineSession } from "./telemedicine.schema";

export interface TelemedicineFigures {
  started: number;
  ended: number;
  escalated: number;
  inProgress: number;
  /** Minutes from the patient joining the waiting room to the consultation starting, for consultations started in the window. */
  averageWaitMinutes: number | null;
  medianWaitMinutes: number | null;
  p90WaitMinutes: number | null;
  /** Sessions whose patient joined the waiting room in the window and whose consultation never started (one patient each). */
  joinedNotSeen: number;
}

/**
 * Telemedicine figures for management reporting (composed in the API): online consultations whose video consultation
 * started in the window, by current status — ended, escalated to in-person care, still in consultation — with how long
 * patients waited from joining the waiting room, and how many joined without being seen. Counts only. The escalation
 * rate is operational, not a quality target.
 */
@Injectable()
export class TelemedicineReportingQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async figures(organizationId: string, window: ReportingWindow): Promise<TelemedicineFigures> {
    const waitMinutes = sql`extract(epoch from ${telemedicineSession.startedAt} - ${telemedicineSession.patientJoinedAt}) / 60`;
    const [[row], [notSeen]] = await Promise.all([
      this.db
        .select({
          started: sql<number>`count(*)::int`,
          ended: sql<number>`count(*) filter (where ${telemedicineSession.status} = 'ended')::int`,
          escalated: sql<number>`count(*) filter (where ${telemedicineSession.status} = 'escalated')::int`,
          inProgress: sql<number>`count(*) filter (where ${telemedicineSession.status} = 'in_consultation')::int`,
          averageWaitMinutes: sql<number | null>`round(avg(${waitMinutes}) filter (where ${telemedicineSession.patientJoinedAt} is not null))::int`,
          medianWaitMinutes: sql<
            number | null
          >`round(percentile_cont(0.5) within group (order by ${waitMinutes}) filter (where ${telemedicineSession.patientJoinedAt} is not null))::int`,
          p90WaitMinutes: sql<
            number | null
          >`round(percentile_cont(0.9) within group (order by ${waitMinutes}) filter (where ${telemedicineSession.patientJoinedAt} is not null))::int`,
        })
        .from(telemedicineSession)
        .where(
          and(
            eq(telemedicineSession.organizationId, organizationId),
            isNotNull(telemedicineSession.startedAt),
            reportingRange(telemedicineSession.startedAt, window),
            reportingFacility(telemedicineSession.facilityId, window),
          ),
        ),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(telemedicineSession)
        .where(
          and(
            eq(telemedicineSession.organizationId, organizationId),
            isNull(telemedicineSession.startedAt),
            reportingRange(telemedicineSession.patientJoinedAt, window),
            reportingFacility(telemedicineSession.facilityId, window),
          ),
        ),
    ]);
    return {
      ...(row ?? { started: 0, ended: 0, escalated: 0, inProgress: 0, averageWaitMinutes: null, medianWaitMinutes: null, p90WaitMinutes: null }),
      joinedNotSeen: notSeen?.count ?? 0,
    };
  }
}
