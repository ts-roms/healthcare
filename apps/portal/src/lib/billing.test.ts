import { describe, expect, it } from "vitest";
import { invoiceStatus, peso, totalDue } from "./billing";

describe("billing", () => {
  it("formats pesos", () => {
    expect(peso(450_000)).toBe("₱4,500.00");
  });

  it("describes where an invoice stands", () => {
    expect(invoiceStatus({ status: "issued", balance: 45_000, paidTotal: 0 })).toEqual({ label: "To pay · ₱450.00", tone: "due" });
    expect(invoiceStatus({ status: "issued", balance: 5_000, paidTotal: 40_000 }).label).toBe("Partly paid · ₱50.00 left");
    expect(invoiceStatus({ status: "issued", balance: 0, paidTotal: 45_000 }).tone).toBe("paid");
    expect(invoiceStatus({ status: "void", balance: 0, paidTotal: 0 }).tone).toBe("void");
  });

  it("adds up what is still owed on valid invoices", () => {
    expect(
      totalDue([
        { status: "issued", balance: 5_000 },
        { status: "void", balance: 0 },
        { status: "issued", balance: 0 },
      ]),
    ).toBe(5_000);
  });
});
