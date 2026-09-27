/**
 * Inventory rules: pure, no I/O. Quantities are whole stock units.
 */

export interface LotStock {
  lotId: string;
  lotNumber: string | null;
  expiryDate: string | null;
  quantity: number;
}

export interface Allocation {
  lotId: string;
  quantity: number;
}

/** Whether a lot has expired on a given local date (the expiry date itself is the last usable day). */
export function isExpired(expiryDate: string | null, today: string): boolean {
  return expiryDate !== null && expiryDate < today;
}

/**
 * First-expiry-first-out: take the requested quantity from the usable lots with the earliest expiry first (lots
 * without an expiry last). Expired lots are never picked. Returns the allocation, or the shortfall when the usable
 * stock is not enough.
 */
export function allocateFefo(lots: LotStock[], quantity: number, today: string): { ok: true; allocations: Allocation[] } | { ok: false; available: number } {
  const usable = lots
    .filter((l) => l.quantity > 0 && !isExpired(l.expiryDate, today))
    .sort((a, b) => (a.expiryDate ?? "9999-12-31").localeCompare(b.expiryDate ?? "9999-12-31") || (a.lotNumber ?? "").localeCompare(b.lotNumber ?? ""));
  const available = usable.reduce((sum, l) => sum + l.quantity, 0);
  if (available < quantity) return { ok: false, available };
  const allocations: Allocation[] = [];
  let remaining = quantity;
  for (const lot of usable) {
    if (remaining === 0) break;
    const take = Math.min(lot.quantity, remaining);
    allocations.push({ lotId: lot.lotId, quantity: take });
    remaining -= take;
  }
  return { ok: true, allocations };
}

export type ExpiryStatus = "expired" | "expiring" | "ok" | "no_expiry";

/** Expired, expiring within `warnDays`, or fine. */
export function expiryStatus(expiryDate: string | null, today: string, warnDays: number): ExpiryStatus {
  if (!expiryDate) return "no_expiry";
  if (expiryDate < today) return "expired";
  const limit = addDays(today, warnDays);
  return expiryDate <= limit ? "expiring" : "ok";
}

export type StockStatus = "out" | "low" | "ok";

/** Out of stock, at or below the reorder level, or fine (no level set: only "out" is flagged). */
export function stockStatus(onHand: number, reorderLevel: number | null): StockStatus {
  if (onHand === 0) return "out";
  if (reorderLevel !== null && onHand <= reorderLevel) return "low";
  return "ok";
}

/** True when a movement takes the location's stock from above the reorder level to at or below it. */
export function crossedReorderLevel(before: number, after: number, reorderLevel: number | null): boolean {
  return reorderLevel !== null && before > reorderLevel && after <= reorderLevel;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
