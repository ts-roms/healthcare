import {
  addDays,
  invoiceableQuantity,
  invoiceOverdue,
  priceVariance,
  supplierInvoiceAllows,
  allocateFefo,
  crossedReorderLevel,
  expiryStatus,
  isExpired,
  purchaseOrderAllows,
  purchaseOrderNumber,
  reorderSuggestion,
  statusAfterReceipt,
  stockStatus,
} from "./inventory.rules";

const today = "2026-09-28";
const lots = [
  { lotId: "late", lotNumber: "L3", expiryDate: "2027-06-30", quantity: 50 },
  { lotId: "none", lotNumber: null, expiryDate: null, quantity: 20 },
  { lotId: "soon", lotNumber: "L2", expiryDate: "2026-10-15", quantity: 10 },
  { lotId: "expired", lotNumber: "L1", expiryDate: "2026-09-27", quantity: 100 },
  { lotId: "empty", lotNumber: "L0", expiryDate: "2026-10-01", quantity: 0 },
];

describe("inventory rules", () => {
  it("allocates first-expiry-first-out, never from expired lots, lots without expiry last", () => {
    expect(allocateFefo(lots, 5, today)).toEqual({ ok: true, allocations: [{ lotId: "soon", quantity: 5 }] });
    expect(allocateFefo(lots, 25, today)).toEqual({
      ok: true,
      allocations: [
        { lotId: "soon", quantity: 10 },
        { lotId: "late", quantity: 15 },
      ],
    });
    expect(allocateFefo(lots, 75, today)).toEqual({
      ok: true,
      allocations: [
        { lotId: "soon", quantity: 10 },
        { lotId: "late", quantity: 50 },
        { lotId: "none", quantity: 15 },
      ],
    });
    // 100 units sit in an expired lot: not usable.
    expect(allocateFefo(lots, 81, today)).toEqual({ ok: false, available: 80 });
  });

  it("classifies expiry and stock", () => {
    expect(isExpired("2026-09-28", today)).toBe(false); // the expiry date is still usable
    expect(isExpired("2026-09-27", today)).toBe(true);
    expect(expiryStatus("2026-10-15", today, 30)).toBe("expiring");
    expect(expiryStatus("2027-01-01", today, 30)).toBe("ok");
    expect(expiryStatus("2026-01-01", today, 30)).toBe("expired");
    expect(expiryStatus(null, today, 30)).toBe("no_expiry");
    expect([stockStatus(0, 10), stockStatus(10, 10), stockStatus(11, 10), stockStatus(3, null)]).toEqual(["out", "low", "ok", "ok"]);
    expect([crossedReorderLevel(12, 10, 10), crossedReorderLevel(10, 8, 10), crossedReorderLevel(12, 11, 10), crossedReorderLevel(5, 1, null)]).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04");
  });
});

describe("purchase order rules", () => {
  it("allows each action only in the right statuses", () => {
    expect(purchaseOrderAllows("draft", "edit")).toBe(true);
    expect(purchaseOrderAllows("submitted", "edit")).toBe(false);
    expect(purchaseOrderAllows("submitted", "approve")).toBe(true);
    expect(purchaseOrderAllows("draft", "receive")).toBe(false);
    expect(purchaseOrderAllows("partially_received", "receive")).toBe(true);
    expect(purchaseOrderAllows("partially_received", "cancel")).toBe(false);
    expect(purchaseOrderAllows("partially_received", "close")).toBe(true);
    expect(purchaseOrderAllows("received", "close")).toBe(false);
  });

  it("numbers orders per year", () => {
    expect(purchaseOrderNumber(2026, 42)).toBe("PO-2026-000042");
  });

  it("knows when an order is fully received", () => {
    expect(
      statusAfterReceipt([
        { quantityOrdered: 10, quantityReceived: 10 },
        { quantityOrdered: 5, quantityReceived: 2 },
      ]),
    ).toBe("partially_received");
    expect(statusAfterReceipt([{ quantityOrdered: 10, quantityReceived: 10 }])).toBe("received");
  });

  it("suggests reordering when stock plus open orders is at or below the level", () => {
    expect(reorderSuggestion(5, 0, 10, 50)).toEqual({ needed: true, suggestedQuantity: 50 });
    expect(reorderSuggestion(5, 20, 10, 50)).toEqual({ needed: false, suggestedQuantity: null });
    expect(reorderSuggestion(10, 0, 10, null)).toEqual({ needed: true, suggestedQuantity: null });
  });
});

describe("supplier invoices", () => {
  it("moves recorded → approved → paid, and voids only unpaid invoices", () => {
    expect(supplierInvoiceAllows("recorded", "approve")).toBe(true);
    expect(supplierInvoiceAllows("recorded", "pay")).toBe(false);
    expect(supplierInvoiceAllows("approved", "pay")).toBe(true);
    expect(supplierInvoiceAllows("approved", "void")).toBe(true);
    expect(supplierInvoiceAllows("paid", "void")).toBe(false);
    expect(supplierInvoiceAllows("void", "approve")).toBe(false);
  });

  it("invoices only what was received and not yet invoiced", () => {
    expect(invoiceableQuantity({ quantityReceived: 100, quantityInvoiced: 60 })).toBe(40);
    expect(invoiceableQuantity({ quantityReceived: 50, quantityInvoiced: 60 })).toBe(0);
  });

  it("shows price differences from the order, and overdue open invoices", () => {
    expect(priceVariance(850, 900)).toBe(50);
    expect(priceVariance(null, 900)).toBeNull();
    expect(invoiceOverdue({ status: "approved", dueDate: "2026-09-01" }, "2026-09-02")).toBe(true);
    expect(invoiceOverdue({ status: "paid", dueDate: "2026-09-01" }, "2026-09-02")).toBe(false);
    expect(invoiceOverdue({ status: "recorded", dueDate: null }, "2026-09-02")).toBe(false);
  });
});
