import { Injectable } from "@nestjs/common";
import type { Actor, DbExecutor } from "@healthcare/core";
import { InventoryStockService } from "@healthcare/inventory";
import { DISPENSABLE_CATEGORIES, type DispensingStock } from "@healthcare/prescription";

/** Dispensing → inventory: medicines and supplies in stock, taken and given back inside the dispensing transaction. */
@Injectable()
export class AppDispensingStock implements DispensingStock {
  constructor(private readonly stock: InventoryStockService) {}

  available(organizationId: string, facilityId: string) {
    return this.stock.usableAt(organizationId, facilityId, [...DISPENSABLE_CATEGORIES]);
  }

  take(tx: DbExecutor, actor: Actor, input: { dispenseId: string; locationId: string; itemId: string; quantity: number; reference: string; reason: string }) {
    return this.stock.consume(tx, actor, {
      locationId: input.locationId,
      itemId: input.itemId,
      quantity: input.quantity,
      source: { type: "prescription_dispense", id: input.dispenseId },
      issuedTo: "Dispensed on prescription",
      categories: DISPENSABLE_CATEGORIES,
      reference: input.reference,
      reason: input.reason,
    });
  }

  async giveBack(tx: DbExecutor, actor: Actor, input: { dispenseId: string; reason: string }) {
    const result = await this.stock.restore(tx, actor, { source: { type: "prescription_dispense", id: input.dispenseId }, reason: input.reason });
    return { movementGroupId: result.movementGroupId };
  }
}
