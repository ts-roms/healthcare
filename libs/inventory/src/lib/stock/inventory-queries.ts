import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, asc, eq, gt, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { inventoryBalance, inventoryItem, type ItemCategory, inventoryLocation, inventoryLot } from "../inventory.schema";

export interface InventoryLotInfo {
  lotId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  category: ItemCategory;
  itemStatus: "active" | "inactive";
  lotNumber: string | null;
  /** YYYY-MM-DD, or null for items without expiry. */
  expiryDate: string | null;
}

/**
 * Read queries other domains use through their ports (wired in the API), e.g. the laboratory recording which reagent
 * lot is loaded on an instrument. No patient data, so not audited here.
 */
@Injectable()
export class InventoryQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async lot(organizationId: string, lotId: string): Promise<InventoryLotInfo | undefined> {
    const [row] = await this.db
      .select({ lot: inventoryLot, item: inventoryItem })
      .from(inventoryLot)
      .innerJoin(inventoryItem, eq(inventoryItem.id, inventoryLot.itemId))
      .where(and(eq(inventoryLot.organizationId, organizationId), eq(inventoryLot.id, lotId)));
    return row ? info(row) : undefined;
  }

  /** Lots of these categories with stock on hand at the facility's active locations, earliest expiry first. */
  async lotsInStock(
    organizationId: string,
    facilityId: string,
    categories: ItemCategory[],
  ): Promise<Array<InventoryLotInfo & { quantity: number; stockUnit: string }>> {
    const rows = await this.db
      .select({ lot: inventoryLot, item: inventoryItem, quantity: sql<number>`sum(${inventoryBalance.quantity})::int` })
      .from(inventoryBalance)
      .innerJoin(inventoryLocation, eq(inventoryLocation.id, inventoryBalance.locationId))
      .innerJoin(inventoryLot, eq(inventoryLot.id, inventoryBalance.lotId))
      .innerJoin(inventoryItem, eq(inventoryItem.id, inventoryLot.itemId))
      .where(
        and(
          eq(inventoryLocation.organizationId, organizationId),
          eq(inventoryLocation.facilityId, facilityId),
          eq(inventoryLocation.status, "active"),
          inArray(inventoryItem.category, categories),
          gt(inventoryBalance.quantity, 0),
        ),
      )
      .groupBy(inventoryLot.id, inventoryItem.id)
      .orderBy(asc(inventoryItem.name), sql`${inventoryLot.expiryDate} ASC NULLS LAST`);
    return rows.map((row) => ({ ...info(row), quantity: row.quantity, stockUnit: row.item.stockUnit }));
  }

  /** Items of the organization (any status) by id, for other domains' configuration and snapshots. */
  async items(organizationId: string, itemIds?: string[]) {
    if (itemIds && itemIds.length === 0) return [];
    const conditions = [eq(inventoryItem.organizationId, organizationId)];
    if (itemIds) conditions.push(inArray(inventoryItem.id, [...new Set(itemIds)]));
    const rows = await this.db
      .select()
      .from(inventoryItem)
      .where(and(...conditions))
      .orderBy(asc(inventoryItem.name));
    return rows.map((i) => ({
      id: i.id,
      code: i.code,
      name: i.name,
      category: i.category,
      stockUnit: i.stockUnit,
      controlled: i.controlled,
      status: i.status,
    }));
  }

  /** Storage locations of a facility (any status). */
  async locations(organizationId: string, facilityId: string) {
    const rows = await this.db
      .select()
      .from(inventoryLocation)
      .where(and(eq(inventoryLocation.organizationId, organizationId), eq(inventoryLocation.facilityId, facilityId)))
      .orderBy(asc(inventoryLocation.name));
    return rows.map((l) => ({ id: l.id, facilityId: l.facilityId, code: l.code, name: l.name, status: l.status }));
  }

  async location(organizationId: string, locationId: string) {
    const [row] = await this.db
      .select()
      .from(inventoryLocation)
      .where(and(eq(inventoryLocation.organizationId, organizationId), eq(inventoryLocation.id, locationId)));
    return row ? { id: row.id, facilityId: row.facilityId, code: row.code, name: row.name, status: row.status } : undefined;
  }

  /** Usable stock (lots not expired on `today`, the facility's local date) per location and item at a facility. */
  async usableStock(organizationId: string, facilityId: string, today: string): Promise<Array<{ locationId: string; itemId: string; usable: number }>> {
    return this.db
      .select({
        locationId: inventoryBalance.locationId,
        itemId: inventoryBalance.itemId,
        usable: sql<number>`sum(${inventoryBalance.quantity})::int`,
      })
      .from(inventoryBalance)
      .innerJoin(inventoryLocation, eq(inventoryLocation.id, inventoryBalance.locationId))
      .innerJoin(inventoryLot, eq(inventoryLot.id, inventoryBalance.lotId))
      .where(
        and(
          eq(inventoryLocation.organizationId, organizationId),
          eq(inventoryLocation.facilityId, facilityId),
          gt(inventoryBalance.quantity, 0),
          or(isNull(inventoryLot.expiryDate), gte(inventoryLot.expiryDate, today)),
        ),
      )
      .groupBy(inventoryBalance.locationId, inventoryBalance.itemId);
  }
}

function info({ lot, item }: { lot: typeof inventoryLot.$inferSelect; item: typeof inventoryItem.$inferSelect }): InventoryLotInfo {
  return {
    lotId: lot.id,
    itemId: item.id,
    itemCode: item.code,
    itemName: item.name,
    category: item.category,
    itemStatus: item.status,
    lotNumber: lot.lotNumber,
    expiryDate: lot.expiryDate,
  };
}
