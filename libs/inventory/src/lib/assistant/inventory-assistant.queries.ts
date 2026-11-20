import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, eq, gt, gte, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { inventoryItem, inventoryLocation, inventoryLot, inventoryMovement, inventoryPurchaseOrder, inventoryPurchaseOrderLine } from "../inventory.schema";
import type { DaysOfCoverInput } from "./days-of-cover.rules";
import type { ExpiryExposureInput } from "./expiry-exposure.rules";
import type { UsageSpikeInput } from "./usage-spike.rules";

/** The moment the figures are read at: now for a live request, a past instant when a rule is replayed. */
export interface AssistantMoment {
  asOf: Date;
  /** The facility's local date at `asOf` (YYYY-MM-DD), for expiry. */
  today: string;
  /** A live request: also counts what is on open purchase orders (their past states are not kept, so a replay cannot). */
  live: boolean;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The figures the inventory assistant rules read, per active item at one facility. Stock is the ledger summed up to the
 * moment (the ledger is append-only and every balance is its sum), so a past moment reads what was there then.
 * Quantities only — no patient, no cost — so reading is not audited here (the API audits the assistant request).
 */
@Injectable()
export class InventoryAssistantQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `inventory.days-of-cover`: usable stock, open orders and the issues of the window ending at the moment. */
  async coverInputs(organizationId: string, facilityId: string, since: Date, moment: AssistantMoment): Promise<DaysOfCoverInput[]> {
    const items = await this.activeItems(organizationId);
    if (items.length === 0) return [];
    const issued = await this.issuedIn(organizationId, facilityId, since, moment.asOf);
    if (issued.size === 0) return [];
    const usable = await this.usableByItem(organizationId, facilityId, moment);
    const onOrder = moment.live ? await this.onOrder(organizationId, facilityId) : new Map<string, number>();
    return items
      .filter((item) => issued.has(item.id))
      .map((item) => ({
        itemId: item.id,
        code: item.code,
        name: item.name,
        stockUnit: item.stockUnit,
        usable: usable.get(item.id) ?? 0,
        onOrder: onOrder.get(item.id) ?? 0,
        issued: issued.get(item.id)!.quantity,
        issues: issued.get(item.id)!.issues,
      }));
  }

  /** `inventory.usage-spike`: net issues per 7 days for `weeks` + 1 periods ending at the moment (oldest first). */
  async weeklyIssues(organizationId: string, facilityId: string, weeks: number, moment: AssistantMoment): Promise<UsageSpikeInput[]> {
    const periods = weeks + 1;
    const since = new Date(moment.asOf.getTime() - periods * WEEK_MS);
    const asOf = moment.asOf.toISOString();
    // Period 0 is the most recent 7 days.
    const period = sql<number>`floor(extract(epoch from (${asOf}::timestamptz - ${inventoryMovement.recordedAt})) / 604800)::int`;
    const rows = await this.db
      .select({ itemId: inventoryMovement.itemId, period, quantity: sql<number>`coalesce(-sum(${inventoryMovement.quantity}), 0)::int` })
      .from(inventoryMovement)
      .innerJoin(inventoryLocation, eq(inventoryLocation.id, inventoryMovement.locationId))
      .where(
        and(
          this.atFacility(organizationId, facilityId),
          inArray(inventoryMovement.kind, ["issue", "return"]),
          gt(inventoryMovement.recordedAt, since),
          lte(inventoryMovement.recordedAt, moment.asOf),
        ),
      )
      .groupBy(inventoryMovement.itemId, sql`2`);
    const byItem = new Map<string, number[]>();
    for (const row of rows) {
      if (row.period < 0 || row.period >= periods) continue;
      const weekly = byItem.get(row.itemId) ?? new Array<number>(periods).fill(0);
      weekly[periods - 1 - row.period] = row.quantity;
      byItem.set(row.itemId, weekly);
    }
    const items = await this.activeItems(organizationId);
    return items
      .filter((item) => (byItem.get(item.id)?.[periods - 1] ?? 0) > 0)
      .map((item) => ({ itemId: item.id, name: item.name, stockUnit: item.stockUnit, weekly: byItem.get(item.id)! }));
  }

  /** `inventory.expiry-exposure`: usable lots with an expiry at the moment, and the pace of the window ending then. */
  async expiryInputs(organizationId: string, facilityId: string, since: Date, moment: AssistantMoment): Promise<ExpiryExposureInput[]> {
    const lots = await this.db
      .select({
        itemId: inventoryMovement.itemId,
        lotId: inventoryLot.id,
        lotNumber: inventoryLot.lotNumber,
        expiryDate: inventoryLot.expiryDate,
        quantity: sql<number>`sum(${inventoryMovement.quantity})::int`,
      })
      .from(inventoryMovement)
      .innerJoin(inventoryLocation, eq(inventoryLocation.id, inventoryMovement.locationId))
      .innerJoin(inventoryLot, eq(inventoryLot.id, inventoryMovement.lotId))
      .where(
        and(
          this.atFacility(organizationId, facilityId),
          lte(inventoryMovement.recordedAt, moment.asOf),
          isNotNull(inventoryLot.expiryDate),
          gte(inventoryLot.expiryDate, moment.today),
        ),
      )
      .groupBy(inventoryMovement.itemId, inventoryLot.id)
      .having(sql`sum(${inventoryMovement.quantity}) > 0`);
    if (lots.length === 0) return [];
    const issued = await this.issuedIn(organizationId, facilityId, since, moment.asOf);
    const items = await this.activeItems(organizationId);
    return items
      .map((item) => ({
        itemId: item.id,
        name: item.name,
        stockUnit: item.stockUnit,
        issued: issued.get(item.id)?.quantity ?? 0,
        issues: issued.get(item.id)?.issues ?? 0,
        lots: lots
          .filter((l) => l.itemId === item.id)
          .map((l) => ({ lotId: l.lotId, lotNumber: l.lotNumber, expiryDate: l.expiryDate!, quantity: l.quantity })),
      }))
      .filter((item) => item.lots.length > 0);
  }

  // ---- internals ---------------------------------------------------------------------------------------------------

  private atFacility(organizationId: string, facilityId: string): SQL {
    return and(eq(inventoryLocation.organizationId, organizationId), eq(inventoryLocation.facilityId, facilityId), eq(inventoryLocation.status, "active"))!;
  }

  private activeItems(organizationId: string) {
    return this.db
      .select({ id: inventoryItem.id, code: inventoryItem.code, name: inventoryItem.name, stockUnit: inventoryItem.stockUnit })
      .from(inventoryItem)
      .where(and(eq(inventoryItem.organizationId, organizationId), eq(inventoryItem.status, "active")));
  }

  /** Net issued (issues less returns) and the number of issues per item in (`since`, `asOf`]. */
  private async issuedIn(organizationId: string, facilityId: string, since: Date, asOf: Date): Promise<Map<string, { quantity: number; issues: number }>> {
    const rows = await this.db
      .select({
        itemId: inventoryMovement.itemId,
        quantity: sql<number>`coalesce(-sum(${inventoryMovement.quantity}), 0)::int`,
        issues: sql<number>`count(*) filter (where ${inventoryMovement.kind} = 'issue')::int`,
      })
      .from(inventoryMovement)
      .innerJoin(inventoryLocation, eq(inventoryLocation.id, inventoryMovement.locationId))
      .where(
        and(
          this.atFacility(organizationId, facilityId),
          inArray(inventoryMovement.kind, ["issue", "return"]),
          gt(inventoryMovement.recordedAt, since),
          lte(inventoryMovement.recordedAt, asOf),
        ),
      )
      .groupBy(inventoryMovement.itemId);
    return new Map(rows.map((r) => [r.itemId, { quantity: r.quantity, issues: r.issues }]));
  }

  /** Unexpired stock per item at the moment: the ledger's sum per lot, lots without expiry included. */
  private async usableByItem(organizationId: string, facilityId: string, moment: AssistantMoment): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ itemId: inventoryMovement.itemId, quantity: sql<number>`coalesce(sum(${inventoryMovement.quantity}), 0)::int` })
      .from(inventoryMovement)
      .innerJoin(inventoryLocation, eq(inventoryLocation.id, inventoryMovement.locationId))
      .innerJoin(inventoryLot, eq(inventoryLot.id, inventoryMovement.lotId))
      .where(
        and(
          this.atFacility(organizationId, facilityId),
          lte(inventoryMovement.recordedAt, moment.asOf),
          or(isNull(inventoryLot.expiryDate), gte(inventoryLot.expiryDate, moment.today)),
        ),
      )
      .groupBy(inventoryMovement.itemId);
    return new Map(rows.map((r) => [r.itemId, r.quantity]));
  }

  /** Ordered and not yet received on the facility's orders open for delivery (now). */
  private async onOrder(organizationId: string, facilityId: string): Promise<Map<string, number>> {
    const rows = await this.db
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
    return new Map(rows.map((r) => [r.itemId, r.quantity]));
  }
}
