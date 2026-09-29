import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, reportingFacility, reportingRange, type ReportingWindow } from "@healthcare/core";
import { and, eq, sql } from "drizzle-orm";
import { dentalProcedure } from "./dental.schema";

/** Dental figures for management reporting: procedures recorded in the window (not entered in error) and patients treated. */
@Injectable()
export class DentalReportingQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async figures(organizationId: string, window: ReportingWindow): Promise<{ procedures: number; patients: number }> {
    const [row] = await this.db
      .select({ procedures: sql<number>`count(*)::int`, patients: sql<number>`count(distinct ${dentalProcedure.patientId})::int` })
      .from(dentalProcedure)
      .where(
        and(
          eq(dentalProcedure.organizationId, organizationId),
          eq(dentalProcedure.status, "recorded"),
          reportingRange(dentalProcedure.performedAt, window),
          reportingFacility(dentalProcedure.facilityId, window),
        ),
      );
    return row ?? { procedures: 0, patients: 0 };
  }
}
