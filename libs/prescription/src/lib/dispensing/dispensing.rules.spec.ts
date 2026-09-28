import { normalizeUnit, remainingToDispense, sameUnit } from "./dispensing.rules";

describe("dispensing rules", () => {
  it("compares units ignoring case and simple plurals", () => {
    expect(normalizeUnit(" Tablets ")).toBe("tablet");
    expect(normalizeUnit("boxes")).toBe("box");
    expect(normalizeUnit("glass")).toBe("glass");
    expect(sameUnit("capsules", "Capsule")).toBe(true);
    expect(sameUnit("tablet", "box of 100")).toBe(false);
  });

  it("allows the prescribed quantity times one plus the refills, in the same unit", () => {
    const item = { quantity: 30, quantityUnit: "tablets", refills: 1 };
    expect(remainingToDispense(item, "tablet", [])).toBe(60);
    expect(remainingToDispense(item, "tablet", [{ quantity: 30, stockUnit: "tablet" }])).toBe(30);
    expect(remainingToDispense(item, "tablet", [{ quantity: 70, stockUnit: "tablet" }])).toBe(0);
  });

  it("does not check when the stock unit differs from the prescribed unit", () => {
    expect(remainingToDispense({ quantity: 1, quantityUnit: "bottle", refills: 0 }, "mL", [])).toBeNull();
  });
});
