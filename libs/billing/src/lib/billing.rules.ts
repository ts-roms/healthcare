import { percentOf } from "./money";

/**
 * Invoice arithmetic, in integer centavos. The database re-checks every total
 * (check constraints); these functions decide the amounts.
 *
 * Discounts: each applies to the items of its categories (none listed = all).
 * Several (stackable) discounts apply one after another to what remains, in
 * the order applied — never more than the item's amount. Whether a discount
 * may be combined is the rule's `stackable` flag (statutory discounts are
 * not combined unless configured so after verification).
 */
export interface LineInput {
  grossAmount: number;
  category: string;
}

export interface DiscountInput {
  rateBp: number;
  categories: readonly string[];
}

export interface LineResult extends LineInput {
  discountAmount: number;
  netAmount: number;
}

export interface InvoiceTotals {
  lines: LineResult[];
  /** Discount per applied rule, in the order given. */
  discountAmounts: number[];
  grossTotal: number;
  discountTotal: number;
  netTotal: number;
}

export function computeInvoice(lines: readonly LineInput[], discounts: readonly DiscountInput[]): InvoiceTotals {
  const remaining = lines.map((l) => l.grossAmount);
  const discountAmounts = discounts.map((d) => {
    let total = 0;
    lines.forEach((line, i) => {
      if (d.categories.length > 0 && !d.categories.includes(line.category)) return;
      const amount = Math.min(percentOf(remaining[i] ?? 0, d.rateBp), remaining[i] ?? 0);
      remaining[i] = (remaining[i] ?? 0) - amount;
      total += amount;
    });
    return total;
  });
  const result = lines.map((line, i) => {
    const net = remaining[i] ?? 0;
    return { ...line, discountAmount: line.grossAmount - net, netAmount: net };
  });
  const grossTotal = sum(lines.map((l) => l.grossAmount));
  const netTotal = sum(result.map((l) => l.netAmount));
  return { lines: result, discountAmounts, grossTotal, discountTotal: grossTotal - netTotal, netTotal };
}

/** Why a discount cannot be added to an invoice that already has `existing`, if it cannot. */
export function discountConflict(adding: { stackable: boolean; statutory: boolean }, existing: ReadonlyArray<{ stackable: boolean }>): string | null {
  if (existing.length === 0) return null;
  if (!adding.stackable || existing.some((e) => !e.stackable)) {
    return adding.statutory ? "statutory_discount_not_combinable" : "discount_not_combinable";
  }
  return null;
}

/** What the patient still owes on an issued invoice: their share, less payments, plus refunds. */
export function patientBalance(patientTotal: number, ledger: ReadonlyArray<{ kind: "payment" | "refund"; amount: number }>): number {
  return patientTotal - paidNet(ledger);
}

/** Payments less refunds. */
export function paidNet(ledger: ReadonlyArray<{ kind: "payment" | "refund"; amount: number }>): number {
  return sum(ledger.map((e) => (e.kind === "payment" ? e.amount : -e.amount)));
}

/** How much of one payment can still be refunded. */
export function refundable(payment: { amount: number }, refundsOfIt: ReadonlyArray<{ amount: number }>): number {
  return payment.amount - sum(refundsOfIt.map((r) => r.amount));
}

/** Invoice document number: "INV-2026-000123". Prefix and series are configuration (a BIR compliance dependency). */
export function documentNumber(prefix: string, year: number, value: number): string {
  return `${prefix}-${year}-${String(value).padStart(6, "0")}`;
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
