import { describe, expect, it } from "vitest";
import { addsToAccount, creditableLeft, invoiceState, parsePesos, percent, peso, pesoInput, refundableAmount } from "./billing-mapping";

describe("money display and input", () => {
  it("formats centavos as pesos", () => {
    expect(peso(123_450)).toBe("₱1,234.50");
    expect(peso(5)).toBe("₱0.05");
    expect(peso(-10_000)).toBe("-₱100.00");
    expect(pesoInput(50_005)).toBe("500.05");
  });

  it("parses what a cashier types, refusing anything that is not an amount", () => {
    expect(parsePesos("1,234.5")).toBe(123_450);
    expect(parsePesos("₱500")).toBe(50_000);
    expect(parsePesos(" 0.05 ")).toBe(5);
    expect(parsePesos("12.345")).toBeNull();
    expect(parsePesos("-5")).toBeNull();
    expect(parsePesos("abc")).toBeNull();
  });

  it("shows basis points as a percentage", () => {
    expect(percent(2_000)).toBe("20%");
    expect(percent(1_250)).toBe("12.5%");
  });
});

describe("invoice state", () => {
  const base = { status: "issued" as const, patientTotal: 45_000, paidTotal: 0, balance: 45_000 };
  it("tells draft, unpaid, partly paid, paid and void apart", () => {
    expect(invoiceState({ ...base, status: "draft" })).toBe("draft");
    expect(invoiceState(base)).toBe("unpaid");
    expect(invoiceState({ ...base, paidTotal: 20_000, balance: 25_000 })).toBe("partly_paid");
    expect(invoiceState({ ...base, paidTotal: 45_000, balance: 0 })).toBe("paid");
    expect(invoiceState({ ...base, status: "void", balance: 0 })).toBe("void");
    // Settled in part by deposit or a credit note, without a payment.
    expect(invoiceState({ ...base, balance: 30_000 })).toBe("partly_paid");
  });

  it("limits refunds to what is left of a payment", () => {
    const ledger = [
      { kind: "payment" as const, refundOfId: null, amount: 20_000 },
      { kind: "refund" as const, refundOfId: "p1", amount: 5_000 },
    ];
    expect(refundableAmount("p1", 20_000, ledger)).toBe(15_000);
  });
});

describe("deposits and credit notes", () => {
  it("tells what adds to the patient's account", () => {
    expect(addsToAccount("deposit")).toBe(true);
    expect(addsToAccount("credit")).toBe(true);
    expect(addsToAccount("release")).toBe(true);
    expect(addsToAccount("application")).toBe(false);
    expect(addsToAccount("refund")).toBe(false);
  });

  it("limits a credit to what is left of the invoice line", () => {
    const notes = [
      { lines: [{ id: "l1", creditNoteId: "c1", invoiceItemId: "a", description: "Consult", amount: 10_000 }] },
      { lines: [{ id: "l2", creditNoteId: "c2", invoiceItemId: "b", description: "FBS", amount: 5_000 }] },
    ];
    expect(creditableLeft({ id: "a", netAmount: 40_000 }, notes)).toBe(30_000);
    expect(creditableLeft({ id: "c", netAmount: 15_000 }, notes)).toBe(15_000);
  });
});
