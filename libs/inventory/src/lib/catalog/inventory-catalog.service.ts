import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, ConflictError, DATABASE, type Database, requireFacilityId } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { createItemSchema, createLocationSchema, createSupplierSchema, updateItemSchema } from "../inventory.dto";
import {
  inventoryItem,
  inventoryLocation,
  inventoryStockLevel,
  inventorySupplier,
  type ItemRecord,
  type LocationRecord,
  type SupplierRecord,
} from "../inventory.schema";
import { assertVersion, found, strip } from "../inventory-support";

/** Items, suppliers, storage locations and reorder levels. */
@Injectable()
export class InventoryCatalogService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
  ) {}

  async items(organizationId: string) {
    const rows = await this.db.select().from(inventoryItem).where(eq(inventoryItem.organizationId, organizationId)).orderBy(asc(inventoryItem.name));
    return rows.map(strip);
  }

  async createItem(actor: Actor, input: z.infer<typeof createItemSchema>) {
    return this.db.transaction(async (tx) => {
      const [row] = (await tx
        .insert(inventoryItem)
        .values({ organizationId: actor.organizationId, ...input })
        .onConflictDoNothing()
        .returning()) as ItemRecord[];
      if (!row) throw new ConflictError(`An item with code ${input.code} exists`, undefined, "item_code_exists");
      await this.audit.record(tx, actor, {
        action: "inventory.item.create",
        resourceType: "inventory_item",
        resourceId: row.id,
        metadata: { code: row.code, controlled: row.controlled },
      });
      return strip(row);
    });
  }

  /** Name, category, controlled flag and status. The stock unit and lot tracking are fixed once created (stock is counted in them). */
  async updateItem(actor: Actor, itemId: string, input: z.infer<typeof updateItemSchema>) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(inventoryItem)
        .where(and(eq(inventoryItem.organizationId, actor.organizationId), eq(inventoryItem.id, itemId)))
        .for("update");
      const item = found(current, "Item");
      assertVersion(item.version, input.version, "Item");
      const { version: _v, ...changes } = input;
      const [row] = (await tx
        .update(inventoryItem)
        .set({ ...changes, updatedAt: new Date(), version: item.version + 1 })
        .where(eq(inventoryItem.id, itemId))
        .returning()) as [ItemRecord];
      await this.audit.record(tx, actor, {
        action: "inventory.item.update",
        resourceType: "inventory_item",
        resourceId: itemId,
        changes: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, { from: item[k as keyof ItemRecord], to: v }])),
      });
      return strip(row);
    });
  }

  async suppliers(organizationId: string) {
    const rows = await this.db
      .select()
      .from(inventorySupplier)
      .where(eq(inventorySupplier.organizationId, organizationId))
      .orderBy(asc(inventorySupplier.name));
    return rows.map(strip);
  }

  async createSupplier(actor: Actor, input: z.infer<typeof createSupplierSchema>) {
    return this.db.transaction(async (tx) => {
      const [row] = (await tx
        .insert(inventorySupplier)
        .values({ organizationId: actor.organizationId, code: input.code, name: input.name, contact: input.contact ?? null })
        .onConflictDoNothing()
        .returning()) as SupplierRecord[];
      if (!row) throw new ConflictError(`A supplier with code ${input.code} exists`, undefined, "supplier_code_exists");
      await this.audit.record(tx, actor, {
        action: "inventory.supplier.create",
        resourceType: "inventory_supplier",
        resourceId: row.id,
        metadata: { code: row.code },
      });
      return strip(row);
    });
  }

  /** Locations of one facility (or all the organization's when no facility is given). */
  async locations(organizationId: string, facilityId?: string) {
    const conditions = [eq(inventoryLocation.organizationId, organizationId)];
    if (facilityId) conditions.push(eq(inventoryLocation.facilityId, facilityId));
    const rows = await this.db
      .select()
      .from(inventoryLocation)
      .where(and(...conditions))
      .orderBy(asc(inventoryLocation.name));
    return rows.map(strip);
  }

  async createLocation(actor: Actor, input: z.infer<typeof createLocationSchema>) {
    await this.organizations.getFacility(actor.organizationId, input.facilityId);
    return this.db.transaction(async (tx) => {
      const [row] = (await tx
        .insert(inventoryLocation)
        .values({ organizationId: actor.organizationId, facilityId: input.facilityId, code: input.code, name: input.name })
        .onConflictDoNothing()
        .returning()) as LocationRecord[];
      if (!row) throw new ConflictError(`A location with code ${input.code} exists at this facility`, undefined, "location_code_exists");
      await this.audit.record(tx, actor, {
        action: "inventory.location.create",
        resourceType: "inventory_location",
        resourceId: row.id,
        metadata: { code: row.code },
      });
      return strip(row);
    });
  }

  /** Reorder level (and the quantity usually ordered, for purchase suggestions) of an item at a location of the actor's facility. */
  async setReorderLevel(actor: Actor, locationId: string, itemId: string, reorderLevel: number, reorderQuantity: number | null = null) {
    const facilityId = requireFacilityId(actor);
    return this.db.transaction(async (tx) => {
      const [location] = await tx
        .select()
        .from(inventoryLocation)
        .where(and(eq(inventoryLocation.organizationId, actor.organizationId), eq(inventoryLocation.id, locationId)));
      if (found(location, "Location").facilityId !== facilityId)
        throw new BusinessRuleError("The location belongs to another facility", "location_other_facility");
      found(
        (
          await tx
            .select({ id: inventoryItem.id })
            .from(inventoryItem)
            .where(and(eq(inventoryItem.organizationId, actor.organizationId), eq(inventoryItem.id, itemId)))
        )[0],
        "Item",
      );
      await tx
        .insert(inventoryStockLevel)
        .values({ organizationId: actor.organizationId, locationId, itemId, reorderLevel, reorderQuantity, updatedBy: actor.userId })
        .onConflictDoUpdate({
          target: [inventoryStockLevel.locationId, inventoryStockLevel.itemId],
          set: { reorderLevel, reorderQuantity, updatedBy: actor.userId, updatedAt: sql`now()` },
        });
      await this.audit.record(tx, actor, {
        action: "inventory.reorder-level.set",
        resourceType: "inventory_item",
        resourceId: itemId,
        metadata: { locationId, reorderLevel, reorderQuantity },
      });
      return { locationId, itemId, reorderLevel, reorderQuantity };
    });
  }
}
