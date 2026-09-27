import { computeInvoice, discountConflict, documentNumber, paidNet, patientBalance, refundable } from "./billing.rules";
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
