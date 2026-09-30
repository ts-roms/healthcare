import type { PlanItemStatus } from "../dental.schema";

/**
 * Fee estimate rules (docs/domains/dental.md, "Fee estimates"). An estimate covers the work still ahead on a plan:
 * items awaiting the patient's decision and accepted items not yet done, each at billing's listed price for its
 * procedure code on the date priced. Done items are charged by billing when performed; declined and withdrawn items
 * are not part of it. Amounts are integer centavos.
 */

/**
 * A fee range: the lowest and highest listed price among the planned procedure and the procedures it may turn out to be
 * (docs/domains/dental.md, "Fee ranges"). Equal ends: a single price.
 */
export interface FeeRange {
  low: number;
  high: number;
}

/**
 * The fee of a plan item: null when the planned procedure has no listed price (the item is "not priced", whatever its
 * alternatives cost); else the range over the planned price and the alternatives' listed prices. Alternatives without
 * a listed price are left out of the range and counted.
 */
export function feeRange(planned: number | null, alternatives: ReadonlyArray<number | null>): (FeeRange & { unpricedAlternatives: number }) | null {
  if (planned === null) return null;
  const priced = alternatives.filter((a): a is number => a !== null);
  const all = [planned, ...priced];
  return { low: Math.min(...all), high: Math.max(...all), unpricedAlternatives: alternatives.length - priced.length };
}

/**
 * The quantity billing charges for a procedure: one, or — when its service is priced per surface — the surfaces treated,
 * at least one. Mirrors billing's charge capture (`chargeQuantity` in libs/billing), so estimates match the charge.
 */
export function surfaceQuantity(perSurface: boolean, surfaceCount: number): number {
  return perSurface ? Math.max(surfaceCount, 1) : 1;
}

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
  /** Listed prices of the items awaiting the patient's decision (the low end of their ranges). */
  awaitingDecision: number;
  /** Listed prices of accepted items not yet done (low end). */
  accepted: number;
  /** Both: the work still ahead (low end). */
  remaining: number;
  /** The high ends (equal to the above when no item has a range). */
  awaitingDecisionHigh: number;
  acceptedHigh: number;
  remainingHigh: number;
  /** Items in the estimate without a listed price (the totals leave them out). */
  unpricedItems: number;
}

/** Totals of the work still ahead; `highPrice` is the high end of an item's range (left out: a single price). */
export function estimateTotals(items: ReadonlyArray<{ status: PlanItemStatus; listedPrice: number | null; highPrice?: number | null }>): EstimateTotals {
  const totals: EstimateTotals = {
    awaitingDecision: 0,
    accepted: 0,
    remaining: 0,
    awaitingDecisionHigh: 0,
    acceptedHigh: 0,
    remainingHigh: 0,
    unpricedItems: 0,
  };
  for (const item of items) {
    const part = estimatePart(item.status);
    if (!part) continue;
    if (item.listedPrice === null) {
      totals.unpricedItems += 1;
      continue;
    }
    const high = item.highPrice ?? item.listedPrice;
    for (const amount of [item.listedPrice, high]) {
      if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("a listed price is a non-negative integer of centavos");
    }
    if (high < item.listedPrice) throw new RangeError("a range's high end is not below its low end");
    if (part === "awaiting") {
      totals.awaitingDecision += item.listedPrice;
      totals.awaitingDecisionHigh += high;
    } else {
      totals.accepted += item.listedPrice;
      totals.acceptedHigh += high;
    }
  }
  totals.remaining = totals.awaitingDecision + totals.accepted;
  totals.remainingHigh = totals.awaitingDecisionHigh + totals.acceptedHigh;
  return totals;
}

/** Sites a procedure may turn out to be done on: whole-mouth procedures only become whole-mouth ones, tooth ones tooth ones. */
export function alternativeSiteAllowed(planned: "mouth" | "tooth" | "surface", alternative: "mouth" | "tooth" | "surface"): boolean {
  return (planned === "mouth") === (alternative === "mouth");
}

/** Until when a printed estimate holds: the pricing date plus the organization's own validity days (none: null). */
export function estimateValidUntil(pricedOn: string, validityDays: number | null): string | null {
  if (!validityDays) return null;
  const d = new Date(`${pricedOn}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + validityDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Whether a signed written estimate covers a decision on these items today: one that listed every item awaiting the
 * decision and still holds (no validity date, or not past it). The requirement itself is the organization's setting.
 */
export function writtenEstimateCovers(written: Array<{ itemIds: string[]; validUntil: string | null }>, awaitingItemIds: string[], today: string): boolean {
  return written.some((w) => (w.validUntil === null || today <= w.validUntil) && awaitingItemIds.every((id) => w.itemIds.includes(id)));
}
