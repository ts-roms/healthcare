import { describe, expect, it } from "vitest";
import { describeMedicineSetting, draftKey, draftMedicines, parseMaximum } from "./prescribing-check";
import type { LinePayload } from "./prescription-form";

const line = (values: Partial<LinePayload>): LinePayload =>
  ({
    genericName: "Paracetamol",
    route: "oral",
    frequency: "every_6_hours",
    quantity: 20,
    quantityUnit: "tablets",
    instructions: "After meals",
    ...values,
  }) as LinePayload;

describe("prescribing check", () => {
  it("sends only what the prescribing rules compare", () => {
    expect(draftMedicines([line({ strength: "500 mg", doseAmount: 2, doseUnit: "tablets", brandName: "Biogesic" })])).toEqual([
      { genericName: "Paracetamol", brandName: "Biogesic", strength: "500 mg", doseAmount: 2, doseUnit: "tablets", frequency: "every_6_hours" },
    ]);
    expect(draftMedicines([line({})])).toEqual([{ genericName: "Paracetamol", frequency: "every_6_hours" }]);
  });

  it("gives the same key to the same draft, and a new one when a dose or a medicine changes", () => {
    const a = draftMedicines([line({ doseAmount: 1, doseUnit: "tablet" })]);
    expect(draftKey(a)).toBe(draftKey(draftMedicines([line({ doseAmount: 1, doseUnit: "Tablet", genericName: "paracetamol " })])));
    expect(draftKey(a)).not.toBe(draftKey(draftMedicines([line({ doseAmount: 2, doseUnit: "tablet" })])));
    expect(draftKey(a)).not.toBe(draftKey(draftMedicines([line({ doseAmount: 1, doseUnit: "tablet", frequency: "every_4_hours" })])));
  });

  it("says what a medicine setting holds", () => {
    expect(describeMedicineSetting({ className: "NSAID", maxDailyDose: 3200, doseUnit: "mg", checkRenal: true, checkPregnancy: false })).toBe(
      "Class NSAID · at most 3,200 mg a day · check kidney function",
    );
    expect(describeMedicineSetting({ className: null, maxDailyDose: null, doseUnit: null, checkRenal: true, checkPregnancy: true })).toBe(
      "Check kidney function and pregnancy",
    );
  });

  it("reads a maximum typed with or without separators", () => {
    expect(parseMaximum("3,200")).toBe(3200);
    expect(parseMaximum(" ")).toBeNull();
    expect(parseMaximum("0")).toBeNaN();
    expect(parseMaximum("lots")).toBeNaN();
  });
});
