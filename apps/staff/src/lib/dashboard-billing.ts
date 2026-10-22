import type { BillingWorklistRow, DailyBillingReport, InvoiceSummary } from "./api/types";

/**
 * What the dashboard says about money and the queue for the people who work the desk and the cashier: derived only from what
 * the billing and clinic dashboards already answer (the thresholds and groupings are how the screen is drawn, not API rules).
 */

export interface BillingFigures {
  /** Patients with charges waiting to be invoiced, and the amount (centavos). */
  toInvoice: { patients: number; charges: number; amount: number };
  /** Issued invoices with a balance, and what is still owed (centavos). */
  owed: { invoices: number; amount: number };
  /** From the daily report (null without `billing.report.read`): collected today (centavos) and the number of payments. */
  collected: { amount: number; payments: number } | null;
  /** Invoices issued today (null without the report). */
  issuedToday: number | null;
}

export function billingFigures(input: {
  worklist: BillingWorklistRow[] | null;
  unpaid: InvoiceSummary[] | null;
  report: DailyBillingReport | null;
}): BillingFigures {
  const worklist = input.worklist ?? [];
  const unpaid = (input.unpaid ?? []).filter((i) => i.status === "issued" && i.balance > 0);
  return {
    toInvoice: {
      patients: worklist.length,
      charges: worklist.reduce((n, r) => n + r.count, 0),
      amount: worklist.reduce((n, r) => n + r.amount, 0),
    },
    owed: { invoices: unpaid.length, amount: unpaid.reduce((n, i) => n + i.balance, 0) },
    collected: input.report ? { amount: input.report.collectedTotal, payments: input.report.collections.reduce((n, c) => n + c.count, 0) } : null,
    issuedToday: input.report ? input.report.invoices.issued : null,
  };
}

/** The queue in the five lanes the desk reads at a glance. */
export const QUEUE_LANES = [
  { key: "waiting", label: "Waiting", statuses: ["waiting"] },
  { key: "triage", label: "Triage", statuses: ["in_triage"] },
  { key: "ready", label: "Ready", statuses: ["awaiting_consultation"] },
  { key: "with", label: "With provider", statuses: ["in_consultation"] },
  { key: "done", label: "Done", statuses: ["completed"] },
] as const;

export interface QueueLane {
  key: (typeof QUEUE_LANES)[number]["key"];
  label: string;
  count: number;
}

export function queueLanes(byStatus: Record<string, number>): QueueLane[] {
  return QUEUE_LANES.map((lane) => ({ key: lane.key, label: lane.label, count: lane.statuses.reduce((n, s) => n + (byStatus[s] ?? 0), 0) }));
}
