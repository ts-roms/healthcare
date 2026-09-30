import { describe, expect, it } from "vitest";
import type { VaccineStockLot } from "./api/types";
import {
  BLANK_GIVEN,
  BLANK_REPORTED,
  givenFormSchema,
  givenPayload,
  groupByVaccine,
  immunizationStatus,
  occurrenceLabel,
  reportedFormSchema,
  reportedPayload,
  splitOptions,
  stockLotLabel,
} from "./immunization-form";

const V = "3f1f7c1e-5b36-4a51-9a51-0d6a4c1f0b11";
const lot: VaccineStockLot = {
  locationId: "11111111-1111-4111-8111-111111111111",
  locationName: "Vaccine refrigerator",
  itemId: "22222222-2222-4222-8222-222222222222",
  itemCode: "flu",
  itemName: "Influenza vaccine vial",
  stockUnit: "vial",
  lotId: "33333333-3333-4333-8333-333333333333",
  lotNumber: "FL-1",
  expiryDate: "2027-06-30",
  quantity: 4,
};
const format = { date: (d: string) => `D:${d}`, dateTime: (d: string) => `T:${d}` };

describe("immunization display", () => {
  it("shows a date at the precision it is known", () => {
    expect(occurrenceLabel("2019", "year", format)).toBe("2019");
    expect(occurrenceLabel("2019-05", "month", format)).toBe("May 2019");
    expect(occurrenceLabel("2019-05-12", "day", format)).toBe("D:2019-05-12");
    expect(occurrenceLabel("2019-05-12T02:00:00.000Z", "time", format)).toBe("T:2019-05-12T02:00:00.000Z");
  });

  it("labels the status in words (entered in error first)", () => {
    expect(immunizationStatus({ status: "completed", enteredInError: null }).label).toBe("Given");
    expect(immunizationStatus({ status: "not_done", enteredInError: null }).label).toBe("Not given");
    expect(immunizationStatus({ status: "completed", enteredInError: { at: "x", reason: "y", byName: null } }).label).toBe("Entered in error");
  });

  it("groups records by vaccine, A–Z, keeping their order", () => {
    const groups = groupByVaccine([
      { vaccineName: "Influenza vaccine", id: "a" },
      { vaccineName: "Hepatitis B vaccine", id: "b" },
      { vaccineName: "influenza vaccine", id: "c" },
    ]);
    expect(groups.map((g) => [g.vaccine, g.records.map((r) => r.id)])).toEqual([
      ["Hepatitis B vaccine", ["b"]],
      ["Influenza vaccine", ["a", "c"]],
    ]);
  });

  it("describes a stock lot and splits catalogue options", () => {
    expect(stockLotLabel(lot)).toBe("Influenza vaccine vial · lot FL-1 · exp. 2027-06-30 · 4 vial · Vaccine refrigerator");
    expect(splitOptions("Intramuscular\nSubcutaneous, intramuscular\n\n")).toEqual(["Intramuscular", "Subcutaneous"]);
  });
});

describe("immunization forms", () => {
  it("needs a lot number or a stock lot for a dose given, and takes the lot from stock", () => {
    expect(givenFormSchema.safeParse({ ...BLANK_GIVEN, vaccineId: V }).success).toBe(false);
    const fromStock = givenFormSchema.parse({ ...BLANK_GIVEN, vaccineId: V, stockLotId: lot.lotId, doseNumber: "1" });
    expect(givenPayload(fromStock, [lot])).toEqual({
      vaccineId: V,
      doseNumber: 1,
      status: "completed",
      stock: { locationId: lot.locationId, lotId: lot.lotId, quantity: 1 },
    });
    const typed = givenFormSchema.parse({
      ...BLANK_GIVEN,
      vaccineId: V,
      lotNumber: "HB-7",
      expiryDate: "2027-01-31",
      doseQuantity: "0.5",
      doseUnit: "mL",
      date: "2026-09-29",
    });
    expect(givenPayload(typed, [])).toMatchObject({ lotNumber: "HB-7", expiryDate: "2027-01-31", doseQuantity: 0.5, doseUnit: "mL", occurrence: "2026-09-29" });
    expect(givenFormSchema.safeParse({ ...BLANK_GIVEN, vaccineId: V, lotNumber: "X", doseQuantity: "0.5" }).success).toBe(false);
  });

  it("needs a reason for a dose not given, and sends nothing given", () => {
    expect(givenFormSchema.safeParse({ ...BLANK_GIVEN, vaccineId: V, given: false }).success).toBe(false);
    expect(givenFormSchema.safeParse({ ...BLANK_GIVEN, vaccineId: V, given: false, notDoneReason: "other" }).success).toBe(false);
    const notGiven = givenFormSchema.parse({ ...BLANK_GIVEN, vaccineId: V, given: false, notDoneReason: "refused", lotNumber: "ignored" });
    expect(givenPayload(notGiven, [lot])).toEqual({ vaccineId: V, status: "not_done", notDoneReason: "refused" });
  });

  it("records a reported dose with a partial date and either a catalogue vaccine or the reported name", () => {
    expect(reportedFormSchema.safeParse({ ...BLANK_REPORTED, vaccineName: "Measles", occurrence: "childhood" }).success).toBe(false);
    expect(reportedFormSchema.safeParse({ ...BLANK_REPORTED, occurrence: "2019" }).success).toBe(false);
    expect(reportedFormSchema.safeParse({ ...BLANK_REPORTED, vaccineId: V, vaccineName: "Measles", occurrence: "2019" }).success).toBe(false);
    const parsed = reportedFormSchema.parse({ ...BLANK_REPORTED, vaccineName: "Measles-containing vaccine", occurrence: "2019-05", doseLabel: "Booster" });
    expect(reportedPayload(parsed)).toEqual({
      vaccineName: "Measles-containing vaccine",
      occurrence: "2019-05",
      doseLabel: "Booster",
      sourceDescription: "Vaccination card",
    });
  });
});
