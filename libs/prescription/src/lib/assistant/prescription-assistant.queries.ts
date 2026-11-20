import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, filedAsPatient } from "@healthcare/core";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, type SQL } from "drizzle-orm";
import { remainingToDispense, sameUnit } from "../dispensing/dispensing.rules";
import { PrescribingMedicineService } from "../medicines/prescribing-medicine.service";
import { PRESCRIBING_CONTEXT, type PrescribingContext } from "../ports";
import { prescription, prescriptionDispense, prescriptionItem } from "../prescription.schema";
import type { DispensingItem, PendingItem } from "./pharmacy.rules";
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

  // ---- the pharmacy rules (pharmacy.rules.ts) ------------------------------------------------------------------------

  /**
   * `dispensing.short-stock`: items of the prescriptions issued at the facility in (`since`, `asOf`] and still active then,
   * with what is left of one fill (the quantity, refills not counted) after the dispenses recorded by then and not
   * reversed by then. Items dispensed in another unit than prescribed are left out (what is left cannot be told).
   */
  async pendingItems(organizationId: string, facilityId: string, window: { since: Date; asOf: Date }): Promise<PendingItem[]> {
    const rows = await this.db
      .select({ id: prescription.id, prescriptionNumber: prescription.prescriptionNumber, issuedAt: prescription.issuedAt })
      .from(prescription)
      .where(
        and(
          eq(prescription.organizationId, organizationId),
          eq(prescription.facilityId, facilityId),
          gt(prescription.issuedAt, window.since),
          lte(prescription.issuedAt, window.asOf),
          or(isNull(prescription.cancelledAt), gt(prescription.cancelledAt, window.asOf)),
        ),
      )
      .orderBy(asc(prescription.issuedAt))
      .limit(500);
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const items = await this.itemsOf(ids);
    const dispensed = await this.dispensedBy(ids, window.asOf);
    const out: PendingItem[] = [];
    for (const item of items) {
      const own = dispensed.filter((d) => d.prescriptionItemId === item.id);
      if (!own.every((d) => sameUnit(d.stockUnit, item.quantityUnit))) continue;
      const remaining = Math.max(0, item.quantity - own.reduce((sum, d) => sum + d.quantity, 0));
      if (remaining === 0) continue;
      const rx = rows.find((r) => r.id === item.prescriptionId)!;
      out.push({
        prescriptionId: rx.id,
        prescriptionNumber: rx.prescriptionNumber,
        issuedAt: rx.issuedAt.toISOString(),
        genericName: item.genericName,
        strength: item.strength,
        quantityUnit: item.quantityUnit,
        remaining,
      });
    }
    return out;
  }

  /**
   * `dispensing.course-expiry` on the dispense screen: an active prescription's items with their duration and what is
   * left to dispense (refills included; null when something was dispensed in another unit). Null when the prescription
   * is not this organization's or was not active at the moment.
   */
  async dispensingItems(
    organizationId: string,
    prescriptionId: string,
    asOf: Date,
  ): Promise<{ prescriptionId: string; prescriptionNumber: string; items: DispensingItem[] } | null> {
    const [rx] = await this.db
      .select({
        id: prescription.id,
        prescriptionNumber: prescription.prescriptionNumber,
        issuedAt: prescription.issuedAt,
        cancelledAt: prescription.cancelledAt,
      })
      .from(prescription)
      .where(and(eq(prescription.organizationId, organizationId), eq(prescription.id, prescriptionId)));
    if (!rx || rx.issuedAt.getTime() > asOf.getTime() || (rx.cancelledAt && rx.cancelledAt.getTime() <= asOf.getTime())) return null;
    const items = await this.itemsOf([rx.id]);
    const dispensed = await this.dispensedBy([rx.id], asOf);
    return {
      prescriptionId: rx.id,
      prescriptionNumber: rx.prescriptionNumber,
      items: items.map((item) => {
        const own = dispensed.filter((d) => d.prescriptionItemId === item.id);
        return {
          prescriptionItemId: item.id,
          genericName: item.genericName,
          strength: item.strength,
          durationValue: item.durationValue,
          durationUnit: item.durationUnit,
          remaining: own.every((d) => sameUnit(d.stockUnit, item.quantityUnit)) ? remainingToDispense(item, item.quantityUnit, own) : null,
        };
      }),
    };
  }

  /** `dispensing.course-expiry` replayed: the dispenses recorded at the facility in [from, to) and not reversed by `to`. */
  async dispensesBetween(
    organizationId: string,
    facilityId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ prescriptionId: string; prescriptionNumber: string; dispensedAt: Date; movementGroupId: string; item: DispensingItem }>> {
    const rows = await this.db
      .select({
        prescriptionId: prescriptionDispense.prescriptionId,
        prescriptionNumber: prescription.prescriptionNumber,
        dispensedAt: prescriptionDispense.dispensedAt,
        movementGroupId: prescriptionDispense.stockMovementGroupId,
        prescriptionItemId: prescriptionItem.id,
        genericName: prescriptionItem.genericName,
        strength: prescriptionItem.strength,
        durationValue: prescriptionItem.durationValue,
        durationUnit: prescriptionItem.durationUnit,
      })
      .from(prescriptionDispense)
      .innerJoin(prescription, eq(prescription.id, prescriptionDispense.prescriptionId))
      .innerJoin(prescriptionItem, eq(prescriptionItem.id, prescriptionDispense.prescriptionItemId))
      .where(
        and(
          eq(prescriptionDispense.organizationId, organizationId),
          eq(prescriptionDispense.facilityId, facilityId),
          gte(prescriptionDispense.dispensedAt, from),
          lt(prescriptionDispense.dispensedAt, to),
          or(isNull(prescriptionDispense.reversedAt), gt(prescriptionDispense.reversedAt, to)),
        ),
      )
      .orderBy(asc(prescriptionDispense.dispensedAt))
      .limit(500);
    return rows.map((r) => ({
      prescriptionId: r.prescriptionId,
      prescriptionNumber: r.prescriptionNumber,
      dispensedAt: r.dispensedAt,
      movementGroupId: r.movementGroupId,
      item: {
        prescriptionItemId: r.prescriptionItemId,
        genericName: r.genericName,
        strength: r.strength,
        durationValue: r.durationValue,
        durationUnit: r.durationUnit,
        remaining: null,
      },
    }));
  }

  private itemsOf(prescriptionIds: string[]) {
    return this.db
      .select({
        id: prescriptionItem.id,
        prescriptionId: prescriptionItem.prescriptionId,
        genericName: prescriptionItem.genericName,
        strength: prescriptionItem.strength,
        quantity: prescriptionItem.quantity,
        quantityUnit: prescriptionItem.quantityUnit,
        refills: prescriptionItem.refills,
        durationValue: prescriptionItem.durationValue,
        durationUnit: prescriptionItem.durationUnit,
      })
      .from(prescriptionItem)
      .where(inArray(prescriptionItem.prescriptionId, prescriptionIds))
      .orderBy(asc(prescriptionItem.prescriptionId), asc(prescriptionItem.lineNumber));
  }

  /** Dispenses of the prescriptions recorded by `asOf` and not reversed by then. */
  private dispensedBy(prescriptionIds: string[], asOf: Date) {
    return this.db
      .select({
        prescriptionItemId: prescriptionDispense.prescriptionItemId,
        quantity: prescriptionDispense.quantity,
        stockUnit: prescriptionDispense.stockUnit,
      })
      .from(prescriptionDispense)
      .where(
        and(
          inArray(prescriptionDispense.prescriptionId, prescriptionIds),
          lte(prescriptionDispense.dispensedAt, asOf),
          or(isNull(prescriptionDispense.reversedAt), gt(prescriptionDispense.reversedAt, asOf)),
        ),
      );
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
