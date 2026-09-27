import type { AccountEntryKind } from "./billing.schema";
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

/**
 * What settles an issued invoice besides its payers: patient payments (less
 * refunds), deposit or account credit applied (less what a void released),
 * and credit notes (the part that reduced the balance).
 */
export interface Settlement {
  paid: number;
  depositApplied: number;
  credited: number;
}

/** What the patient still owes on an issued invoice. Never negative when the rules below are followed. */
export function invoiceBalance(patientTotal: number, settlement: Settlement): number {
  return patientTotal - settlement.paid - settlement.depositApplied - settlement.credited;
}

// ---- patient account (deposits and credit) ---------------------------------------------------------

/** Deposits, credit from credit notes and released applications add to the account; applications and refunds take from it. */
export function accountSign(kind: AccountEntryKind): 1 | -1 {
  return kind === "deposit" || kind === "credit" || kind === "release" ? 1 : -1;
}

/** The account balance from its ledger. */
export function accountBalance(entries: ReadonlyArray<{ kind: AccountEntryKind; amount: number }>): number {
  return sum(entries.map((e) => accountSign(e.kind) * e.amount));
}

/** Deposit applied to one invoice: applications less releases. */
export function depositApplied(entries: ReadonlyArray<{ kind: AccountEntryKind; amount: number }>): number {
  return sum(entries.map((e) => (e.kind === "application" ? e.amount : e.kind === "release" ? -e.amount : 0)));
}

/** Why an amount cannot be applied from the account to an invoice, if it cannot: never beyond either balance. */
export function applicationProblem(amount: number, invoiceBalance: number, accountBalance: number): string | null {
  if (!Number.isSafeInteger(amount) || amount <= 0) return "amount_invalid";
  if (amount > accountBalance) return "application_exceeds_account";
  if (amount > invoiceBalance) return "application_exceeds_balance";
  return null;
}

// ---- credit notes -----------------------------------------------------------------------------------

export interface CreditableItem {
  id: string;
  netAmount: number;
  /** Credited on this line by earlier credit notes. */
  credited: number;
}

/**
 * Why credit note lines cannot be issued, if they cannot. Each line credits a
 * line of the invoice, at most what is left of it (its net amount less
 * earlier credits); together they credit at most what is left of the
 * patient's share (payer coverage is not credited here: that is a claim
 * matter, or void + reissue).
 */
export function creditNoteProblem(
  lines: ReadonlyArray<{ invoiceItemId: string; amount: number }>,
  items: ReadonlyArray<CreditableItem>,
  patientShareLeft: number,
): string | null {
  if (lines.length === 0) return "credit_note_empty";
  if (new Set(lines.map((l) => l.invoiceItemId)).size !== lines.length) return "credit_note_duplicate_line";
  for (const line of lines) {
    if (!Number.isSafeInteger(line.amount) || line.amount <= 0) return "amount_invalid";
    const item = items.find((i) => i.id === line.invoiceItemId);
    if (!item) return "credit_note_line_not_on_invoice";
    if (line.amount > item.netAmount - item.credited) return "credit_exceeds_line";
  }
  if (sum(lines.map((l) => l.amount)) > patientShareLeft) return "credit_exceeds_patient_share";
  return null;
}

/**
 * How an issued credit note settles: first what the patient still owes on the
 * invoice, and the rest — money already paid — becomes account credit.
 */
export function splitCredit(amount: number, owed: number): { appliedAmount: number; accountCredit: number } {
  const appliedAmount = Math.min(amount, Math.max(owed, 0));
  return { appliedAmount, accountCredit: amount - appliedAmount };
}

/** Invoice document number: "INV-2026-000123". Prefix and series are configuration (a BIR compliance dependency). */
export function documentNumber(prefix: string, year: number, value: number): string {
  return `${prefix}-${year}-${String(value).padStart(6, "0")}`;
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
