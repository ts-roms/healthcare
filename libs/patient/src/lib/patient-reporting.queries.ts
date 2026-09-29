import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, reportingDay, reportingFacility, reportingRange, type ReportingWindow } from "@healthcare/core";
import { and, eq, ne, sql } from "drizzle-orm";
import { patient } from "./patient.schema";

/**
 * Patient Master figures for management reporting: patients registered in the window (at the filtered facilities),
 * leaving out records merged into another. Counts only.
 */
@Injectable()
export class PatientReportingQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async registrations(organizationId: string, window: ReportingWindow): Promise<{ registered: number; daily: Array<{ date: string; registered: number }> }> {
    const where = and(
      eq(patient.organizationId, organizationId),
      ne(patient.status, "merged"),
      reportingRange(patient.createdAt, window),
      reportingFacility(patient.registeredFacilityId, window),
    );
    const daily = await this.db
      .select({ date: reportingDay(patient.createdAt, window), registered: sql<number>`count(*)::int` })
      .from(patient)
      .where(where)
      .groupBy(sql`1`);
    return {
      registered: daily.reduce((n, d) => n + d.registered, 0),
      daily: daily.sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
}
