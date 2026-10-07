import { Inject, Injectable } from "@nestjs/common";
import { canonicalPatientId, DATABASE, type Database, reportingDay, reportingFacility, reportingRange, type ReportingWindow } from "@healthcare/core";
import { and, desc, eq, sql } from "drizzle-orm";
import { prescription, prescriptionDispense } from "./prescription.schema";

export interface DispensingFigures {
  /** Prescriptions issued in the window at the facilities in scope (whatever their status now). */
  prescriptionsIssued: number;
  /** Of those, cancelled or replaced since. */
  prescriptionsCancelled: number;
  /** Dispense lines recorded in the window, and those since reversed. */
  dispenses: number;
  reversed: number;
  /** Distinct prescriptions with at least one standing dispense recorded in the window. */
  prescriptionsDispensed: number;
  /** Distinct patients with a standing dispense in the window (a merged pair once). Suppressed by the caller. */
  patients: number;
  /** The ten items dispensed most, by quantity in their stock unit (standing dispenses only). */
  topItems: Array<{ inventoryItemId: string; name: string; stockUnit: string; quantity: number; dispenses: number }>;
  /** Standing dispense lines per local day. */
  daily: Array<{ date: string; dispenses: number }>;
}

/**
 * Dispensing figures for management reporting over a window: prescriptions issued, dispense lines recorded and
 * reversed, prescriptions and patients served, the items dispensed most and a daily series. Counts only — no patient,
 * prescriber or prescription number. A reversed dispense stays counted as recorded and again as reversed; the item,
 * prescription and patient figures count standing dispenses only.
 */
@Injectable()
export class PrescriptionReportingQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async figures(organizationId: string, window: ReportingWindow): Promise<DispensingFigures> {
    const dispensed = and(
      eq(prescriptionDispense.organizationId, organizationId),
      reportingRange(prescriptionDispense.dispensedAt, window),
      reportingFacility(prescriptionDispense.facilityId, window),
    );
    const standing = and(dispensed, eq(prescriptionDispense.status, "recorded"));
    const [[issued], [lines], top, daily] = await Promise.all([
      this.db
        .select({
          issued: sql<number>`count(*)::int`,
          cancelled: sql<number>`count(*) filter (where ${prescription.status} <> 'active')::int`,
        })
        .from(prescription)
        .where(
          and(
            eq(prescription.organizationId, organizationId),
            reportingRange(prescription.issuedAt, window),
            reportingFacility(prescription.facilityId, window),
          ),
        ),
      this.db
        .select({
          dispenses: sql<number>`count(*)::int`,
          reversed: sql<number>`count(*) filter (where ${prescriptionDispense.status} = 'reversed')::int`,
          prescriptions: sql<number>`count(distinct ${prescriptionDispense.prescriptionId}) filter (where ${prescriptionDispense.status} = 'recorded')::int`,
          patients: sql<number>`count(distinct ${canonicalPatientId(prescriptionDispense.patientId)}) filter (where ${prescriptionDispense.status} = 'recorded')::int`,
        })
        .from(prescriptionDispense)
        .where(dispensed),
      this.db
        .select({
          inventoryItemId: prescriptionDispense.inventoryItemId,
          name: sql<string>`max(${prescriptionDispense.itemName})`,
          stockUnit: sql<string>`max(${prescriptionDispense.stockUnit})`,
          quantity: sql<number>`sum(${prescriptionDispense.quantity})::int`,
          dispenses: sql<number>`count(*)::int`,
        })
        .from(prescriptionDispense)
        .where(standing)
        .groupBy(prescriptionDispense.inventoryItemId)
        .orderBy(desc(sql`sum(${prescriptionDispense.quantity})`), sql`max(${prescriptionDispense.itemName})`)
        .limit(10),
      this.db
        .select({ date: reportingDay(prescriptionDispense.dispensedAt, window), dispenses: sql<number>`count(*)::int` })
        .from(prescriptionDispense)
        .where(standing)
        .groupBy(sql`1`),
    ]);
    return {
      prescriptionsIssued: issued?.issued ?? 0,
      prescriptionsCancelled: issued?.cancelled ?? 0,
      dispenses: lines?.dispenses ?? 0,
      reversed: lines?.reversed ?? 0,
      prescriptionsDispensed: lines?.prescriptions ?? 0,
      patients: lines?.patients ?? 0,
      topItems: top,
      daily: daily.sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
}
