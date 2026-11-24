import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, reportingDay, reportingFacility, reportingRange, type ReportingWindow } from "@healthcare/core";
import { and, eq, ne, sql } from "drizzle-orm";
import { patient } from "./patient.schema";
import { patientPortalAccount } from "./portal/portal.schema";

/** An organization's patient figures for the platform console (migration 0151): raw counts, suppressed by the caller. */
export interface PlatformPatientFigures {
  patients: number;
  myHealthAccounts: number;
}

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

  /**
   * Active patients (not merged, inactive or deceased records) and active MyHealth accounts of every organization, for
   * the platform console (the caller crosses organizations on purpose, under the platform scope). Counts only.
   */
  async platformFigures(): Promise<Map<string, PlatformPatientFigures>> {
    const patients = await this.db
      .select({ organizationId: patient.organizationId, n: sql<number>`count(*)::int` })
      .from(patient)
      .where(eq(patient.status, "active"))
      .groupBy(patient.organizationId);
    const accounts = await this.db
      .select({ organizationId: patientPortalAccount.organizationId, n: sql<number>`count(*)::int` })
      .from(patientPortalAccount)
      .where(eq(patientPortalAccount.status, "active"))
      .groupBy(patientPortalAccount.organizationId);
    const figures = new Map<string, PlatformPatientFigures>();
    for (const p of patients) figures.set(p.organizationId, { patients: p.n, myHealthAccounts: 0 });
    for (const a of accounts) {
      const entry = figures.get(a.organizationId) ?? { patients: 0, myHealthAccounts: 0 };
      entry.myHealthAccounts = a.n;
      figures.set(a.organizationId, entry);
    }
    return figures;
  }
}
