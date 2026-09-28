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
  ForbiddenError,
  localDate,
  NotFoundError,
  requireFacilityId,
} from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, asc, desc, eq, gte, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import { purchaseOrderAllows, purchaseOrderNumber, type PurchaseOrderAction, reorderSuggestion, statusAfterReceipt } from "../inventory.rules";
import {
  inventoryBalance,
  inventoryItem,
  inventoryLocation,
  inventoryLot,
  inventoryMovement,
  inventoryNumberSequence,
  inventoryPurchaseOrder,
  inventoryPurchaseOrderLine,
  inventoryStockLevel,
  inventorySupplier,
  type PurchaseOrderLineRecord,
  type PurchaseOrderRecord,
} from "../inventory.schema";
import { assertVersion, found } from "../inventory-support";
import { InventoryStockService } from "../stock/inventory-stock.service";
import type {
  createPurchaseOrderSchema,
  endPurchaseOrderSchema,
  purchaseOrderQuerySchema,
  receivePurchaseOrderSchema,
  updatePurchaseOrderSchema,
} from "./procurement.dto";

/** Orders still expecting goods (what counts as "on order"). */
const OPEN_FOR_DELIVERY = ["submitted", "approved", "partially_received"] as const;

/**
 * Purchase orders (Phase 9): drafted per facility for a supplier and a delivery location, submitted, approved by
 * someone other than the submitter, then received in one or more deliveries (receipts posted to the stock ledger
 * against the order's lines, never more than ordered), cancelled before anything arrives, or closed short.
 */
@Injectable()
export class PurchaseOrderService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly stock: InventoryStockService,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  async list(actor: Actor, query: z.infer<typeof purchaseOrderQuerySchema>) {
    const facilityId = requireFacilityId(actor);
    const conditions: SQL[] = [eq(inventoryPurchaseOrder.organizationId, actor.organizationId), eq(inventoryPurchaseOrder.facilityId, facilityId)];
    if (query.status === "open") conditions.push(inArray(inventoryPurchaseOrder.status, ["draft", ...OPEN_FOR_DELIVERY]));
    else if (query.status) conditions.push(eq(inventoryPurchaseOrder.status, query.status));
    const orders = await this.db
      .select()
      .from(inventoryPurchaseOrder)
      .where(and(...conditions))
      .orderBy(desc(inventoryPurchaseOrder.createdAt))
      .limit(200);
    return this.views(this.db, actor, orders);
  }

  async get(actor: Actor, purchaseOrderId: string) {
    const order = await this.find(this.db, actor, purchaseOrderId);
    const [view] = await this.views(this.db, actor, [order]);
    return view!;
  }

  async create(actor: Actor, input: z.infer<typeof createPurchaseOrderSchema>) {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const year = Number(localDate(new Date(), facility.timezone).slice(0, 4));
    const order = await this.db.transaction(async (tx) => {
      await this.checkParties(tx, actor, input.supplierId, input.locationId);
      await this.checkItems(tx, actor, input.lines);
      const [counter] = await tx
        .insert(inventoryNumberSequence)
        .values({ organizationId: actor.organizationId, series: "purchase_order", year, nextValue: 1 })
        .onConflictDoUpdate({
          target: [inventoryNumberSequence.organizationId, inventoryNumberSequence.series, inventoryNumberSequence.year],
          set: { nextValue: sql`${inventoryNumberSequence.nextValue} + 1` },
        })
        .returning({ value: inventoryNumberSequence.nextValue });
      const [created] = await tx
        .insert(inventoryPurchaseOrder)
        .values({
          organizationId: actor.organizationId,
          facilityId,
          poNumber: purchaseOrderNumber(year, counter!.value),
          supplierId: input.supplierId,
          locationId: input.locationId,
          expectedDate: input.expectedDate ?? null,
          notes: input.notes ?? null,
          createdBy: actor.userId,
        })
        .returning();
      const order = found(created, "Purchase order");
      await this.insertLines(tx, actor, order.id, input.lines);
      await this.audit.record(tx, actor, {
        action: "inventory.purchase-order.create",
        resourceType: "inventory_purchase_order",
        resourceId: order.id,
        metadata: { poNumber: order.poNumber, supplierId: order.supplierId, lines: input.lines.length },
      });
      return order;
    });
    return this.get(actor, order.id);
  }

  /** Replaces a draft's supplier, delivery location, notes and lines. */
  async update(actor: Actor, purchaseOrderId: string, input: z.infer<typeof updatePurchaseOrderSchema>) {
    await this.db.transaction(async (tx) => {
      const order = await this.lockFor(tx, actor, purchaseOrderId, "edit", input.version);
      await this.checkParties(tx, actor, input.supplierId, input.locationId);
      await this.checkItems(tx, actor, input.lines);
      await tx.delete(inventoryPurchaseOrderLine).where(eq(inventoryPurchaseOrderLine.purchaseOrderId, order.id));
      await this.insertLines(tx, actor, order.id, input.lines);
      await this.save(tx, order, {
        supplierId: input.supplierId,
        locationId: input.locationId,
        expectedDate: input.expectedDate,
        notes: input.notes,
      });
      await this.audit.record(tx, actor, {
        action: "inventory.purchase-order.update",
        resourceType: "inventory_purchase_order",
        resourceId: order.id,
        metadata: { poNumber: order.poNumber, lines: input.lines.length },
      });
    });
    return this.get(actor, purchaseOrderId);
  }

  async submit(actor: Actor, purchaseOrderId: string, version: number) {
    await this.db.transaction(async (tx) => {
      const order = await this.lockFor(tx, actor, purchaseOrderId, "submit", version);
      await this.save(tx, order, { status: "submitted", submittedBy: actor.userId, submittedAt: new Date() });
      await this.audit.record(tx, actor, {
        action: "inventory.purchase-order.submit",
        resourceType: "inventory_purchase_order",
        resourceId: order.id,
        metadata: { poNumber: order.poNumber },
      });
      await this.events.record(tx, this.event("InventoryPurchaseOrderSubmitted", order));
    });
    return this.get(actor, purchaseOrderId);
  }

  /** Separation of duties: the person who submitted an order cannot approve it (also a database constraint). */
  async approve(actor: Actor, purchaseOrderId: string, version: number) {
    await this.db.transaction(async (tx) => {
      const order = await this.lockFor(tx, actor, purchaseOrderId, "approve", version);
      if (order.submittedBy === actor.userId) throw new ForbiddenError("You submitted this purchase order; someone else approves it");
      await this.save(tx, order, { status: "approved", approvedBy: actor.userId, approvedAt: new Date() });
      await this.audit.record(tx, actor, {
        action: "inventory.purchase-order.approve",
        resourceType: "inventory_purchase_order",
        resourceId: order.id,
        metadata: { poNumber: order.poNumber },
      });
      await this.events.record(tx, this.event("InventoryPurchaseOrderApproved", order));
    });
    return this.get(actor, purchaseOrderId);
  }

  /** Withdraws an order before anything arrives. */
  async cancel(actor: Actor, purchaseOrderId: string, input: z.infer<typeof endPurchaseOrderSchema>) {
    return this.end(actor, purchaseOrderId, input, "cancel");
  }

  /** Closes an order short: no more deliveries are expected. */
  async close(actor: Actor, purchaseOrderId: string, input: z.infer<typeof endPurchaseOrderSchema>) {
    return this.end(actor, purchaseOrderId, input, "close");
  }

  /**
   * Receives a delivery against an approved order: one receipt per line into the order's delivery location (lot and
   * expiry for lot-tracked items, the agreed unit cost, the supplier's delivery reference), in one movement group.
   * Never more than was ordered. Replaying the idempotency key returns the order unchanged.
   */
  async receive(actor: Actor, purchaseOrderId: string, input: z.infer<typeof receivePurchaseOrderSchema>) {
    if (await this.stock.replayed(actor.organizationId, input.idempotencyKey)) return this.get(actor, purchaseOrderId);
    await this.db.transaction(async (tx) => {
      const order = await this.lockFor(tx, actor, purchaseOrderId, "receive");
      const lines = await tx.select().from(inventoryPurchaseOrderLine).where(eq(inventoryPurchaseOrderLine.purchaseOrderId, order.id));
      const byId = new Map(lines.map((l) => [l.id, l]));
      if (new Set(input.lines.map((l) => l.lineId)).size !== input.lines.length)
        throw new BusinessRuleError("Each order line appears once per delivery", "duplicate_line");
      for (const received of input.lines) {
        const line = byId.get(received.lineId);
        if (!line) throw new NotFoundError("Purchase order line");
        const outstanding = line.quantityOrdered - line.quantityReceived;
        if (received.quantity > outstanding) {
          throw new BusinessRuleError(`Line ${line.lineNumber}: only ${outstanding} still expected on this order`, "over_receipt", {
            lineId: line.id,
            outstanding,
          });
        }
      }
      const movementGroupId = await this.stock.receiveFor(tx, actor, {
        locationId: order.locationId,
        supplierId: order.supplierId,
        reference: input.reference,
        reason: input.reason ?? `Delivery for ${order.poNumber}`,
        idempotencyKey: input.idempotencyKey,
        lines: input.lines.map((r) => {
          const line = byId.get(r.lineId)!;
          return {
            itemId: line.itemId,
            quantity: r.quantity,
            lotNumber: r.lotNumber,
            expiryDate: r.expiryDate,
            unitCost: line.unitCost,
            source: { type: "purchase_order_line" as const, id: line.id },
          };
        }),
      });
      for (const r of input.lines) {
        await tx
          .update(inventoryPurchaseOrderLine)
          .set({ quantityReceived: sql`${inventoryPurchaseOrderLine.quantityReceived} + ${r.quantity}` })
          .where(eq(inventoryPurchaseOrderLine.id, r.lineId));
      }
      const after = lines.map((l) => ({ ...l, quantityReceived: l.quantityReceived + (input.lines.find((r) => r.lineId === l.id)?.quantity ?? 0) }));
      const status = statusAfterReceipt(after);
      await this.save(tx, order, { status });
      await this.audit.record(tx, actor, {
        action: "inventory.purchase-order.receive",
        resourceType: "inventory_purchase_order",
        resourceId: order.id,
        metadata: { poNumber: order.poNumber, movementGroupId, reference: input.reference, status },
      });
      await this.events.record(tx, this.event("InventoryPurchaseOrderReceived", order, { movementGroupId, status }));
    });
    return this.get(actor, purchaseOrderId);
  }

  /**
   * Items to reorder at the facility's locations: usable stock (expired lots excluded) plus what is already on open
   * orders is at or below the reorder level. With the last supplier and unit cost received at that location.
   */
  async suggestions(actor: Actor, locationId?: string) {
    const facilityId = requireFacilityId(actor);
    const facility = await this.organizations.getFacility(actor.organizationId, facilityId);
    const today = localDate(new Date(), facility.timezone);
    const levels = await this.db
      .select({ level: inventoryStockLevel, location: inventoryLocation, item: inventoryItem })
      .from(inventoryStockLevel)
      .innerJoin(inventoryLocation, eq(inventoryLocation.id, inventoryStockLevel.locationId))
      .innerJoin(inventoryItem, eq(inventoryItem.id, inventoryStockLevel.itemId))
      .where(
        and(
          eq(inventoryLocation.organizationId, actor.organizationId),
          eq(inventoryLocation.facilityId, facilityId),
          eq(inventoryLocation.status, "active"),
          eq(inventoryItem.status, "active"),
          locationId ? eq(inventoryLocation.id, locationId) : undefined,
        ),
      );
    if (levels.length === 0) return [];
    const locationIds = [...new Set(levels.map((l) => l.location.id))];
    const [usable, onOrder, lastReceipts] = await Promise.all([
      this.db
        .select({ locationId: inventoryBalance.locationId, itemId: inventoryBalance.itemId, quantity: sql<number>`sum(${inventoryBalance.quantity})::int` })
        .from(inventoryBalance)
        .innerJoin(inventoryLot, eq(inventoryLot.id, inventoryBalance.lotId))
        .where(and(inArray(inventoryBalance.locationId, locationIds), or(isNull(inventoryLot.expiryDate), gte(inventoryLot.expiryDate, today))))
        .groupBy(inventoryBalance.locationId, inventoryBalance.itemId),
      this.db
        .select({
          locationId: inventoryPurchaseOrder.locationId,
          itemId: inventoryPurchaseOrderLine.itemId,
          quantity: sql<number>`sum(${inventoryPurchaseOrderLine.quantityOrdered} - ${inventoryPurchaseOrderLine.quantityReceived})::int`,
        })
        .from(inventoryPurchaseOrderLine)
        .innerJoin(inventoryPurchaseOrder, eq(inventoryPurchaseOrder.id, inventoryPurchaseOrderLine.purchaseOrderId))
        .where(and(inArray(inventoryPurchaseOrder.locationId, locationIds), inArray(inventoryPurchaseOrder.status, [...OPEN_FOR_DELIVERY])))
        .groupBy(inventoryPurchaseOrder.locationId, inventoryPurchaseOrderLine.itemId),
      this.db
        .selectDistinctOn([inventoryMovement.locationId, inventoryMovement.itemId], {
          locationId: inventoryMovement.locationId,
          itemId: inventoryMovement.itemId,
          supplierId: inventoryMovement.supplierId,
          supplierName: inventorySupplier.name,
          unitCost: inventoryMovement.unitCost,
        })
        .from(inventoryMovement)
        .innerJoin(inventorySupplier, eq(inventorySupplier.id, inventoryMovement.supplierId))
        .where(and(inArray(inventoryMovement.locationId, locationIds), eq(inventoryMovement.kind, "receipt")))
        .orderBy(inventoryMovement.locationId, inventoryMovement.itemId, desc(inventoryMovement.recordedAt)),
    ]);
    const key = (locationId: string, itemId: string) => `${locationId}|${itemId}`;
    const usableBy = new Map(usable.map((u) => [key(u.locationId, u.itemId), u.quantity]));
    const onOrderBy = new Map(onOrder.map((o) => [key(o.locationId, o.itemId), o.quantity]));
    const lastBy = new Map(lastReceipts.map((r) => [key(r.locationId, r.itemId), r]));
    return levels
      .map(({ level, location, item }) => {
        const k = key(location.id, item.id);
        const usableQuantity = usableBy.get(k) ?? 0;
        const onOrderQuantity = onOrderBy.get(k) ?? 0;
        const suggestion = reorderSuggestion(usableQuantity, onOrderQuantity, level.reorderLevel, level.reorderQuantity);
        const last = lastBy.get(k);
        return {
          location: { id: location.id, name: location.name },
          item: { id: item.id, code: item.code, name: item.name, stockUnit: item.stockUnit, category: item.category },
          usable: usableQuantity,
          onOrder: onOrderQuantity,
          reorderLevel: level.reorderLevel,
          reorderQuantity: level.reorderQuantity,
          suggestedQuantity: suggestion.suggestedQuantity,
          needed: suggestion.needed,
          lastSupplier: last?.supplierId ? { id: last.supplierId, name: last.supplierName, unitCost: last.unitCost } : null,
        };
      })
      .filter((s) => s.needed)
      .sort((a, b) => a.location.name.localeCompare(b.location.name) || a.item.name.localeCompare(b.item.name));
  }

  // ---- internals -----------------------------------------------------------------------------

  private async end(actor: Actor, purchaseOrderId: string, input: z.infer<typeof endPurchaseOrderSchema>, action: "cancel" | "close") {
    await this.db.transaction(async (tx) => {
      const order = await this.lockFor(tx, actor, purchaseOrderId, action, input.version);
      if (action === "cancel") {
        const [received] = await tx
          .select({ total: sql<number>`coalesce(sum(${inventoryPurchaseOrderLine.quantityReceived}), 0)::int` })
          .from(inventoryPurchaseOrderLine)
          .where(eq(inventoryPurchaseOrderLine.purchaseOrderId, order.id));
        if ((received?.total ?? 0) > 0) throw new BusinessRuleError("Goods have arrived on this order; close it instead", "purchase_order_received");
      }
      const status = action === "cancel" ? "cancelled" : "closed";
      await this.save(tx, order, { status, endedBy: actor.userId, endedAt: new Date(), endReason: input.reason });
      await this.audit.record(tx, actor, {
        action: `inventory.purchase-order.${action}`,
        resourceType: "inventory_purchase_order",
        resourceId: order.id,
        reason: input.reason,
        metadata: { poNumber: order.poNumber, from: order.status },
      });
    });
    return this.get(actor, purchaseOrderId);
  }

  private async find(executor: DbExecutor, actor: Actor, purchaseOrderId: string, lock = false): Promise<PurchaseOrderRecord> {
    const query = executor
      .select()
      .from(inventoryPurchaseOrder)
      .where(
        and(
          eq(inventoryPurchaseOrder.organizationId, actor.organizationId),
          eq(inventoryPurchaseOrder.facilityId, requireFacilityId(actor)),
          eq(inventoryPurchaseOrder.id, purchaseOrderId),
        ),
      );
    const [row] = lock ? await query.for("update") : await query;
    return found(row, "Purchase order");
  }

  /** Locks the order and checks the action applies to its status (and the expected version, when given). */
  private async lockFor(tx: DbExecutor, actor: Actor, purchaseOrderId: string, action: PurchaseOrderAction, version?: number) {
    const order = await this.find(tx, actor, purchaseOrderId, true);
    if (version !== undefined) assertVersion(order.version, version, "Purchase order");
    if (!purchaseOrderAllows(order.status, action)) {
      throw new ConflictError(
        `Purchase order ${order.poNumber} is ${order.status.replace("_", " ")}; it cannot be ${verb(action)}`,
        undefined,
        "purchase_order_status",
      );
    }
    return order;
  }

  private async save(tx: DbExecutor, order: PurchaseOrderRecord, values: Partial<PurchaseOrderRecord>) {
    await tx
      .update(inventoryPurchaseOrder)
      .set({ ...values, updatedAt: new Date(), version: order.version + 1 })
      .where(eq(inventoryPurchaseOrder.id, order.id));
  }

  private async checkParties(tx: DbExecutor, actor: Actor, supplierId: string, locationId: string) {
    const [supplier] = await tx
      .select()
      .from(inventorySupplier)
      .where(and(eq(inventorySupplier.organizationId, actor.organizationId), eq(inventorySupplier.id, supplierId)));
    if (found(supplier, "Supplier").status !== "active") throw new BusinessRuleError("The supplier is inactive", "supplier_inactive");
    const [location] = await tx
      .select()
      .from(inventoryLocation)
      .where(and(eq(inventoryLocation.organizationId, actor.organizationId), eq(inventoryLocation.id, locationId)));
    const delivery = found(location, "Location");
    if (delivery.facilityId !== requireFacilityId(actor))
      throw new BusinessRuleError("Deliver to a location of the selected facility", "location_other_facility");
    if (delivery.status !== "active") throw new BusinessRuleError("The location is inactive", "location_inactive");
  }

  private async checkItems(tx: DbExecutor, actor: Actor, lines: Array<{ itemId: string }>) {
    const ids = lines.map((l) => l.itemId);
    const items = await tx
      .select()
      .from(inventoryItem)
      .where(and(eq(inventoryItem.organizationId, actor.organizationId), inArray(inventoryItem.id, ids)));
    if (items.length !== new Set(ids).size) throw new NotFoundError("Item");
    const inactive = items.find((i) => i.status !== "active");
    if (inactive) throw new BusinessRuleError(`${inactive.name} is inactive`, "item_inactive");
  }

  private async insertLines(
    tx: DbExecutor,
    actor: Actor,
    purchaseOrderId: string,
    lines: Array<{ itemId: string; quantity: number; unitCost: number | null }>,
  ) {
    await tx.insert(inventoryPurchaseOrderLine).values(
      lines.map((l, index) => ({
        organizationId: actor.organizationId,
        purchaseOrderId,
        lineNumber: index + 1,
        itemId: l.itemId,
        quantityOrdered: l.quantity,
        unitCost: l.unitCost,
      })),
    );
  }

  private event(type: string, order: PurchaseOrderRecord, extra: Record<string, unknown> = {}) {
    return {
      type,
      organizationId: order.organizationId,
      aggregateType: "inventory_purchase_order",
      aggregateId: order.id,
      facilityId: order.facilityId,
      payload: { poNumber: order.poNumber, supplierId: order.supplierId, locationId: order.locationId, ...extra },
    };
  }

  private async views(executor: DbExecutor, actor: Actor, orders: PurchaseOrderRecord[]) {
    if (orders.length === 0) return [];
    const ids = orders.map((o) => o.id);
    const [lines, suppliers, locations] = await Promise.all([
      executor
        .select({ line: inventoryPurchaseOrderLine, item: inventoryItem })
        .from(inventoryPurchaseOrderLine)
        .innerJoin(inventoryItem, eq(inventoryItem.id, inventoryPurchaseOrderLine.itemId))
        .where(inArray(inventoryPurchaseOrderLine.purchaseOrderId, ids))
        .orderBy(asc(inventoryPurchaseOrderLine.lineNumber)),
      executor
        .select({ id: inventorySupplier.id, code: inventorySupplier.code, name: inventorySupplier.name })
        .from(inventorySupplier)
        .where(and(eq(inventorySupplier.organizationId, actor.organizationId), inArray(inventorySupplier.id, [...new Set(orders.map((o) => o.supplierId))]))),
      executor
        .select({ id: inventoryLocation.id, name: inventoryLocation.name })
        .from(inventoryLocation)
        .where(and(eq(inventoryLocation.organizationId, actor.organizationId), inArray(inventoryLocation.id, [...new Set(orders.map((o) => o.locationId))]))),
    ]);
    return orders.map((order) => {
      const own = lines.filter((l) => l.line.purchaseOrderId === order.id).map((l) => lineView(l.line, l.item));
      const priced = own.filter((l) => l.unitCost !== null);
      const { organizationId: _o, ...rest } = order;
      return {
        ...rest,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        submittedAt: order.submittedAt?.toISOString() ?? null,
        approvedAt: order.approvedAt?.toISOString() ?? null,
        endedAt: order.endedAt?.toISOString() ?? null,
        supplier: suppliers.find((s) => s.id === order.supplierId) ?? null,
        location: locations.find((l) => l.id === order.locationId) ?? null,
        lines: own,
        /** Centavos, over the lines with a unit cost. */
        totalCost: priced.reduce((sum, l) => sum + l.quantityOrdered * l.unitCost!, 0),
        unpricedLines: own.length - priced.length,
        submittedByYou: order.submittedBy === actor.userId,
      };
    });
  }
}

function lineView(line: PurchaseOrderLineRecord, item: typeof inventoryItem.$inferSelect) {
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    item: { id: item.id, code: item.code, name: item.name, stockUnit: item.stockUnit, tracksLots: item.tracksLots, controlled: item.controlled },
    quantityOrdered: line.quantityOrdered,
    quantityReceived: line.quantityReceived,
    outstanding: line.quantityOrdered - line.quantityReceived,
    unitCost: line.unitCost,
  };
}

function verb(action: PurchaseOrderAction): string {
  return { edit: "edited", submit: "submitted", approve: "approved", receive: "received", cancel: "cancelled", close: "closed" }[action];
}
