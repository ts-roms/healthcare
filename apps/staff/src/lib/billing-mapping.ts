import type { AccountEntryKind, BillingCategory, BillingCharge, InvoiceCoverage, InvoiceSummary, PaymentMethod, TaxClass } from "./api/types";

/**
 * Display helpers for billing. Amounts are integer centavos from the API;
 * the API computes every total and enforces every rule.
 */

/** "₱1,234.50" */
export function peso(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${sign}₱${Math.floor(abs / 100).toLocaleString("en-PH")}.${String(abs % 100).padStart(2, "0")}`;
}

/** Parses what a cashier types ("1,234.5", "₱500") into centavos; null when it is not an amount. */
export function parsePesos(input: string): number | null {
  const cleaned = input.replace(/[₱,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  const centavos = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(centavos) ? centavos : null;
}

/** "500.00", for prefilling an amount field. */
export function pesoInput(centavos: number): string {
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
}

/** "20%" from basis points. */
export function percent(rateBp: number): string {
  return `${(rateBp / 100).toLocaleString("en-PH", { maximumFractionDigits: 2 })}%`;
}

/** Where a charge came from, as shown on the patient's charges (mirrors the API's charge source types). */
export const CHARGE_SOURCE_LABEL: Record<BillingCharge["sourceType"], string> = {
  encounter: "Consultation",
  lab_order_item: "Laboratory order",
  dental_procedure: "Dental procedure",
  clinic_procedure: "Clinic procedure",
  manual: "Added by staff",
  package: "Package sale",
};

export const CATEGORY_LABEL: Record<BillingCategory, string> = {
  consultation: "Consultation",
  procedure: "Procedure",
  laboratory: "Laboratory",
  dental: "Dental",
  telemedicine: "Telemedicine",
  supply: "Supply",
  other: "Other",
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  e_wallet: "E-wallet",
  bank_transfer: "Bank transfer",
  check: "Check",
  other: "Other",
};

export const COVERAGE_STATUS_LABEL: Record<InvoiceCoverage["status"], string> = {
  pending: "Pending",
  submitted: "Submitted",
  settled: "Settled",
  denied: "Denied",
};

export type InvoiceState = "draft" | "unpaid" | "partly_paid" | "paid" | "void";

/** Where an invoice stands, for its badge (with text and icon, never colour alone). */
export function invoiceState(invoice: Pick<InvoiceSummary, "status" | "patientTotal" | "paidTotal" | "balance">): InvoiceState {
  if (invoice.status === "draft") return "draft";
  if (invoice.status === "void") return "void";
  if (invoice.balance <= 0) return "paid";
  // Paid in part by payments, deposit applied or a credit note.
  return invoice.paidTotal > 0 || invoice.balance < invoice.patientTotal ? "partly_paid" : "unpaid";
}

export const INVOICE_STATE_LABEL: Record<InvoiceState, string> = {
  draft: "Draft",
  unpaid: "Unpaid",
  partly_paid: "Partly paid",
  paid: "Paid",
  void: "Void",
};

/** How much of a payment can still be refunded, given the ledger. */
export function refundableAmount(
  paymentId: string,
  amount: number,
  ledger: ReadonlyArray<{ kind: "payment" | "refund"; refundOfId: string | null; amount: number }>,
): number {
  return amount - ledger.filter((e) => e.kind === "refund" && e.refundOfId === paymentId).reduce((a, e) => a + e.amount, 0);
}

export const ACCOUNT_ENTRY_LABEL: Record<AccountEntryKind, string> = {
  deposit: "Deposit",
  credit: "Credit note",
  application: "Applied to invoice",
  release: "Returned from voided invoice",
  refund: "Refunded",
  transfer_in: "Moved in from another facility",
  transfer_out: "Moved to another facility",
};

/** Whether an account entry adds to the patient's deposit and credit balance. */
export function addsToAccount(kind: AccountEntryKind): boolean {
  return kind === "deposit" || kind === "credit" || kind === "release" || kind === "transfer_in";
}

/** How much of an invoice line (or debit note line) can still be credited, given the credit notes already issued. */
export function creditableLeft(
  line: { id: string; amount: number },
  creditNotes: ReadonlyArray<{ lines: ReadonlyArray<{ invoiceItemId: string | null; debitNoteLineId?: string | null; amount: number }> }>,
): number {
  const credited = creditNotes.flatMap((c) => c.lines).filter((l) => l.invoiceItemId === line.id || l.debitNoteLineId === line.id);
  return line.amount - credited.reduce((a, l) => a + l.amount, 0);
}

/** How much of a payer's coverage can still be credited: its amount less earlier credits, and only while the claim is open. */
export function coverageCreditable(coverage: Pick<InvoiceCoverage, "amount" | "status"> & { creditedAmount: number }): number {
  return coverage.status === "pending" || coverage.status === "submitted" ? coverage.amount - coverage.creditedAmount : 0;
}

export const TAX_CLASS_LABEL: Record<TaxClass, string> = { vatable: "VATable", vat_exempt: "VAT-exempt", zero_rated: "Zero-rated" };
