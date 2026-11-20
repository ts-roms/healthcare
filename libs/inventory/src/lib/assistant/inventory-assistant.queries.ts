import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import {
  inventoryBalance,
  inventoryItem,
  inventoryLocation,
  inventoryLot,
  inventoryMovement,
  inventoryPurchaseOrder,
  inventoryPurchaseOrderLine,
} from "../inventory.schema";
import type { DaysOfCoverInput } from "./days-of-cover.rules";

/**
 * The figures the `inventory.days-of-cover` rule reads, per active item at one facility: usable stock, what is on
 * open orders, and the issues of a window. Quantities only — no patient, no lot, no cost — so reading is not audited
 * here (the API audits the assistant request).
 */
@Injectable()
export class InventoryAssistantQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `since`: start of the window; `today`: the facility's local date (YYYY-MM-DD) for expiry. */
  async coverInputs(organizationId: string, facilityId: string, since: Date, today: string): Promise<DaysOfCoverInput[]> {
    const items = await this.db
      .select({ id: inventoryItem.id, code: inventoryItem.code, name: inventoryItem.name, stockUnit: inventoryItem.stockUnit })
      .from(inventoryItem)
      .where(and(eq(inventoryItem.organizationId, organizationId), eq(inventoryItem.status, "active")));
    if (items.length === 0) return [];
    const atFacility = and(
      eq(inventoryLocation.organizationId, organizationId),
      eq(inventoryLocation.facilityId, facilityId),
      eq(inventoryLocation.status, "active"),
    );

    const usable = await this.db
      .select({ itemId: inventoryBalance.itemId, quantity: sql<number>`sum(${inventoryBalance.quantity})::int` })
      .from(inventoryBalance)
      .innerJoin(inventoryLocation, eq(inventoryLocation.id, inventoryBalance.locationId))
      .innerJoin(inventoryLot, eq(inventoryLot.id, inventoryBalance.lotId))
      .where(and(atFacility, or(isNull(inventoryLot.expiryDate), gte(inventoryLot.expiryDate, today))))
      .groupBy(inventoryBalance.itemId);

    const onOrder = await this.db
      .select({
        itemId: inventoryPurchaseOrderLine.itemId,
        quantity: sql<number>`sum(${inventoryPurchaseOrderLine.quantityOrdered} - ${inventoryPurchaseOrderLine.quantityReceived})::int`,
      })
      .from(inventoryPurchaseOrderLine)
      .innerJoin(inventoryPurchaseOrder, eq(inventoryPurchaseOrder.id, inventoryPurchaseOrderLine.purchaseOrderId))
      .where(
        and(
          eq(inventoryPurchaseOrder.organizationId, organizationId),
          eq(inventoryPurchaseOrder.facilityId, facilityId),
          inArray(inventoryPurchaseOrder.status, ["approved", "partially_received"]),
        ),
      )
      .groupBy(inventoryPurchaseOrderLine.itemId);

    // Issues are negative in the ledger; returns are positive and net against them.
    const issued = await this.db
      .select({
        itemId: inventoryMovement.itemId,
        quantity: sql<number>`coalesce(-sum(${inventoryMovement.quantity}), 0)::int`,
        issues: sql<number>`count(*) filter (where ${inventoryMovement.kind} = 'issue')::int`,
      })
      .from(inventoryMovement)
      .innerJoin(inventoryLocation, eq(inventoryLocation.id, inventoryMovement.locationId))
      .where(and(atFacility, inArray(inventoryMovement.kind, ["issue", "return"]), gte(inventoryMovement.recordedAt, since)))
      .groupBy(inventoryMovement.itemId);

    const usableBy = new Map(usable.map((r) => [r.itemId, r.quantity]));
    const onOrderBy = new Map(onOrder.map((r) => [r.itemId, r.quantity]));
    const issuedBy = new Map(issued.map((r) => [r.itemId, r]));
    return items
      .filter((item) => issuedBy.has(item.id))
      .map((item) => ({
        itemId: item.id,
        code: item.code,
        name: item.name,
        stockUnit: item.stockUnit,
        usable: usableBy.get(item.id) ?? 0,
        onOrder: onOrderBy.get(item.id) ?? 0,
        issued: issuedBy.get(item.id)!.quantity,
        issues: issuedBy.get(item.id)!.issues,
      }));
  }
}
