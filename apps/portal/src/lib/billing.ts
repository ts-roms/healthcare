import type { PortalInvoice } from "./api/types";

/** "₱1,234.50" from integer centavos. */
export function peso(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${sign}₱${Math.floor(abs / 100).toLocaleString("en-PH")}.${String(abs % 100).padStart(2, "0")}`;
}

/** What the patient should know about an invoice, in their words. */
export function invoiceStatus(invoice: Pick<PortalInvoice, "status" | "balance" | "paidTotal">): { label: string; tone: "due" | "paid" | "void" } {
  if (invoice.status === "void") return { label: "Cancelled — replaced or corrected by the clinic", tone: "void" };
  if (invoice.balance <= 0) return { label: "Paid", tone: "paid" };
  return { label: invoice.paidTotal > 0 ? `Partly paid · ${peso(invoice.balance)} left` : `To pay · ${peso(invoice.balance)}`, tone: "due" };
}

/** Total the patient still owes across their invoices. */
export function totalDue(invoices: ReadonlyArray<Pick<PortalInvoice, "status" | "balance">>): number {
  return invoices.filter((i) => i.status === "issued").reduce((a, i) => a + Math.max(i.balance, 0), 0);
}

export const PAYER_STATUS: Record<PortalInvoice["payers"][number]["status"], string> = {
  pending: "awaiting approval",
  submitted: "claim submitted",
  settled: "paid by the payer",
  denied: "not covered — ask the clinic",
};
