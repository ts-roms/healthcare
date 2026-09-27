import { describe, expect, it } from "vitest";
import { blankLine, lineSummary, linesFromPrescription, parseLines } from "./prescription-form";

const amoxicillin = {
  ...blankLine(),
  genericName: "Amoxicillin",
  strength: "500 mg",
  dosageForm: "capsule",
  doseAmount: "1",
  doseUnit: "capsule",
  durationValue: "7",
  quantity: "21",
  quantityUnit: "capsules",
  instructions: "Take after meals until finished.",
};

describe("parseLines", () => {
  it("turns a complete line into the API payload", () => {
    const result = parseLines([amoxicillin]);
    expect(result).toEqual({
      ok: true,
      items: [
        expect.objectContaining({
          genericName: "Amoxicillin",
          strength: "500 mg",
          doseAmount: 1,
          doseUnit: "capsule",
          route: "oral",
          frequency: "three_times_daily",
          durationValue: 7,
          durationUnit: "days",
          quantity: 21,
          quantityUnit: "capsules",
          refills: 0,
          brandName: undefined,
        }),
      ],
    });
  });

  it("reports missing and inconsistent fields on the right line", () => {
    const result = parseLines([amoxicillin, { ...blankLine(), genericName: "Paracetamol", doseAmount: "500", frequency: "as_needed" }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toEqual({});
    expect(result.errors[1]).toMatchObject({
      doseUnit: "Dose amount and unit go together",
      asNeededReason: "Give the as-needed indication",
      quantity: "Enter the quantity to dispense",
      quantityUnit: "e.g. tablets",
      instructions: "Directions for the patient",
    });
  });

  it("drops a duration unit without a duration and checks limits", () => {
    const ok = parseLines([{ ...amoxicillin, durationValue: "" }]);
    expect(ok.ok && ok.items[0]?.durationUnit).toBeUndefined();
    const bad = parseLines([{ ...amoxicillin, refills: "12", durationValue: "1.5" }]);
    expect(!bad.ok && bad.errors[0]).toMatchObject({ refills: "0–11", durationValue: "Whole number, 1–365" });
  });

  it("requires a description for a custom frequency", () => {
    const result = parseLines([{ ...amoxicillin, frequency: "custom" }]);
    expect(!result.ok && result.errors[0]?.frequencyText).toBe("Describe the frequency");
  });
});

describe("display and prefill", () => {
  const issued = {
    genericName: "Amoxicillin",
    brandName: null,
    strength: "500 mg",
    dosageForm: "capsule",
    doseAmount: 1,
    doseUnit: "capsule",
    route: "oral" as const,
    frequency: "three_times_daily" as const,
    frequencyText: null,
    asNeededReason: null,
    durationValue: 7,
    durationUnit: "days" as const,
    quantity: 21,
    quantityUnit: "capsules",
    refills: 0,
  };

  it("summarises a line the way a prescription reads", () => {
    expect(lineSummary(issued)).toBe("Amoxicillin 500 mg capsule — 1 capsule oral, 3 times a day for 7 days (#21 capsules)");
    expect(lineSummary({ ...issued, frequency: "as_needed", asNeededReason: "pain", durationValue: null, refills: 1 })).toBe(
      "Amoxicillin 500 mg capsule — 1 capsule oral, as needed for pain (#21 capsules, 1 refill)",
    );
  });

  it("prefills the form from an issued prescription for replacement", () => {
    const [line] = linesFromPrescription({ items: [{ ...issued, id: "i1", lineNumber: 1, instructions: "After meals" }] });
    expect(line).toMatchObject({ genericName: "Amoxicillin", doseAmount: "1", quantity: "21", refills: "0", durationUnit: "days", brandName: "" });
    expect(parseLines(line ? [line] : []).ok).toBe(true);
  });
});
