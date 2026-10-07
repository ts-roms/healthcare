import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database, reportingFacility, reportingRange, type ReportingWindow } from "@healthcare/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { inventoryItem, inventoryLocation, inventoryMovement, type MovementKind, type MovementSource } from "../inventory.schema";

/** Movement kinds that take stock out for good (transfers move value between locations and are left out). */
const USE_KINDS: readonly MovementKind[] = ["issue", "write_off", "return", "adjustment"];

export interface InventoryUseFigure {
  /** Positive: stock that left (returns and positive adjustments net against it). */
  quantity: number;
  /** Centavos at the cost each movement recorded. */
  value: number;
  /** Quantity moved before costs were recorded (not in `value`). */
  unvaluedQuantity: number;
}

export interface InventoryFigures {
  /** Receipts in the window (purchases and manual receipts), at their recorded cost. */
  received: { quantity: number; value: number; unvaluedQuantity: number; movements: number };
  /** Everything that left for good in the window, net of returns and count adjustments. */
  used: InventoryUseFigure;
  /** What left per workflow (the movement's source; `null`: a plain issue, write-off or count adjustment). */
  usedBySource: Array<{ sourceType: MovementSource | null; kind: MovementKind } & InventoryUseFigure & { movements: number }>;
  /** Written off in the window (expired, damaged, lost), by value. */
  writtenOff: InventoryUseFigure;
  /** The ten items that consumed the most value (issues, write-offs and negative adjustments, net of returns). */
  topItems: Array<{ itemId: string; code: string; name: string; category: string; stockUnit: string; quantity: number; value: number }>;
}

const EMPTY_USE: InventoryUseFigure = { quantity: 0, value: 0, unvaluedQuantity: 0 };

/**
 * Inventory figures for management reporting over a window, at the stock locations of the facilities in scope: the
 * value received, the value used per workflow (dispensing, laboratory reagents, dental and clinic procedures,
 * immunizations, plain issues), written off, and the items that consumed the most value — each movement valued at
 * the cost it recorded when posted (`docs/domains/inventory.md`, valuation), so figures never shift. Transfers between
 * locations are not use. Quantities and centavos only: no patient, no lot. Operational figures, not accounting.
 */
@Injectable()
export class InventoryReportingQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async figures(organizationId: string, window: ReportingWindow): Promise<InventoryFigures> {
    const where = and(
      eq(inventoryMovement.organizationId, organizationId),
      reportingRange(inventoryMovement.recordedAt, window),
      reportingFacility(inventoryLocation.facilityId, window),
    );
    // Uses are negative quantities in the ledger: shown positive here. Returns and positive count adjustments net off.
    const outQuantity = sql<number>`coalesce(-sum(${inventoryMovement.quantity}), 0)::int`;
    const outValue = sql<number>`coalesce(-sum(${inventoryMovement.quantity}::numeric * ${inventoryMovement.unitCost}), 0)::float8`;
    const inQuantity = sql<number>`coalesce(sum(${inventoryMovement.quantity}), 0)::int`;
    const inValue = sql<number>`coalesce(sum(${inventoryMovement.quantity}::numeric * ${inventoryMovement.unitCost}), 0)::float8`;
    const unvalued = sql<number>`coalesce(sum(abs(${inventoryMovement.quantity})) filter (where ${inventoryMovement.unitCost} is null), 0)::int`;
    const movements = sql<number>`count(*)::int`;
    const [[received], bySource, [writtenOff], top] = await Promise.all([
      this.db
        .select({ quantity: inQuantity, value: inValue, unvaluedQuantity: unvalued, movements })
        .from(inventoryMovement)
        .innerJoin(inventoryLocation, eq(inventoryLocation.id, inventoryMovement.locationId))
        .where(and(where, eq(inventoryMovement.kind, "receipt"))),
      this.db
        .select({
          sourceType: inventoryMovement.sourceType,
          kind: inventoryMovement.kind,
          quantity: outQuantity,
          value: outValue,
          unvaluedQuantity: unvalued,
          movements,
        })
        .from(inventoryMovement)
        .innerJoin(inventoryLocation, eq(inventoryLocation.id, inventoryMovement.locationId))
        .where(and(where, inArray(inventoryMovement.kind, [...USE_KINDS])))
        .groupBy(inventoryMovement.sourceType, inventoryMovement.kind),
      this.db
        .select({ quantity: outQuantity, value: outValue, unvaluedQuantity: unvalued })
        .from(inventoryMovement)
        .innerJoin(inventoryLocation, eq(inventoryLocation.id, inventoryMovement.locationId))
        .where(and(where, eq(inventoryMovement.kind, "write_off"))),
      this.db
        .select({
          itemId: inventoryMovement.itemId,
          code: sql<string>`max(${inventoryItem.code})`,
          name: sql<string>`max(${inventoryItem.name})`,
          category: sql<string>`max(${inventoryItem.category})`,
          stockUnit: sql<string>`max(${inventoryItem.stockUnit})`,
          quantity: outQuantity,
          value: outValue,
        })
        .from(inventoryMovement)
        .innerJoin(inventoryLocation, eq(inventoryLocation.id, inventoryMovement.locationId))
        .innerJoin(inventoryItem, eq(inventoryItem.id, inventoryMovement.itemId))
        .where(and(where, inArray(inventoryMovement.kind, [...USE_KINDS])))
        .groupBy(inventoryMovement.itemId)
        .having(sql`-sum(${inventoryMovement.quantity}) > 0`)
        .orderBy(sql`-sum(${inventoryMovement.quantity}::numeric * ${inventoryMovement.unitCost}) desc nulls last, max(${inventoryItem.name})`)
        .limit(10),
    ]);
    const rows = bySource.map((r) => ({ ...r, kind: r.kind as MovementKind, sourceType: (r.sourceType ?? null) as MovementSource | null }));
    const used = rows.reduce(
      (acc, r) => ({ quantity: acc.quantity + r.quantity, value: acc.value + r.value, unvaluedQuantity: acc.unvaluedQuantity + r.unvaluedQuantity }),
      { ...EMPTY_USE },
    );
    return {
      received: received ?? { quantity: 0, value: 0, unvaluedQuantity: 0, movements: 0 },
      used,
      usedBySource: rows.sort((a, b) => b.value - a.value || (a.sourceType ?? "~").localeCompare(b.sourceType ?? "~") || a.kind.localeCompare(b.kind)),
      writtenOff: writtenOff ?? { ...EMPTY_USE },
      topItems: top,
    };
  }
}
