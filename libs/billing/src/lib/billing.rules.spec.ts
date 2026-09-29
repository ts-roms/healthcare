import {
  chargeQuantity,
  accountBalance,
  applicationProblem,
  computeInvoice,
  creditAllocationProblem,
  creditNoteProblem,
  debitNoteProblem,
  onlinePaymentSplit,
  packageCovers,
  packageEndsOn,
  depositApplied,
  discountConflict,
  documentNumber,
  invoiceBalance,
  paidNet,
  patientBalance,
  refundable,
  splitCredit,
  taxBreakdown,
  transferPlan,
  vatIncluded,
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
    expect(invoiceBalance(45_000, { paid: 20_000, depositApplied: 10_000, credited: 5_000, debited: 0 })).toBe(10_000);
    expect(invoiceBalance(45_000, { paid: 0, depositApplied: 0, credited: 0, debited: 0 })).toBe(45_000);
    // A debit note adds to what is owed.
    expect(invoiceBalance(45_000, { paid: 45_000, depositApplied: 0, credited: 0, debited: 12_000 })).toBe(12_000);
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

  it("credits lines of the invoice or a debit note within what is left of each", () => {
    expect(creditNoteProblem([{ targetId: "a", amount: 40_000 }], items)).toBeNull();
    expect(creditNoteProblem([{ targetId: "b", amount: 5_000 }], items)).toBeNull();
    expect(creditNoteProblem([{ targetId: "b", amount: 5_001 }], items)).toBe("credit_exceeds_line");
  });

  it("refuses empty, duplicate, unknown and non-integer lines", () => {
    expect(creditNoteProblem([], items)).toBe("credit_note_empty");
    expect(
      creditNoteProblem(
        [
          { targetId: "a", amount: 1 },
          { targetId: "a", amount: 1 },
        ],
        items,
      ),
    ).toBe("credit_note_duplicate_line");
    expect(creditNoteProblem([{ targetId: "x", amount: 1 }], items)).toBe("credit_note_line_not_on_invoice");
    expect(creditNoteProblem([{ targetId: "a", amount: 0.5 }], items)).toBe("amount_invalid");
  });

  it("divides a credit between payers (unsettled coverage) and the patient's share", () => {
    const coverage = [
      { id: "hmo", left: 30_000, status: "submitted" as const },
      { id: "ph", left: 10_000, status: "settled" as const },
    ];
    expect(creditAllocationProblem(40_000, [{ invoicePayerId: "hmo", amount: 30_000 }], coverage, 10_000)).toBeNull();
    expect(creditAllocationProblem(40_000, [{ invoicePayerId: "hmo", amount: 20_000 }], coverage, 10_000)).toBe("credit_exceeds_patient_share");
    expect(creditAllocationProblem(40_000, [{ invoicePayerId: "hmo", amount: 30_001 }], coverage, 50_000)).toBe("credit_exceeds_coverage");
    expect(creditAllocationProblem(40_000, [{ invoicePayerId: "ph", amount: 1_000 }], coverage, 50_000)).toBe("coverage_not_creditable");
    expect(creditAllocationProblem(40_000, [{ invoicePayerId: "x", amount: 1_000 }], coverage, 50_000)).toBe("coverage_not_on_invoice");
    expect(creditAllocationProblem(10_000, [{ invoicePayerId: "hmo", amount: 20_000 }], coverage, 50_000)).toBe("credit_allocation_exceeds_total");
    expect(creditAllocationProblem(15_000, [], coverage, 15_000)).toBeNull();
  });

  it("checks debit note lines", () => {
    expect(debitNoteProblem([{ quantity: 2, unitPrice: 15_000 }])).toBeNull();
    expect(debitNoteProblem([])).toBe("debit_note_empty");
    expect(debitNoteProblem([{ quantity: 0, unitPrice: 15_000 }])).toBe("quantity_invalid");
    expect(debitNoteProblem([{ quantity: 1, unitPrice: 0 }])).toBe("amount_invalid");
  });

  it("reduces what is owed first; what was already paid becomes account credit", () => {
    expect(splitCredit(10_000, 25_000)).toEqual({ appliedAmount: 10_000, accountCredit: 0 });
    expect(splitCredit(10_000, 4_000)).toEqual({ appliedAmount: 4_000, accountCredit: 6_000 });
    expect(splitCredit(10_000, 0)).toEqual({ appliedAmount: 0, accountCredit: 10_000 });
  });
});

describe("packages", () => {
  const enrollment = { status: "active" as const, startsOn: "2026-01-01", endsOn: "2026-12-31" };

  it("covers an included service while enough is left, in the package's dates", () => {
    expect(packageCovers(enrollment, 2, 1, 1, "2026-06-01")).toBe(true);
    expect(packageCovers(enrollment, 2, 2, 1, "2026-06-01")).toBe(false);
    expect(packageCovers(enrollment, 2, 1, 2, "2026-06-01")).toBe(false);
    expect(packageCovers(enrollment, 2, 0, 1, "2027-01-01")).toBe(false);
    expect(packageCovers(enrollment, 2, 0, 1, "2025-12-31")).toBe(false);
    expect(packageCovers({ ...enrollment, status: "cancelled" }, 2, 0, 1, "2026-06-01")).toBe(false);
    expect(packageCovers({ ...enrollment, endsOn: null }, 1, 0, 1, "2030-01-01")).toBe(true);
  });

  it("ends a package after its validity in days, counting the day of sale", () => {
    expect(packageEndsOn("2026-01-01", 365)).toBe("2026-12-31");
    expect(packageEndsOn("2026-02-28", 2)).toBe("2026-03-01");
    expect(packageEndsOn("2026-01-01", null)).toBeNull();
  });
});

describe("online payment", () => {
  it("settles the balance and keeps any excess as a deposit", () => {
    expect(onlinePaymentSplit(45_000, 45_000)).toEqual({ payment: 45_000, deposit: 0 });
    expect(onlinePaymentSplit(45_000, 20_000)).toEqual({ payment: 20_000, deposit: 25_000 });
    expect(onlinePaymentSplit(45_000, 0)).toEqual({ payment: 0, deposit: 45_000 });
  });
});

describe("tax breakdown (from the organization's settings)", () => {
  it("takes VAT out of VAT-inclusive amounts, half up to the centavo", () => {
    expect(vatIncluded(112_000, 1_200)).toBe(12_000); // ₱1,120 at 12% → ₱120
    expect(vatIncluded(100, 1_200)).toBe(11); // 10.71 → 11
    expect(vatIncluded(0, 1_200)).toBe(0);
    expect(() => vatIncluded(100, 0)).toThrow(RangeError);
  });

  it("breaks an invoice down by class when VAT-registered, and not otherwise", () => {
    const lines = [
      { netAmount: 112_000, taxClass: "vatable" as const },
      { netAmount: 50_000, taxClass: "vat_exempt" as const },
      { netAmount: 10_000, taxClass: "zero_rated" as const },
    ];
    expect(taxBreakdown(lines, { vatStatus: "vat_registered", vatRateBp: 1_200 })).toEqual({
      breakdown: { lineVat: [12_000, 0, 0], vatableSales: 100_000, vatAmount: 12_000, vatExemptSales: 50_000, zeroRatedSales: 10_000 },
    });
    expect(taxBreakdown(lines, { vatStatus: "non_vat", vatRateBp: null })).toEqual({
      breakdown: { lineVat: [0, 0, 0], vatableSales: 0, vatAmount: 0, vatExemptSales: 0, zeroRatedSales: 0 },
    });
    expect(taxBreakdown([{ netAmount: 1, taxClass: null }], { vatStatus: "vat_registered", vatRateBp: 1_200 })).toEqual({ problem: "tax_class_required" });
  });
});

describe("deposits across facilities", () => {
  it("moves balance from the other facilities, largest first, never more than each has", () => {
    const others = [
      { facilityId: "b", balance: 10_000 },
      { facilityId: "c", balance: 30_000 },
      { facilityId: "d", balance: 0 },
    ];
    expect(transferPlan(35_000, others)).toEqual([
      { facilityId: "c", amount: 30_000 },
      { facilityId: "b", amount: 5_000 },
    ]);
    expect(transferPlan(50_000, others).reduce((a, p) => a + p.amount, 0)).toBe(40_000);
    expect(transferPlan(0, others)).toEqual([]);
  });

  it("counts transfers in and out in the balance", () => {
    expect(
      accountBalance([
        { kind: "deposit", amount: 10_000 },
        { kind: "transfer_out", amount: 4_000 },
        { kind: "transfer_in", amount: 1_000 },
      ]),
    ).toBe(7_000);
  });
});

describe("chargeQuantity", () => {
  it("charges one item, or each surface treated (at least one)", () => {
    expect(chargeQuantity("each", 3)).toBe(1);
    expect(chargeQuantity("surface", 3)).toBe(3);
    expect(chargeQuantity("surface", 0)).toBe(1);
  });
});
