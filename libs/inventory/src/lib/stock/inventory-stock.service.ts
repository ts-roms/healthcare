import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  localDate,
  NotFoundError,
  requireFacilityId,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, gt, gte, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { adjustSchema, issueSchema, receiveSchema, stockQuerySchema, transferSchema, writeOffSchema } from "../inventory.dto";
import { type Allocation, allocateFefo, crossedReorderLevel, expiryStatus, isExpired, stockStatus } from "../inventory.rules";
import {
  inventoryBalance,
  inventoryItem,
  inventoryLocation,
  inventoryLot,
  inventoryMovement,
  inventoryStockLevel,
  inventorySupplier,
  type ItemRecord,
  type LocationRecord,
  type LotRecord,
  type MovementKind,
  type MovementRecord,
} from "../inventory.schema";
import { found, strip } from "../inventory-support";

interface Posting {
  kind: MovementKind;
  locationId: string;
  itemId: string;
  lotId: string;
  /** Signed change at the location. */
  delta: number;
  supplierId?: string | null;
  unitCost?: number | null;
  reference?: string | null;
  issuedTo?: string | null;
  reason?: string | null;
}

/**
 * Stock movements and views. Every movement is posted to the append-only ledger
 * and the location's balance in one transaction, with the balance rows locked;
 * stock never goes negative (service check and database constraint). Issues and
 * transfers take lots first-expiry-first-out unless a lot is named, and never
 * from an expired lot (expired stock is written off). Controlled items need a
 * reason and a reference on every movement.
 */
@Injectable()
export class InventoryStockService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  // ---- movements -----------------------------------------------------------------------------

  async receive(actor: Actor, input: z.infer<typeof receiveSchema>) {
    const replay = await this.replay(actor, input.idempotencyKey);
    if (replay) return replay;
    const { location, item, today } = await this.context(actor, input.locationId, input.itemId);
    this.requireControlledDetails(item, input);
    if (item.tracksLots && !input.lotNumber) throw new BusinessRuleError(`${item.name} is tracked by lot: give the lot number (and expiry)`, "lot_required");
    if (input.supplierId) {
      found(
        (
          await this.db
            .select({ id: inventorySupplier.id })
            .from(inventorySupplier)
            .where(and(eq(inventorySupplier.organizationId, actor.organizationId), eq(inventorySupplier.id, input.supplierId)))
        )[0],
        "Supplier",
      );
    }
    return this.transaction(actor, "inventory.receive", input.idempotencyKey, today, async (tx) => {
      const lot = await this.lotFor(
        tx,
        actor.organizationId,
        item,
        item.tracksLots ? (input.lotNumber ?? null) : null,
        item.tracksLots ? (input.expiryDate ?? null) : null,
      );
      return [
        {
          kind: "receipt",
          locationId: location.id,
          itemId: item.id,
          lotId: lot.id,
          delta: input.quantity,
          supplierId: input.supplierId ?? null,
          unitCost: input.unitCost ?? null,
          reference: input.reference ?? null,
          reason: input.reason ?? null,
        },
      ];
    });
  }

  async issue(actor: Actor, input: z.infer<typeof issueSchema>) {
    const replay = await this.replay(actor, input.idempotencyKey);
    if (replay) return replay;
    const { location, item, today } = await this.context(actor, input.locationId, input.itemId);
    this.requireControlledDetails(item, input);
    return this.transaction(actor, "inventory.issue", input.idempotencyKey, today, async (tx) => {
      const allocations = await this.allocate(tx, location.id, item, input.quantity, today, input.lotId);
      return allocations.map((a) => ({
        kind: "issue" as const,
        locationId: location.id,
        itemId: item.id,
        lotId: a.lotId,
        delta: -a.quantity,
        issuedTo: input.issuedTo,
        reference: input.reference ?? null,
        reason: input.reason ?? null,
      }));
    });
  }

  /** From a location of the actor's facility to another location of the organization (another branch included). */
  async transfer(actor: Actor, input: z.infer<typeof transferSchema>) {
    const replay = await this.replay(actor, input.idempotencyKey);
    if (replay) return replay;
    const { location: from, item, today } = await this.context(actor, input.fromLocationId, input.itemId);
    const to = await this.location(actor.organizationId, input.toLocationId);
    if (to.status !== "active") throw new BusinessRuleError("The destination location is inactive", "location_inactive");
    this.requireControlledDetails(item, input);
    return this.transaction(actor, "inventory.transfer", input.idempotencyKey, today, async (tx) => {
      const allocations = await this.allocate(tx, from.id, item, input.quantity, today, input.lotId);
      return allocations.flatMap((a): Posting[] => [
        {
          kind: "transfer_out",
          locationId: from.id,
          itemId: item.id,
          lotId: a.lotId,
          delta: -a.quantity,
          reference: input.reference ?? null,
          reason: input.reason ?? null,
        },
        {
          kind: "transfer_in",
          locationId: to.id,
          itemId: item.id,
          lotId: a.lotId,
          delta: a.quantity,
          reference: input.reference ?? null,
          reason: input.reason ?? null,
        },
      ]);
    });
  }

  /** A physical count: the difference to the recorded balance is posted, with the reason. */
  async adjust(actor: Actor, input: z.infer<typeof adjustSchema>) {
    const replay = await this.replay(actor, input.idempotencyKey);
    if (replay) return replay;
    const lot = await this.lot(actor.organizationId, input.lotId);
    const { location, item, today } = await this.context(actor, input.locationId, lot.itemId);
    this.requireControlledDetails(item, input);
    return this.transaction(actor, "inventory.adjust", input.idempotencyKey, today, async (tx) => {
      const current = await this.lockBalance(tx, actor.organizationId, location.id, item.id, lot.id);
      const delta = input.countedQuantity - current;
      if (delta === 0) throw new BusinessRuleError("The count matches the recorded balance; nothing to adjust", "count_matches");
      return [{ kind: "adjustment", locationId: location.id, itemId: item.id, lotId: lot.id, delta, reason: input.reason, reference: input.reference ?? null }];
    });
  }

  /** Expired, damaged or lost stock leaves the books, with the reason. */
  async writeOff(actor: Actor, input: z.infer<typeof writeOffSchema>) {
    const replay = await this.replay(actor, input.idempotencyKey);
    if (replay) return replay;
    const lot = await this.lot(actor.organizationId, input.lotId);
    const { location, item, today } = await this.context(actor, input.locationId, lot.itemId);
    this.requireControlledDetails(item, input);
    return this.transaction(actor, "inventory.write-off", input.idempotencyKey, today, async () => [
      {
        kind: "write_off",
        locationId: location.id,
        itemId: item.id,
        lotId: lot.id,
        delta: -input.quantity,
        reason: input.reason,
        reference: input.reference ?? null,
      },
    ]);
  }

  // ---- views ---------------------------------------------------------------------------------

  /**
   * Stock at the actor's facility (or one of its locations): per location and item, the quantity on hand, the lots
   * with their expiry, the reorder level and status. "low" keeps items out of stock or at/below their reorder level;
   * "expiring" keeps lots expired or expiring within `withinDays`.
   */
  async stock(actor: Actor, query: z.infer<typeof stockQuerySchema>) {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const today = localDate(new Date(), facility.timezone);
    const locations = await this.facilityLocations(actor.organizationId, facilityId, query.locationId);
    const locationIds = locations.map((l) => l.id);
    if (locationIds.length === 0) return { today, rows: [] };
    const [balances, levels] = await Promise.all([
      this.db
        .select({ balance: inventoryBalance, lot: inventoryLot })
        .from(inventoryBalance)
        .innerJoin(inventoryLot, eq(inventoryLot.id, inventoryBalance.lotId))
        .where(and(inArray(inventoryBalance.locationId, locationIds), gt(inventoryBalance.quantity, 0))),
      this.db.select().from(inventoryStockLevel).where(inArray(inventoryStockLevel.locationId, locationIds)),
    ]);
    const itemIds = [...new Set([...balances.map((b) => b.balance.itemId), ...levels.map((l) => l.itemId)])];
    const items = itemIds.length
      ? await this.db
          .select()
          .from(inventoryItem)
          .where(and(eq(inventoryItem.organizationId, actor.organizationId), inArray(inventoryItem.id, itemIds)))
      : [];
    const itemById = new Map(items.map((i) => [i.id, i]));
    const key = (locationId: string, itemId: string) => `${locationId}|${itemId}`;
    const keys = new Set([...balances.map((b) => key(b.balance.locationId, b.balance.itemId)), ...levels.map((l) => key(l.locationId, l.itemId))]);
    const rows = [...keys].map((k) => {
      const [locationId, itemId] = k.split("|") as [string, string];
      const lots = balances
        .filter((b) => b.balance.locationId === locationId && b.balance.itemId === itemId)
        .map((b) => ({
          lotId: b.lot.id,
          lotNumber: b.lot.lotNumber,
          expiryDate: b.lot.expiryDate,
          quantity: b.balance.quantity,
          expiry: expiryStatus(b.lot.expiryDate, today, query.withinDays),
        }))
        .sort((a, b) => (a.expiryDate ?? "9999-12-31").localeCompare(b.expiryDate ?? "9999-12-31"));
      const onHand = lots.reduce((sum, l) => sum + l.quantity, 0);
      const usable = lots.filter((l) => l.expiry !== "expired").reduce((sum, l) => sum + l.quantity, 0);
      const reorderLevel = levels.find((l) => l.locationId === locationId && l.itemId === itemId)?.reorderLevel ?? null;
      const item = itemById.get(itemId)!;
      return {
        location: { id: locationId, name: locations.find((l) => l.id === locationId)!.name },
        item: { id: item.id, code: item.code, name: item.name, category: item.category, stockUnit: item.stockUnit, controlled: item.controlled },
        onHand,
        usable,
        reorderLevel,
        status: stockStatus(usable, reorderLevel),
        lots,
      };
    });
    const filtered =
      query.show === "low"
        ? rows.filter((r) => r.status !== "ok")
        : query.show === "expiring"
          ? rows.map((r) => ({ ...r, lots: r.lots.filter((l) => l.expiry === "expired" || l.expiry === "expiring") })).filter((r) => r.lots.length > 0)
          : rows;
    return { today, rows: filtered.sort((a, b) => a.item.name.localeCompare(b.item.name) || a.location.name.localeCompare(b.location.name)) };
  }

  /** Recent movements at the actor's facility, optionally for one item or location. */
  async movements(actor: Actor, query: { itemId?: string; locationId?: string }) {
    const facilityId = requireFacilityId(actor);
    const locations = await this.facilityLocations(actor.organizationId, facilityId, query.locationId);
    if (locations.length === 0) return [];
    // A transfer between this facility and another shows both sides.
    const conditions: SQL[] = [
      eq(inventoryMovement.organizationId, actor.organizationId),
      inArray(
        inventoryMovement.locationId,
        locations.map((l) => l.id),
      ),
    ];
    if (query.itemId) conditions.push(eq(inventoryMovement.itemId, query.itemId));
    const rows = await this.db
      .select({
        movement: inventoryMovement,
        lot: inventoryLot,
        itemName: inventoryItem.name,
        stockUnit: inventoryItem.stockUnit,
        locationName: inventoryLocation.name,
      })
      .from(inventoryMovement)
      .innerJoin(inventoryLot, eq(inventoryLot.id, inventoryMovement.lotId))
      .innerJoin(inventoryItem, eq(inventoryItem.id, inventoryMovement.itemId))
      .innerJoin(inventoryLocation, eq(inventoryLocation.id, inventoryMovement.locationId))
      .where(and(...conditions))
      .orderBy(desc(inventoryMovement.recordedAt), asc(inventoryMovement.kind))
      .limit(200);
    return rows.map((r) => ({
      ...movementView(r.movement),
      itemName: r.itemName,
      stockUnit: r.stockUnit,
      locationName: r.locationName,
      lotNumber: r.lot.lotNumber,
      expiryDate: r.lot.expiryDate,
    }));
  }

  // ---- internals -----------------------------------------------------------------------------

  /** Posts the movements of one operation atomically, audits it, and announces reorder-level crossings. */
  private async transaction(actor: Actor, action: string, idempotencyKey: string, today: string, build: (tx: DbExecutor) => Promise<Posting[]>) {
    const groupId = randomUUID();
    const low: Array<{ itemId: string; locationId: string; onHand: number; reorderLevel: number }> = [];
    await this.db.transaction(async (tx) => {
      const postings = await build(tx);
      const before = new Map<string, number>();
      for (const p of postings) {
        const key = `${p.locationId}|${p.itemId}`;
        if (!before.has(key)) before.set(key, await this.usableTotal(tx, p.locationId, p.itemId, today));
      }
      let first = true;
      for (const p of postings) {
        const current = await this.lockBalance(tx, actor.organizationId, p.locationId, p.itemId, p.lotId);
        const next = current + p.delta;
        if (next < 0) throw new BusinessRuleError(`Not enough stock in this lot (${current} on hand)`, "insufficient_stock");
        await tx
          .update(inventoryBalance)
          .set({ quantity: next, updatedAt: new Date() })
          .where(and(eq(inventoryBalance.locationId, p.locationId), eq(inventoryBalance.lotId, p.lotId)));
        await tx.insert(inventoryMovement).values({
          organizationId: actor.organizationId,
          movementGroupId: groupId,
          kind: p.kind,
          locationId: p.locationId,
          itemId: p.itemId,
          lotId: p.lotId,
          quantity: p.delta,
          balanceAfter: next,
          supplierId: p.supplierId ?? null,
          unitCost: p.unitCost ?? null,
          reference: p.reference ?? null,
          issuedTo: p.issuedTo ?? null,
          reason: p.reason ?? null,
          idempotencyKey: first ? idempotencyKey : null,
          recordedBy: actor.userId,
        });
        first = false;
      }
      for (const [key, total] of before) {
        const [locationId, itemId] = key.split("|") as [string, string];
        const after = await this.usableTotal(tx, locationId, itemId, today);
        const [level] = await tx
          .select({ reorderLevel: inventoryStockLevel.reorderLevel })
          .from(inventoryStockLevel)
          .where(and(eq(inventoryStockLevel.locationId, locationId), eq(inventoryStockLevel.itemId, itemId)));
        if (level && crossedReorderLevel(total, after, level.reorderLevel)) low.push({ itemId, locationId, onHand: after, reorderLevel: level.reorderLevel });
      }
      await this.audit.record(tx, actor, {
        action,
        resourceType: "inventory_item",
        resourceId: postings[0]!.itemId,
        reason: postings.find((p) => p.reason)?.reason ?? undefined,
        metadata: {
          movementGroupId: groupId,
          movements: postings.map((p) => ({ kind: p.kind, locationId: p.locationId, lotId: p.lotId, quantity: p.delta })),
          reference: postings[0]!.reference ?? null,
        },
      });
      if (low.length) {
        await this.events.record(
          tx,
          ...low.map((l) => ({
            type: "InventoryStockLow",
            organizationId: actor.organizationId,
            aggregateType: "inventory_item",
            aggregateId: l.itemId,
            facilityId: actor.facilityId ?? null,
            payload: { locationId: l.locationId, onHand: l.onHand, reorderLevel: l.reorderLevel },
          })),
        );
      }
    });
    return this.group(actor.organizationId, groupId);
  }

  /** The same idempotency key returns the movements it already produced. */
  private async replay(actor: Actor, idempotencyKey: string) {
    const [first] = await this.db
      .select({ groupId: inventoryMovement.movementGroupId })
      .from(inventoryMovement)
      .where(and(eq(inventoryMovement.organizationId, actor.organizationId), eq(inventoryMovement.idempotencyKey, idempotencyKey)));
    return first ? this.group(actor.organizationId, first.groupId) : null;
  }

  private async group(organizationId: string, groupId: string) {
    const rows = await this.db
      .select()
      .from(inventoryMovement)
      .where(and(eq(inventoryMovement.organizationId, organizationId), eq(inventoryMovement.movementGroupId, groupId)))
      .orderBy(asc(inventoryMovement.recordedAt));
    return { movementGroupId: groupId, movements: rows.map(movementView) };
  }

  /** The location (of the actor's facility, active) and the item (of the organization, active). */
  private async context(actor: Actor, locationId: string, itemId: string) {
    const facilityId = requireFacilityId(actor);
    const location = await this.location(actor.organizationId, locationId);
    if (location.facilityId !== facilityId) throw new BusinessRuleError("The location belongs to another facility", "location_other_facility");
    if (location.status !== "active") throw new BusinessRuleError("The location is inactive", "location_inactive");
    const [item] = await this.db
      .select()
      .from(inventoryItem)
      .where(and(eq(inventoryItem.organizationId, actor.organizationId), eq(inventoryItem.id, itemId)));
    if (!item) throw new NotFoundError("Item");
    if (item.status !== "active") throw new BusinessRuleError("The item is inactive", "item_inactive");
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    return { location, item, today: localDate(new Date(), facility.timezone) };
  }

  private async location(organizationId: string, locationId: string): Promise<LocationRecord> {
    const [row] = await this.db
      .select()
      .from(inventoryLocation)
      .where(and(eq(inventoryLocation.organizationId, organizationId), eq(inventoryLocation.id, locationId)));
    return found(row, "Location");
  }

  private async lot(organizationId: string, lotId: string): Promise<LotRecord> {
    const [row] = await this.db
      .select()
      .from(inventoryLot)
      .where(and(eq(inventoryLot.organizationId, organizationId), eq(inventoryLot.id, lotId)));
    return found(row, "Lot");
  }

  private facilityLocations(organizationId: string, facilityId: string, locationId?: string) {
    const conditions = [eq(inventoryLocation.organizationId, organizationId), eq(inventoryLocation.facilityId, facilityId)];
    if (locationId) conditions.push(eq(inventoryLocation.id, locationId));
    return this.db
      .select()
      .from(inventoryLocation)
      .where(and(...conditions))
      .orderBy(asc(inventoryLocation.name));
  }

  /** The lot with this number and expiry (created on first receipt); items without lot tracking use one implicit lot. */
  private async lotFor(tx: DbExecutor, organizationId: string, item: ItemRecord, lotNumber: string | null, expiryDate: string | null): Promise<LotRecord> {
    const where = and(
      eq(inventoryLot.itemId, item.id),
      lotNumber === null ? isNull(inventoryLot.lotNumber) : eq(inventoryLot.lotNumber, lotNumber),
      expiryDate === null ? isNull(inventoryLot.expiryDate) : eq(inventoryLot.expiryDate, expiryDate),
    );
    const [existing] = await tx.select().from(inventoryLot).where(where);
    if (existing) return existing;
    await tx.insert(inventoryLot).values({ organizationId, itemId: item.id, lotNumber, expiryDate }).onConflictDoNothing();
    const [created] = await tx.select().from(inventoryLot).where(where);
    return created!;
  }

  /** Locks (creating if needed) the balance row of a lot at a location and returns its quantity. */
  private async lockBalance(tx: DbExecutor, organizationId: string, locationId: string, itemId: string, lotId: string): Promise<number> {
    await tx.insert(inventoryBalance).values({ organizationId, locationId, itemId, lotId, quantity: 0 }).onConflictDoNothing();
    const [row] = await tx
      .select({ quantity: inventoryBalance.quantity })
      .from(inventoryBalance)
      .where(and(eq(inventoryBalance.locationId, locationId), eq(inventoryBalance.lotId, lotId)))
      .for("update");
    return row!.quantity;
  }

  /** Usable stock of an item at a location: expired lots do not count (as in the stock view). */
  private async usableTotal(tx: DbExecutor, locationId: string, itemId: string, today: string): Promise<number> {
    const [row] = await tx
      .select({ total: sql<number>`coalesce(sum(${inventoryBalance.quantity}), 0)`.mapWith(Number) })
      .from(inventoryBalance)
      .innerJoin(inventoryLot, eq(inventoryLot.id, inventoryBalance.lotId))
      .where(
        and(
          eq(inventoryBalance.locationId, locationId),
          eq(inventoryBalance.itemId, itemId),
          or(isNull(inventoryLot.expiryDate), gte(inventoryLot.expiryDate, today)),
        ),
      );
    return row?.total ?? 0;
  }

  /** Which lots to take: the named one (not expired), or first-expiry-first-out across the location's usable lots. */
  private async allocate(tx: DbExecutor, locationId: string, item: ItemRecord, quantity: number, today: string, lotId?: string): Promise<Allocation[]> {
    const lots = await tx
      .select({ lotId: inventoryLot.id, lotNumber: inventoryLot.lotNumber, expiryDate: inventoryLot.expiryDate, quantity: inventoryBalance.quantity })
      .from(inventoryBalance)
      .innerJoin(inventoryLot, eq(inventoryLot.id, inventoryBalance.lotId))
      .where(and(eq(inventoryBalance.locationId, locationId), eq(inventoryBalance.itemId, item.id), gt(inventoryBalance.quantity, 0)));
    if (lotId) {
      const lot = lots.find((l) => l.lotId === lotId);
      if (!lot) throw new BusinessRuleError("That lot has no stock at this location", "lot_not_here");
      if (isExpired(lot.expiryDate, today))
        throw new BusinessRuleError(`Lot ${lot.lotNumber ?? ""} expired on ${lot.expiryDate}; write it off instead`, "lot_expired");
      if (lot.quantity < quantity) throw new BusinessRuleError(`Not enough stock in this lot (${lot.quantity} on hand)`, "insufficient_stock");
      return [{ lotId, quantity }];
    }
    const result = allocateFefo(lots, quantity, today);
    if (!result.ok) {
      throw new BusinessRuleError(
        `Not enough usable ${item.name} here: ${result.available} ${item.stockUnit} available (expired lots excluded)`,
        "insufficient_stock",
        {
          available: result.available,
        },
      );
    }
    return result.allocations;
  }

  private requireControlledDetails(item: ItemRecord, input: { reason?: string; reference?: string }): void {
    if (item.controlled && (!input.reason || !input.reference)) {
      throw new BusinessRuleError(`${item.name} is a controlled item: every movement needs a reason and a reference`, "controlled_item_details");
    }
  }
}

function movementView(row: MovementRecord) {
  return { ...strip(row), recordedAt: row.recordedAt.toISOString() };
}
