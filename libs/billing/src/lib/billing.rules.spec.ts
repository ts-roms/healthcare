import {
  accountBalance,
  applicationProblem,
  computeInvoice,
  creditNoteProblem,
  depositApplied,
  discountConflict,
  documentNumber,
  invoiceBalance,
  paidNet,
  patientBalance,
  refundable,
  splitCredit,
} from "./billing.rules";
import { formatPeso, percentOf } from "./money";

describe("money", () => {
  it("takes percentages in basis points, rounding half up to the centavo", () => {
    expect(percentOf(50_000, 2_000)).toBe(10_000); // 20% of ₱500
    expect(percentOf(333, 2_000)).toBe(67); // 66.6 → 67
    expect(percentOf(332, 2_000)).toBe(66); // 66.4 → 66
    expect(percentOf(25, 2_000)).toBe(5);
    expect(() => percentOf(10.5, 2_000)).toThrow(RangeError);
  });

  it("formats pesos", () => {
    expect(formatPeso(123_450)).toBe("₱1,234.50");
    expect(formatPeso(5)).toBe("₱0.05");
    expect(formatPeso(-10_000)).toBe("-₱100.00");
  });
});

describe("computeInvoice", () => {
  const lines = [
    { grossAmount: 50_000, category: "consultation" },
    { grossAmount: 35_000, category: "laboratory" },
    { grossAmount: 10_000, category: "supply" },
  ];

  it("totals without discounts", () => {
    expect(computeInvoice(lines, [])).toMatchObject({ grossTotal: 95_000, discountTotal: 0, netTotal: 95_000 });
  });

  it("applies a discount only to its categories", () => {
    const result = computeInvoice(lines, [{ rateBp: 2_000, categories: ["consultation", "laboratory"] }]);
    expect(result.lines.map((l) => l.discountAmount)).toEqual([10_000, 7_000, 0]);
    expect(result).toMatchObject({ discountAmounts: [17_000], discountTotal: 17_000, netTotal: 78_000 });
  });

  it("applies stacked discounts one after another to what remains, never below zero", () => {
    const result = computeInvoice(
      [{ grossAmount: 10_000, category: "consultation" }],
      [
        { rateBp: 2_000, categories: [] },
        { rateBp: 10_000, categories: [] },
      ],
    );
    expect(result.discountAmounts).toEqual([2_000, 8_000]);
    expect(result.netTotal).toBe(0);
  });
});

describe("discount combinations", () => {
  it("allows one discount, and more only when all are stackable", () => {
    expect(discountConflict({ stackable: false, statutory: true }, [])).toBeNull();
    expect(discountConflict({ stackable: false, statutory: true }, [{ stackable: false }])).toBe("statutory_discount_not_combinable");
    expect(discountConflict({ stackable: true, statutory: false }, [{ stackable: false }])).toBe("discount_not_combinable");
    expect(discountConflict({ stackable: true, statutory: false }, [{ stackable: true }])).toBeNull();
  });
});

describe("ledger", () => {
  const ledger = [
    { kind: "payment" as const, amount: 30_000 },
    { kind: "payment" as const, amount: 20_000 },
    { kind: "refund" as const, amount: 5_000 },
  ];

  it("computes what the patient still owes", () => {
    expect(paidNet(ledger)).toBe(45_000);
    expect(patientBalance(60_000, ledger)).toBe(15_000);
  });

  it("limits a refund to what is left of the payment", () => {
    expect(refundable({ amount: 30_000 }, [{ amount: 5_000 }, { amount: 10_000 }])).toBe(15_000);
  });

  it("numbers documents", () => {
    expect(documentNumber("INV", 2026, 123)).toBe("INV-2026-000123");
  });
});

describe("settlement", () => {
  it("settles an invoice with payments, deposit applied and credit notes", () => {
    expect(invoiceBalance(45_000, { paid: 20_000, depositApplied: 10_000, credited: 5_000 })).toBe(10_000);
    expect(invoiceBalance(45_000, { paid: 0, depositApplied: 0, credited: 0 })).toBe(45_000);
  });
});

describe("patient account", () => {
  const ledger = [
    { kind: "deposit" as const, amount: 100_000 },
    { kind: "application" as const, amount: 30_000 },
    { kind: "credit" as const, amount: 5_000 },
    { kind: "refund" as const, amount: 20_000 },
    { kind: "release" as const, amount: 30_000 },
    { kind: "application" as const, amount: 10_000 },
  ];

  it("derives the balance from the ledger", () => {
    expect(accountBalance(ledger)).toBe(75_000);
    expect(accountBalance([])).toBe(0);
  });

  it("counts what is applied to an invoice, less releases", () => {
    expect(depositApplied(ledger)).toBe(10_000);
  });

  it("never applies more than the account or the invoice balance", () => {
    expect(applicationProblem(10_000, 20_000, 15_000)).toBeNull();
    expect(applicationProblem(15_000, 15_000, 15_000)).toBeNull();
    expect(applicationProblem(16_000, 20_000, 15_000)).toBe("application_exceeds_account");
    expect(applicationProblem(16_000, 15_000, 20_000)).toBe("application_exceeds_balance");
    expect(applicationProblem(0, 15_000, 20_000)).toBe("amount_invalid");
    expect(applicationProblem(10.5, 15_000, 20_000)).toBe("amount_invalid");
  });
});

describe("credit notes", () => {
  const items = [
    { id: "a", netAmount: 40_000, credited: 0 },
    { id: "b", netAmount: 20_000, credited: 15_000 },
  ];

  it("credits lines of the invoice within what is left of each line and of the patient's share", () => {
    expect(creditNoteProblem([{ invoiceItemId: "a", amount: 40_000 }], items, 45_000)).toBeNull();
    expect(creditNoteProblem([{ invoiceItemId: "b", amount: 5_000 }], items, 45_000)).toBeNull();
    expect(creditNoteProblem([{ invoiceItemId: "b", amount: 5_001 }], items, 45_000)).toBe("credit_exceeds_line");
    expect(
      creditNoteProblem(
        [
          { invoiceItemId: "a", amount: 40_000 },
          { invoiceItemId: "b", amount: 5_000 },
        ],
        items,
        44_999,
      ),
    ).toBe("credit_exceeds_patient_share");
  });

  it("refuses empty, duplicate, unknown and non-integer lines", () => {
    expect(creditNoteProblem([], items, 45_000)).toBe("credit_note_empty");
    expect(
      creditNoteProblem(
        [
          { invoiceItemId: "a", amount: 1 },
          { invoiceItemId: "a", amount: 1 },
        ],
        items,
        45_000,
      ),
    ).toBe("credit_note_duplicate_line");
    expect(creditNoteProblem([{ invoiceItemId: "x", amount: 1 }], items, 45_000)).toBe("credit_note_line_not_on_invoice");
    expect(creditNoteProblem([{ invoiceItemId: "a", amount: 0.5 }], items, 45_000)).toBe("amount_invalid");
  });

  it("reduces what is owed first; what was already paid becomes account credit", () => {
    expect(splitCredit(10_000, 25_000)).toEqual({ appliedAmount: 10_000, accountCredit: 0 });
    expect(splitCredit(10_000, 4_000)).toEqual({ appliedAmount: 4_000, accountCredit: 6_000 });
    expect(splitCredit(10_000, 0)).toEqual({ appliedAmount: 0, accountCredit: 10_000 });
  });
});
