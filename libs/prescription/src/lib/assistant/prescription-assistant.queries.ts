import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, filedAsPatient } from "@healthcare/core";
import { and, asc, desc, eq, gte, inArray, lt, ne, type SQL } from "drizzle-orm";
import { PrescribingMedicineService } from "../medicines/prescribing-medicine.service";
import { PRESCRIBING_CONTEXT, type PrescribingContext } from "../ports";
import { prescription, prescriptionItem } from "../prescription.schema";
import type { DraftMedicine, EarlierPrescription, MedicineSetting } from "./prescribing.rules";

/**
 * What the assistant's prescribing rules read (prescribing.rules.ts). Prescriptions are rebuilt as of a moment from
 * their issue and closing times, so a replay reads what was on record when each prescription was issued; the
 * organization's medicine settings and the patient's age and sex are read as they are now. No note or instruction is
 * read; the API audits the assistant request.
 */
@Injectable()
export class PrescriptionAssistantQueries {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PRESCRIBING_CONTEXT) private readonly context: PrescribingContext,
    private readonly medicines: PrescribingMedicineService,
  ) {}

  /** The consultation a prescription is drafted in, with its patient's sex and age; null when it is not this organization's. */
  async consultation(
    organizationId: string,
    encounterId: string,
  ): Promise<{ encounterId: string; patientId: string; facilityId: string; inProgress: boolean; patient: { sex: string | null; age: number | null } } | null> {
    const encounter = await this.context.encounter(organizationId, encounterId);
    if (!encounter) return null;
    const brief = (await this.context.patientBriefs(organizationId, [encounter.patientId])).get(encounter.patientId);
    return {
      encounterId: encounter.id,
      patientId: encounter.patientId,
      facilityId: encounter.facilityId,
      inProgress: encounter.status === "in_progress",
      patient: { sex: brief?.sex ?? null, age: brief?.age ?? null },
    };
  }

  /** The patient's prescriptions issued before `asOf` (records linked to theirs included), with their status then; `exceptId` left out. */
  async earlierPrescriptions(organizationId: string, patientId: string, asOf: Date, exceptId?: string): Promise<EarlierPrescription[]> {
    const filters: SQL[] = [
      eq(prescription.organizationId, organizationId),
      filedAsPatient(prescription.patientId, patientId),
      lt(prescription.issuedAt, asOf),
    ];
    if (exceptId) filters.push(ne(prescription.id, exceptId));
    const rows = await this.db
      .select({
        id: prescription.id,
        prescriptionNumber: prescription.prescriptionNumber,
        issuedAt: prescription.issuedAt,
        status: prescription.status,
        cancelledAt: prescription.cancelledAt,
      })
      .from(prescription)
      .where(and(...filters))
      .orderBy(desc(prescription.issuedAt))
      .limit(200);
    if (rows.length === 0) return [];
    const items = await this.db
      .select({
        prescriptionId: prescriptionItem.prescriptionId,
        genericName: prescriptionItem.genericName,
        durationValue: prescriptionItem.durationValue,
        durationUnit: prescriptionItem.durationUnit,
        refills: prescriptionItem.refills,
      })
      .from(prescriptionItem)
      .where(
        inArray(
          prescriptionItem.prescriptionId,
          rows.map((r) => r.id),
        ),
      );
    return rows.map((r) => ({
      id: r.id,
      prescriptionNumber: r.prescriptionNumber,
      issuedAt: r.issuedAt.toISOString(),
      // Cancelled or superseded later than the moment: it was still active then.
      status: r.cancelledAt && r.cancelledAt.getTime() <= asOf.getTime() ? r.status : "active",
      items: items
        .filter((i) => i.prescriptionId === r.id)
        .map((i) => ({ genericName: i.genericName, durationValue: i.durationValue, durationUnit: i.durationUnit, refills: i.refills })),
    }));
  }

  /** Prescriptions issued at the facility in [from, to), with their medicines as written, for a replay. */
  async issuedBetween(
    organizationId: string,
    facilityId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ id: string; encounterId: string; patientId: string; issuedAt: Date; replacesPrescriptionId: string | null; medicines: DraftMedicine[] }>> {
    const rows = await this.db
      .select({
        id: prescription.id,
        encounterId: prescription.encounterId,
        patientId: prescription.patientId,
        issuedAt: prescription.issuedAt,
        replacesPrescriptionId: prescription.replacesPrescriptionId,
      })
      .from(prescription)
      .where(
        and(
          eq(prescription.organizationId, organizationId),
          eq(prescription.facilityId, facilityId),
          gte(prescription.issuedAt, from),
          lt(prescription.issuedAt, to),
        ),
      )
      .orderBy(asc(prescription.issuedAt))
      .limit(500);
    if (rows.length === 0) return [];
    const items = await this.db
      .select({
        prescriptionId: prescriptionItem.prescriptionId,
        genericName: prescriptionItem.genericName,
        brandName: prescriptionItem.brandName,
        strength: prescriptionItem.strength,
        doseAmount: prescriptionItem.doseAmount,
        doseUnit: prescriptionItem.doseUnit,
        frequency: prescriptionItem.frequency,
      })
      .from(prescriptionItem)
      .where(
        inArray(
          prescriptionItem.prescriptionId,
          rows.map((r) => r.id),
        ),
      );
    return rows.map((r) => ({
      ...r,
      medicines: items.filter((i) => i.prescriptionId === r.id).map(({ prescriptionId: _id, ...medicine }) => medicine),
    }));
  }

  /** The organization's active medicine settings. */
  async settings(organizationId: string): Promise<MedicineSetting[]> {
    return (await this.medicines.list(organizationId)).map((m) => ({
      id: m.id,
      name: m.name,
      className: m.className,
      maxDailyDose: m.maxDailyDose,
      doseUnit: m.doseUnit,
      checkRenal: m.checkRenal,
      checkPregnancy: m.checkPregnancy,
      note: m.note,
    }));
  }
}
