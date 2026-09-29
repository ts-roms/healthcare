import { describe, expect, it } from "vitest";
import type { ReorderSuggestion } from "./api/types";
import { linesFromSuggestions, purchaseOrderActions, quantityWithUnit, supplierInvoiceActions, usageLabel } from "./inventory-mapping";

describe("purchase order actions", () => {
  const officer = ["inventory.read", "inventory.move", "inventory.procurement.manage"];
  const approver = ["inventory.read", "inventory.procurement.approve"];

  it("offers submit and cancel on drafts to buyers", () => {
    expect(purchaseOrderActions({ status: "draft", submittedByYou: false }, officer)).toEqual(["submit", "cancel"]);
    expect(purchaseOrderActions({ status: "draft", submittedByYou: false }, approver)).toEqual([]);
  });

  it("offers approval to someone other than the submitter", () => {
    expect(purchaseOrderActions({ status: "submitted", submittedByYou: false }, approver)).toEqual(["approve"]);
    expect(purchaseOrderActions({ status: "submitted", submittedByYou: true }, [...approver, ...officer])).toEqual(["cancel"]);
  });

  it("offers receiving and closing once approved, and nothing once finished", () => {
    expect(purchaseOrderActions({ status: "approved", submittedByYou: true }, officer)).toEqual(["receive", "cancel", "close"]);
    expect(purchaseOrderActions({ status: "partially_received", submittedByYou: true }, officer)).toEqual(["receive", "close"]);
    expect(purchaseOrderActions({ status: "received", submittedByYou: true }, officer)).toEqual([]);
  });
});

describe("lines from reorder suggestions", () => {
  const suggestion = (itemId: string, locationId: string, extra: Partial<ReorderSuggestion>): ReorderSuggestion => ({
    location: { id: locationId, name: "Pharmacy" },
    item: { id: itemId, code: itemId, name: itemId, stockUnit: "box", category: "medicine" },
    usable: 2,
    onOrder: 0,
    reorderLevel: 10,
    reorderQuantity: null,
    suggestedQuantity: null,
    lastSupplier: null,
    ...extra,
  });

  it("uses the reorder quantity, or tops up to twice the level, for one location", () => {
    const lines = linesFromSuggestions(
      [
        suggestion("a", "p", { suggestedQuantity: 50, lastSupplier: { id: "s", name: "S", unitCost: 1200 } }),
        suggestion("b", "p", { onOrder: 3 }),
        suggestion("c", "other", {}),
      ],
      "p",
    );
    expect(lines.map((l) => [l.itemId, l.quantity, l.unitCost])).toEqual([
      ["a", 50, 1200],
      ["b", 15, null],
    ]);
  });
});

describe("quantity with unit", () => {
  it("keeps whole numbers whole", () => {
    expect(quantityWithUnit(30, "capsules")).toBe("30 capsules");
    expect(quantityWithUnit(1.5, "bottle")).toBe("1.50 bottle");
  });
});

describe("supplier invoice actions", () => {
  const officer = ["inventory.read", "inventory.procurement.manage"];
  const approver = ["inventory.read", "inventory.procurement.manage", "inventory.procurement.approve"];

  it("offers approval to someone other than the recorder, payment after approval, and voiding before payment", () => {
    expect(supplierInvoiceActions({ status: "recorded", recordedByYou: false }, approver)).toEqual(["approve", "void"]);
    expect(supplierInvoiceActions({ status: "recorded", recordedByYou: true }, approver)).toEqual(["void"]);
    expect(supplierInvoiceActions({ status: "recorded", recordedByYou: false }, officer)).toEqual(["void"]);
    expect(supplierInvoiceActions({ status: "approved", recordedByYou: true }, officer)).toEqual(["pay", "void"]);
    expect(supplierInvoiceActions({ status: "paid", recordedByYou: false }, approver)).toEqual([]);
  });
});

describe("usageLabel", () => {
  it("names each kind of movement and the workflow behind it", () => {
    expect(usageLabel("receipt", "purchase_order_line")).toBe("Received on purchase orders");
    expect(usageLabel("issue", "prescription_dispense")).toBe("Dispensed on prescriptions");
    expect(usageLabel("issue", null)).toBe("Issued");
    expect(usageLabel("return", "dental_procedure")).toBe("Returned from dental procedures");
    expect(usageLabel("write_off", null)).toBe("Written off");
  });
});
