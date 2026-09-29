import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHARGE_SOURCE_LABEL,
  addsToAccount,
  coverageCreditable,
  creditableLeft,
  invoiceState,
  parsePesos,
  percent,
  peso,
  pesoInput,
  refundableAmount,
} from "./billing-mapping";

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
    expect(addsToAccount("transfer_in")).toBe(true);
    expect(addsToAccount("transfer_out")).toBe(false);
  });

  it("limits a credit to what is left of the invoice line", () => {
    const notes = [
      { lines: [{ id: "l1", creditNoteId: "c1", invoiceItemId: "a", description: "Consult", amount: 10_000 }] },
      { lines: [{ id: "l2", creditNoteId: "c2", invoiceItemId: "b", description: "FBS", amount: 5_000 }] },
    ];
    expect(creditableLeft({ id: "a", amount: 40_000 }, notes)).toBe(30_000);
    expect(creditableLeft({ id: "c", amount: 15_000 }, notes)).toBe(15_000);
    // A debit note line is creditable the same way.
    const debitCredits = [{ lines: [{ invoiceItemId: null, debitNoteLineId: "d1", amount: 4_000 }] }];
    expect(creditableLeft({ id: "d1", amount: 10_000 }, debitCredits)).toBe(6_000);
  });

  it("credits payer coverage only while the claim is open", () => {
    expect(coverageCreditable({ amount: 30_000, status: "submitted", creditedAmount: 10_000 })).toBe(20_000);
    expect(coverageCreditable({ amount: 30_000, status: "settled", creditedAmount: 0 })).toBe(0);
  });
});

describe("charge source labels", () => {
  it("label every charge source the billing domain records", () => {
    // Read from libs/billing (the staff app may not import it) so a new source cannot show up without a label.
    const schema = readFileSync(new URL("../../../../libs/billing/src/lib/billing.schema.ts", import.meta.url), "utf8");
    const union = /export type ChargeSourceType = ([^;]+);/.exec(schema)?.[1] ?? "";
    const sources = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThan(0);
    expect(Object.keys(CHARGE_SOURCE_LABEL).sort()).toEqual(sources.sort());
  });
});
