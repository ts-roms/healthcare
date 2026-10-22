import { describe, expect, it } from "vitest";
import type { BillingWorklistRow, DailyBillingReport, InvoiceSummary } from "./api/types";
import { billingFigures, queueLanes } from "./dashboard-billing";

const row = (count: number, amount: number): BillingWorklistRow => ({ patientId: "p", count, amount, oldest: "2026-10-22T00:00:00Z", patient: null });
const invoice = (status: InvoiceSummary["status"], balance: number): InvoiceSummary => ({ id: String(balance), status, balance }) as unknown as InvoiceSummary;
const report = {
  invoices: { issued: 3 },
  collections: [
    { method: "cash", count: 2, amount: 150_000 },
    { method: "card", count: 1, amount: 50_000 },
  ],
  collectedTotal: 200_000,
} as unknown as DailyBillingReport;

describe("billingFigures", () => {
  it("adds up what waits to be invoiced and what is still owed", () => {
    const f = billingFigures({
      worklist: [row(2, 37_000), row(1, 10_000)],
      unpaid: [invoice("issued", 5_000), invoice("issued", 0), invoice("void", 9_000)],
      report: null,
    });
    expect(f.toInvoice).toEqual({ patients: 2, charges: 3, amount: 47_000 });
    // Only issued invoices with a balance count.
    expect(f.owed).toEqual({ invoices: 1, amount: 5_000 });
  });

  it("reads the day's collections only when the report is available", () => {
    expect(billingFigures({ worklist: [], unpaid: [], report: null })).toMatchObject({ collected: null, issuedToday: null });
    expect(billingFigures({ worklist: [], unpaid: [], report })).toMatchObject({ collected: { amount: 200_000, payments: 3 }, issuedToday: 3 });
  });

  it("copes with nothing loaded", () => {
    expect(billingFigures({ worklist: null, unpaid: null, report: null }).toInvoice).toEqual({ patients: 0, charges: 0, amount: 0 });
  });
});

describe("queueLanes", () => {
  it("groups the visit statuses into the five lanes", () => {
    const lanes = queueLanes({ waiting: 2, in_triage: 1, awaiting_consultation: 3, in_consultation: 1, completed: 4, cancelled: 9 });
    expect(lanes.map((l) => `${l.label}:${l.count}`)).toEqual(["Waiting:2", "Triage:1", "Ready:3", "With provider:1", "Done:4"]);
  });

  it("shows zero for a missing status", () => {
    expect(queueLanes({}).every((l) => l.count === 0)).toBe(true);
  });
});
