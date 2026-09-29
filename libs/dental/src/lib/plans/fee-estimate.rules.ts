import type { PlanItemStatus } from "../dental.schema";

/**
 * Fee estimate rules (docs/domains/dental.md, "Fee estimates"). An estimate covers the work still ahead on a plan:
 * items awaiting the patient's decision and accepted items not yet done, each at billing's listed price for its
 * procedure code on the date priced. Done items are charged by billing when performed; declined and withdrawn items
 * are not part of it. Amounts are integer centavos.
 */

/** What an estimate is not; printed and shown with every estimate (the organization may add its own note). */
export const ESTIMATE_DISCLAIMER =
  "An estimate from the clinic's listed prices, not an invoice or official receipt. Discounts, packages and HMO or PhilHealth coverage are not applied; each procedure is charged at the listed price on the day it is done.";

/** Where an item stands in the estimate: awaiting a decision, accepted and not yet done, or not part of it (null). */
export type EstimatePart = "awaiting" | "accepted";

export function estimatePart(status: PlanItemStatus): EstimatePart | null {
  if (status === "proposed") return "awaiting";
  if (status === "accepted") return "accepted";
  return null;
}

export interface EstimateTotals {
  /** Listed prices of the items awaiting the patient's decision. */
  awaitingDecision: number;
  /** Listed prices of accepted items not yet done. */
  accepted: number;
  /** Both: the work still ahead. */
  remaining: number;
  /** Items in the estimate without a listed price (the totals leave them out). */
  unpricedItems: number;
}

export function estimateTotals(items: ReadonlyArray<{ status: PlanItemStatus; listedPrice: number | null }>): EstimateTotals {
  const totals: EstimateTotals = { awaitingDecision: 0, accepted: 0, remaining: 0, unpricedItems: 0 };
  for (const item of items) {
    const part = estimatePart(item.status);
    if (!part) continue;
    if (item.listedPrice === null) {
      totals.unpricedItems += 1;
      continue;
    }
    if (!Number.isSafeInteger(item.listedPrice) || item.listedPrice < 0) throw new RangeError("a listed price is a non-negative integer of centavos");
    if (part === "awaiting") totals.awaitingDecision += item.listedPrice;
    else totals.accepted += item.listedPrice;
  }
  totals.remaining = totals.awaitingDecision + totals.accepted;
  return totals;
}
