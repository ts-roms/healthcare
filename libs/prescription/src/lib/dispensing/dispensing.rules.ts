/**
 * Dispensing rules: pure, no I/O.
 *
 * A prescription item states a quantity in its own unit (e.g. "30 tablets"); stock is counted in the inventory item's
 * stock unit (a tablet, a bottle, a box of 100). Only when both units are the same can the platform check that no more
 * is dispensed than prescribed (the quantity times one plus the refills). Otherwise the pharmacist's judgement applies
 * and the screen shows both.
 */

/** Inventory item categories that are dispensed on a prescription (never reagents, dental or laboratory supplies). */
export const DISPENSABLE_CATEGORIES = ["medicine", "medical_supply"] as const;

/** Lower case, trimmed, simple English plural removed ("tablets" → "tablet", "boxes" → "box"). */
export function normalizeUnit(unit: string): string {
  const u = unit.trim().toLowerCase().replace(/\s+/g, " ");
  if (/(x|s|ch|sh)es$/.test(u)) return u.slice(0, -2);
  if (u.endsWith("s") && !u.endsWith("ss")) return u.slice(0, -1);
  return u;
}

export function sameUnit(a: string, b: string): boolean {
  return normalizeUnit(a) === normalizeUnit(b);
}

/**
 * How much of a prescription item may still be dispensed in the stock unit, or null when the units differ (no check).
 * `dispensed` counts earlier dispenses (not reversed) in the same unit.
 */
export function remainingToDispense(
  item: { quantity: number; quantityUnit: string; refills: number },
  stockUnit: string,
  dispensed: Array<{ quantity: number; stockUnit: string }>,
): number | null {
  if (!sameUnit(item.quantityUnit, stockUnit)) return null;
  const allowed = item.quantity * (1 + item.refills);
  const used = dispensed.filter((d) => sameUnit(d.stockUnit, item.quantityUnit)).reduce((sum, d) => sum + d.quantity, 0);
  return Math.max(0, allowed - used);
}
