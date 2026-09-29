import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, reportingFacility, reportingRange, type ReportingWindow } from "@healthcare/core";
import { and, desc, eq, sql } from "drizzle-orm";
import { dentalProcedure, dentalProcedureType } from "./dental.schema";

/** How many procedure codes the dashboard lists. */
const TOP_PROCEDURES = 10;

/**
 * Dental figures for management reporting: procedures recorded in the window (not entered in error), patients treated,
 * and the most used procedure codes with their distinct patients (the API suppresses small patient counts).
 */
@Injectable()
export class DentalReportingQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async figures(
    organizationId: string,
    window: ReportingWindow,
  ): Promise<{ procedures: number; patients: number; byProcedure: Array<{ code: string; name: string; procedures: number; patients: number }> }> {
    const where = and(
      eq(dentalProcedure.organizationId, organizationId),
      eq(dentalProcedure.status, "recorded"),
      reportingRange(dentalProcedure.performedAt, window),
      reportingFacility(dentalProcedure.facilityId, window),
    );
    const [totals, byProcedure] = await Promise.all([
      this.db
        .select({ procedures: sql<number>`count(*)::int`, patients: sql<number>`count(distinct ${dentalProcedure.patientId})::int` })
        .from(dentalProcedure)
        .where(where),
      this.db
        .select({
          code: dentalProcedureType.code,
          name: dentalProcedureType.name,
          procedures: sql<number>`count(*)::int`,
          patients: sql<number>`count(distinct ${dentalProcedure.patientId})::int`,
        })
        .from(dentalProcedure)
        .innerJoin(dentalProcedureType, eq(dentalProcedureType.id, dentalProcedure.procedureTypeId))
        .where(where)
        .groupBy(dentalProcedureType.code, dentalProcedureType.name)
        .orderBy(desc(sql`count(*)`), dentalProcedureType.code)
        .limit(TOP_PROCEDURES),
    ]);
    return { ...(totals[0] ?? { procedures: 0, patients: 0 }), byProcedure };
  }
}
