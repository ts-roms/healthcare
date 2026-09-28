import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  localDate,
  NotFoundError,
  requireFacilityId,
  localDayBounds,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import type { z } from "zod";
import { DISPENSING_STOCK, type DispensedStock, type DispensingStock, PRESCRIBING_CONTEXT, type PrescribingContext } from "../ports";
import { prescriptionDispense, type PrescriptionDispenseRecord } from "../prescription.schema";
import { PrescriptionService } from "../prescription.service";
import { remainingToDispense, sameUnit } from "./dispensing.rules";
import type { dispenseSchema } from "./dispensing.dto";

export type DispenseView = Omit<PrescriptionDispenseRecord, "organizationId"> & { lots?: DispensedStock["lots"] };

/**
 * Dispensing from prescriptions (Phase 9). An active prescription's items are handed over from a storage location of
 * the dispenser's facility: the stock leaves inventory in the same transaction (first-expiry-first-out, never expired),
 * and each dispense records the inventory item, the quantity in its stock unit and the stock movement. When the stock
 * unit is the prescribed unit, no more than prescribed (with refills) is dispensed. A mistaken dispense is reversed
 * with a reason: the stock returns to the same lots.
 */
@Injectable()
export class PrescriptionDispenseService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PRESCRIBING_CONTEXT) private readonly context: PrescribingContext,
    @Inject(DISPENSING_STOCK) private readonly stock: DispensingStock,
    private readonly prescriptions: PrescriptionService,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  /** Medicines and supplies that can be dispensed at the selected facility. */
  available(actor: Actor) {
    return this.stock.available(actor.organizationId, requireFacilityId(actor));
  }

  async findByNumber(actor: Actor, prescriptionNumber: string) {
    const id = await this.prescriptions.idForNumber(actor.organizationId, prescriptionNumber.trim().toUpperCase());
    if (!id) throw new NotFoundError("Prescription");
    return { prescriptionId: id };
  }

  /** The prescription with the patient's identification, what was dispensed per item and what remains. Audited. */
  async forPrescription(actor: Actor, prescriptionId: string) {
    const view = await this.dispensingView(this.db, actor.organizationId, prescriptionId);
    await this.audit.recordStandalone(actor, {
      action: "prescription.dispensing.view",
      resourceType: "prescription",
      resourceId: prescriptionId,
      patientId: view.prescription.patientId,
    });
    return view;
  }

  async dispense(actor: Actor, prescriptionId: string, input: z.infer<typeof dispenseSchema>) {
    const facilityId = requireFacilityId(actor);
    const created = await this.db.transaction(async (tx) => {
      // Locking the prescription serializes dispenses of it (the remaining quantity is checked against them).
      const prescription = await this.prescriptions.load(tx, actor.organizationId, prescriptionId, true);
      if (prescription.status !== "active") {
        throw new BusinessRuleError(
          `Prescription ${prescription.prescriptionNumber} is ${prescription.status}; it cannot be dispensed`,
          "prescription_not_active",
        );
      }
      const earlier = await this.dispenses(tx, prescriptionId);
      const rows: DispenseView[] = [];
      for (const line of input.lines) {
        const item = prescription.items.find((i) => i.id === line.prescriptionItemId);
        if (!item) throw new NotFoundError("Prescription item");
        const dispenseId = randomUUID();
        const taken = await this.stock.take(tx, actor, {
          dispenseId,
          locationId: line.locationId,
          itemId: line.inventoryItemId,
          quantity: line.quantity,
          reference: prescription.prescriptionNumber,
          reason: "Dispensed on prescription",
        });
        const recorded = [...earlier, ...rows].filter((d) => d.status === "recorded" && d.prescriptionItemId === item.id);
        const remaining = remainingToDispense(item, taken.item.stockUnit, recorded);
        if (remaining !== null && line.quantity > remaining) {
          throw new BusinessRuleError(
            `Line ${item.lineNumber} (${item.genericName}): ${remaining} ${item.quantityUnit} left to dispense on this prescription`,
            "exceeds_prescribed",
            { prescriptionItemId: item.id, remaining },
          );
        }
        const [row] = await tx
          .insert(prescriptionDispense)
          .values({
            id: dispenseId,
            organizationId: actor.organizationId,
            facilityId,
            prescriptionId,
            prescriptionItemId: item.id,
            patientId: prescription.patientId,
            inventoryItemId: taken.item.id,
            locationId: line.locationId,
            quantity: line.quantity,
            itemName: taken.item.name,
            stockUnit: taken.item.stockUnit,
            stockMovementGroupId: taken.movementGroupId,
            note: input.note ?? null,
            dispensedBy: actor.userId,
          })
          .returning();
        rows.push({ ...strip(row!), lots: taken.lots });
      }
      await this.audit.record(tx, actor, {
        action: "prescription.dispense",
        resourceType: "prescription",
        resourceId: prescriptionId,
        patientId: prescription.patientId,
        metadata: {
          prescriptionNumber: prescription.prescriptionNumber,
          dispenses: rows.map((r) => ({ id: r.id, prescriptionItemId: r.prescriptionItemId, inventoryItemId: r.inventoryItemId, quantity: r.quantity })),
        },
      });
      await this.events.record(tx, {
        type: "PrescriptionDispensed",
        organizationId: actor.organizationId,
        aggregateType: "prescription",
        aggregateId: prescriptionId,
        facilityId,
        patientId: prescription.patientId,
        payload: { dispenseIds: rows.map((r) => r.id) },
      });
      return rows;
    });
    return { dispensed: created, ...(await this.dispensingView(this.db, actor.organizationId, prescriptionId)) };
  }

  /** A mistaken dispense (wrong item, not collected): the stock returns to the same lots. Allowed on any prescription status. */
  async reverse(actor: Actor, dispenseId: string, reason: string) {
    const facilityId = requireFacilityId(actor);
    const reversed = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(prescriptionDispense)
        .where(and(eq(prescriptionDispense.organizationId, actor.organizationId), eq(prescriptionDispense.id, dispenseId)))
        .for("update");
      if (!current) throw new NotFoundError("Dispense");
      if (current.facilityId !== facilityId) throw new BusinessRuleError("This dispense was made at another facility", "wrong_facility");
      if (current.status !== "recorded") throw new ConflictError("This dispense was already reversed", undefined, "dispense_reversed");
      const returned = await this.stock.giveBack(tx, actor, { dispenseId, reason });
      const [row] = await tx
        .update(prescriptionDispense)
        .set({
          status: "reversed",
          reversedBy: actor.userId,
          reversedAt: new Date(),
          reversalReason: reason,
          reversalMovementGroupId: returned.movementGroupId,
        })
        .where(eq(prescriptionDispense.id, dispenseId))
        .returning();
      await this.audit.record(tx, actor, {
        action: "prescription.dispense.reverse",
        resourceType: "prescription",
        resourceId: current.prescriptionId,
        patientId: current.patientId,
        reason,
        metadata: { dispenseId, inventoryItemId: current.inventoryItemId, quantity: current.quantity },
      });
      await this.events.record(tx, {
        type: "PrescriptionDispenseReversed",
        organizationId: actor.organizationId,
        aggregateType: "prescription",
        aggregateId: current.prescriptionId,
        facilityId,
        patientId: current.patientId,
        payload: { dispenseId },
      });
      return row!;
    });
    return this.dispensingView(this.db, actor.organizationId, reversed.prescriptionId);
  }

  /** Dispenses at the selected facility on a day (default today), newest first, with minimal patient identification. */
  async recent(actor: Actor, date?: string) {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const day = date ?? localDate(new Date(), facility.timezone);
    const { start, end } = localDayBounds(day, facility.timezone);
    const rows = await this.db
      .select()
      .from(prescriptionDispense)
      .where(
        and(
          eq(prescriptionDispense.organizationId, actor.organizationId),
          eq(prescriptionDispense.facilityId, facilityId),
          gte(prescriptionDispense.dispensedAt, start),
          lt(prescriptionDispense.dispensedAt, end),
        ),
      )
      .orderBy(desc(prescriptionDispense.dispensedAt))
      .limit(200);
    const patientIds = [...new Set(rows.map((r) => r.patientId))];
    const patients = await this.context.patientBriefs(actor.organizationId, patientIds);
    for (const patientId of patientIds) {
      await this.audit.recordStandalone(actor, { action: "prescription.dispense.list", resourceType: "prescription", patientId });
    }
    return {
      date: day,
      dispenses: rows.map((r) => ({ ...strip(r), patient: patients.get(r.patientId) ?? null })),
    };
  }

  // ---- internals -----------------------------------------------------------------------------

  private async dispensingView(executor: DbExecutor, organizationId: string, prescriptionId: string) {
    const prescription = await this.prescriptions.load(executor, organizationId, prescriptionId);
    const dispenses = (await this.dispenses(executor, prescriptionId)).map(strip);
    const patients = await this.context.patientBriefs(organizationId, [prescription.patientId]);
    return {
      prescription,
      patient: patients.get(prescription.patientId) ?? null,
      items: prescription.items.map((item) => {
        const own = dispenses.filter((d) => d.prescriptionItemId === item.id);
        const recorded = own.filter((d) => d.status === "recorded");
        const units = [...new Set(recorded.map((d) => d.stockUnit))];
        return {
          prescriptionItemId: item.id,
          lineNumber: item.lineNumber,
          prescribed: { quantity: item.quantity, quantityUnit: item.quantityUnit, refills: item.refills },
          /** Dispensed so far per stock unit (reversed dispenses excluded). */
          dispensed: units.map((unit) => ({ stockUnit: unit, quantity: recorded.filter((d) => d.stockUnit === unit).reduce((sum, d) => sum + d.quantity, 0) })),
          /** Left to dispense in the prescribed unit; unknown (null) once something was dispensed in another unit. */
          remaining: recorded.every((d) => sameUnit(d.stockUnit, item.quantityUnit)) ? remainingToDispense(item, item.quantityUnit, recorded) : null,
        };
      }),
      dispenses,
    };
  }

  private dispenses(executor: DbExecutor, prescriptionId: string) {
    return executor
      .select()
      .from(prescriptionDispense)
      .where(eq(prescriptionDispense.prescriptionId, prescriptionId))
      .orderBy(asc(prescriptionDispense.dispensedAt));
  }
}

function strip<T extends { organizationId: string }>(row: T): Omit<T, "organizationId"> {
  const { organizationId: _o, ...rest } = row;
  return rest;
}
