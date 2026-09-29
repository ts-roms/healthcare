import { Inject, Injectable } from "@nestjs/common";
import { type Actor, BadRequestError, DATABASE, type Database, localDayBounds, NotFoundError, requireFacilityId } from "@healthcare/core";
import { OrganizationService } from "@healthcare/organization";
import { and, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import { inventoryBalance, inventoryItem, inventoryLocation, inventoryMovement, type ItemCategory, type MovementKind } from "../inventory.schema";

/** Longest period the usage report reads at once, in days. */
export const MAX_USAGE_DAYS = 366;

/**
 * Inventory valuation (docs/domains/inventory.md, "Valuation"): what the stock at the selected facility is worth at
 * cost, and what was received, used and written off in a period. A lot's cost is the weighted average of its priced
 * receipts (the same rule the ledger uses when it stamps a cost on every other movement); lots with no priced receipt
 * are reported as unvalued, never guessed. Operational figures for stock control — not an accounting or BIR valuation.
 */
@Injectable()
export class InventoryValuationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly organizations: OrganizationService,
  ) {}

  /** Stock on hand at cost, per item and location, with totals by category and location. Amounts in centavos. */
  async valuation(actor: Actor, query: { locationId?: string }) {
    const locations = await this.locations(actor, query.locationId);
    if (locations.length === 0) return emptyValuation();
    const lotCost = this.db
      .select({
        lotId: inventoryMovement.lotId,
        unitCost:
          sql<number>`round(sum(${inventoryMovement.quantity}::numeric * ${inventoryMovement.unitCost}) / nullif(sum(${inventoryMovement.quantity}), 0))`.as(
            "unit_cost",
          ),
      })
      .from(inventoryMovement)
      .where(
        and(eq(inventoryMovement.organizationId, actor.organizationId), eq(inventoryMovement.kind, "receipt"), sql`${inventoryMovement.unitCost} is not null`),
      )
      .groupBy(inventoryMovement.lotId)
      .as("lot_cost");
    const rows = await this.db
      .select({
        locationId: inventoryBalance.locationId,
        itemId: inventoryBalance.itemId,
        quantity: sql<number>`sum(${inventoryBalance.quantity})::int`,
        value: sql<number>`coalesce(sum(${inventoryBalance.quantity}::numeric * ${lotCost.unitCost}), 0)::float8`,
        unvaluedQuantity: sql<number>`coalesce(sum(${inventoryBalance.quantity}) filter (where ${lotCost.unitCost} is null), 0)::int`,
      })
      .from(inventoryBalance)
      .leftJoin(lotCost, eq(lotCost.lotId, inventoryBalance.lotId))
      .where(
        and(
          eq(inventoryBalance.organizationId, actor.organizationId),
          inArray(
            inventoryBalance.locationId,
            locations.map((l) => l.id),
          ),
          gt(inventoryBalance.quantity, 0),
        ),
      )
      .groupBy(inventoryBalance.locationId, inventoryBalance.itemId);
    const items = await this.items(actor.organizationId, [...new Set(rows.map((r) => r.itemId))]);
    const lines = rows
      .map((r) => {
        const item = items.get(r.itemId);
        const location = locations.find((l) => l.id === r.locationId);
        const valued = r.quantity - r.unvaluedQuantity;
        return {
          itemId: r.itemId,
          code: item?.code ?? "",
          name: item?.name ?? "Item",
          category: (item?.category ?? "other") as ItemCategory,
          stockUnit: item?.stockUnit ?? "",
          locationId: r.locationId,
          locationName: location?.name ?? "Location",
          quantity: r.quantity,
          value: r.value,
          unvaluedQuantity: r.unvaluedQuantity,
          /** Average cost per stock unit of the valued quantity (centavos). */
          averageUnitCost: valued > 0 ? Math.round(r.value / valued) : null,
        };
      })
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    return {
      totalValue: lines.reduce((n, l) => n + l.value, 0),
      /** Item–location lines holding stock whose lot has no priced receipt. */
      unvaluedLines: lines.filter((l) => l.unvaluedQuantity > 0).length,
      byCategory: sumBy(lines, (l) => l.category).map(([category, g]) => ({ category, value: g.value, lines: g.lines })),
      byLocation: sumBy(lines, (l) => l.locationId).map(([locationId, g]) => ({
        locationId,
        name: locations.find((l) => l.id === locationId)?.name ?? "Location",
        value: g.value,
        lines: g.lines,
      })),
      lines,
    };
  }

  /**
   * What moved in a period of local days at the facility's locations, valued at the cost each movement recorded:
   * received (purchases), and used per kind and workflow (issued, dispensed, laboratory, dental, written off, count
   * adjustments, transfers, returns). Movements from before costs were recorded count as unvalued.
   */
  async usage(actor: Actor, query: { from: string; to: string; locationId?: string }) {
    if (query.from > query.to) throw new BadRequestError("The period starts after it ends");
    const days = (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > MAX_USAGE_DAYS) throw new BadRequestError(`Choose at most ${MAX_USAGE_DAYS} days`);
    const facility = await this.organizations.getFacility(actor.organizationId, requireFacilityId(actor));
    const locations = await this.locations(actor, query.locationId);
    const base = { from: query.from, to: query.to, timeZone: facility.timezone };
    if (locations.length === 0) return { ...base, rows: [], topItems: [] };
    const where = and(
      eq(inventoryMovement.organizationId, actor.organizationId),
      inArray(
        inventoryMovement.locationId,
        locations.map((l) => l.id),
      ),
      gte(inventoryMovement.recordedAt, localDayBounds(query.from, facility.timezone).start),
      lt(inventoryMovement.recordedAt, localDayBounds(query.to, facility.timezone).end),
    );
    const value = sql<number>`coalesce(sum(${inventoryMovement.quantity}::numeric * ${inventoryMovement.unitCost}), 0)::float8`;
    const unvalued = sql<number>`coalesce(sum(abs(${inventoryMovement.quantity})) filter (where ${inventoryMovement.unitCost} is null), 0)::int`;
    const [rows, top] = await Promise.all([
      this.db
        .select({
          kind: inventoryMovement.kind,
          sourceType: inventoryMovement.sourceType,
          quantity: sql<number>`sum(${inventoryMovement.quantity})::int`,
          value,
          unvaluedQuantity: unvalued,
          movements: sql<number>`count(*)::int`,
        })
        .from(inventoryMovement)
        .where(where)
        .groupBy(inventoryMovement.kind, inventoryMovement.sourceType),
      // Items consumed (issues, write-offs and negative adjustments net of returns), by value.
      this.db
        .select({ itemId: inventoryMovement.itemId, quantity: sql<number>`-sum(${inventoryMovement.quantity})::int`, value: sql<number>`-${value}` })
        .from(inventoryMovement)
        .where(and(where, inArray(inventoryMovement.kind, ["issue", "write_off", "return", "adjustment"])))
        .groupBy(inventoryMovement.itemId)
        .orderBy(sql`sum(${inventoryMovement.quantity}::numeric * ${inventoryMovement.unitCost}) asc nulls last`)
        .limit(10),
    ]);
    const items = await this.items(
      actor.organizationId,
      top.map((t) => t.itemId),
    );
    return {
      ...base,
      /** Signed quantities and values per kind and workflow (receipts positive, uses negative). */
      rows: rows.map((r) => ({ ...r, kind: r.kind as MovementKind })).sort((a, b) => a.value - b.value),
      topItems: top
        .filter((t) => t.quantity > 0)
        .map((t) => ({
          itemId: t.itemId,
          name: items.get(t.itemId)?.name ?? "Item",
          stockUnit: items.get(t.itemId)?.stockUnit ?? "",
          quantity: t.quantity,
          value: t.value,
        })),
    };
  }

  private async locations(actor: Actor, locationId?: string) {
    const facilityId = requireFacilityId(actor);
    const rows = await this.db
      .select({ id: inventoryLocation.id, name: inventoryLocation.name })
      .from(inventoryLocation)
      .where(
        and(
          eq(inventoryLocation.organizationId, actor.organizationId),
          eq(inventoryLocation.facilityId, facilityId),
          locationId ? eq(inventoryLocation.id, locationId) : undefined,
        ),
      );
    if (locationId && rows.length === 0) throw new NotFoundError("Location");
    return rows;
  }

  private async items(organizationId: string, ids: string[]) {
    if (ids.length === 0) return new Map<string, typeof inventoryItem.$inferSelect>();
    const rows = await this.db
      .select()
      .from(inventoryItem)
      .where(and(eq(inventoryItem.organizationId, organizationId), inArray(inventoryItem.id, ids)));
    return new Map(rows.map((r) => [r.id, r]));
  }
}

function emptyValuation() {
  return { totalValue: 0, unvaluedLines: 0, byCategory: [], byLocation: [], lines: [] };
}

function sumBy<T extends { value: number }>(lines: T[], key: (line: T) => string): Array<[string, { value: number; lines: number }]> {
  const groups = new Map<string, { value: number; lines: number }>();
  for (const line of lines) {
    const g = groups.get(key(line)) ?? { value: 0, lines: 0 };
    groups.set(key(line), { value: g.value + line.value, lines: g.lines + 1 });
  }
  return [...groups.entries()].sort((a, b) => b[1].value - a[1].value);
}
