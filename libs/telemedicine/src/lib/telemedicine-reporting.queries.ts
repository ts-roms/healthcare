import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, reportingFacility, reportingRange, type ReportingWindow } from "@healthcare/core";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { telemedicineSession } from "./telemedicine.schema";

/**
 * Telemedicine figures for management reporting (composed in the API): online consultations whose video consultation
 * started in the window, by current status — ended, escalated to in-person care, still in consultation. Counts only.
 * The escalation rate is operational, not a quality target.
 */
@Injectable()
export class TelemedicineReportingQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async figures(organizationId: string, window: ReportingWindow): Promise<{ started: number; ended: number; escalated: number; inProgress: number }> {
    const [row] = await this.db
      .select({
        started: sql<number>`count(*)::int`,
        ended: sql<number>`count(*) filter (where ${telemedicineSession.status} = 'ended')::int`,
        escalated: sql<number>`count(*) filter (where ${telemedicineSession.status} = 'escalated')::int`,
        inProgress: sql<number>`count(*) filter (where ${telemedicineSession.status} = 'in_consultation')::int`,
      })
      .from(telemedicineSession)
      .where(
        and(
          eq(telemedicineSession.organizationId, organizationId),
          isNotNull(telemedicineSession.startedAt),
          reportingRange(telemedicineSession.startedAt, window),
          reportingFacility(telemedicineSession.facilityId, window),
        ),
      );
    return row ?? { started: 0, ended: 0, escalated: 0, inProgress: 0 };
  }
}
