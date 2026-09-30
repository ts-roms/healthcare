import { recordAdministeredSchema, recordHistoricalSchema } from "./immunization.dto";
import {
  cleanOptions,
  doseText,
  expiryValid,
  isOccurrenceText,
  occurrenceInFuture,
  occurrenceText,
  parseOccurrence,
  precisionAllowedHere,
} from "./immunization.rules";

const VACCINE = "3f1f7c1e-5b36-4a51-9a51-0d6a4c1f0b11";

describe("immunization occurrences (partial dates)", () => {
  it("reads a year, a month, a day and an instant at their precision", () => {
    expect(parseOccurrence("2019", "Asia/Manila")).toEqual({ date: "2019-01-01", precision: "year", at: null });
    expect(parseOccurrence("2019-05", "Asia/Manila")).toEqual({ date: "2019-05-01", precision: "month", at: null });
    expect(parseOccurrence("2019-05-12", "Asia/Manila")).toEqual({ date: "2019-05-12", precision: "day", at: null });
    const late = parseOccurrence("2026-09-29T17:30:00Z", "Asia/Manila");
    // 01:30 on 30 September in Manila: the calendar day is the facility's.
    expect(late).toEqual({ date: "2026-09-30", precision: "time", at: new Date("2026-09-29T17:30:00Z") });
  });

  it("refuses what it cannot record", () => {
    for (const bad of ["childhood", "2019-13", "2019-02-30", "19", "1850", "2019-05-12T10:00", "2019/05/12"]) expect(isOccurrenceText(bad)).toBe(false);
    for (const good of ["2019", "2019-05", "2019-05-12", "2019-05-12T10:00:00+08:00", "2019-05-12T02:00:00.000Z"]) expect(isOccurrenceText(good)).toBe(true);
    expect(() => parseOccurrence("sometime", "Asia/Manila")).toThrow();
  });

  it("writes an occurrence back at its precision", () => {
    expect(occurrenceText({ date: "2019-01-01", precision: "year", at: null })).toBe("2019");
    expect(occurrenceText({ date: "2019-05-01", precision: "month", at: null })).toBe("2019-05");
    expect(occurrenceText({ date: "2019-05-12", precision: "day", at: null })).toBe("2019-05-12");
    expect(occurrenceText({ date: "2019-05-12", precision: "time", at: new Date("2019-05-12T02:00:00Z") })).toBe("2019-05-12T02:00:00.000Z");
  });

  it("knows a future occurrence (a year or month only once it starts after today)", () => {
    const now = new Date("2026-09-30T02:00:00Z");
    expect(occurrenceInFuture(parseOccurrence("2026", "Asia/Manila"), "2026-09-30", now)).toBe(false);
    expect(occurrenceInFuture(parseOccurrence("2026-10", "Asia/Manila"), "2026-09-30", now)).toBe(true);
    expect(occurrenceInFuture(parseOccurrence("2026-09-30", "Asia/Manila"), "2026-09-30", now)).toBe(false);
    expect(occurrenceInFuture(parseOccurrence("2026-09-30T03:00:00Z", "Asia/Manila"), "2026-09-30", now)).toBe(true);
  });

  it("allows only a day or a time for a dose given here", () => {
    expect(precisionAllowedHere("day")).toBe(true);
    expect(precisionAllowedHere("time")).toBe(true);
    expect(precisionAllowedHere("month")).toBe(false);
    expect(precisionAllowedHere("year")).toBe(false);
  });
});

describe("immunization rules", () => {
  it("accepts an expiry on or after the day given", () => {
    expect(expiryValid("2026-09-30", "2026-09-30")).toBe(true);
    expect(expiryValid("2027-01-31", "2026-09-30")).toBe(true);
    expect(expiryValid("2026-09-29", "2026-09-30")).toBe(false);
    expect(expiryValid(null, "2026-09-30")).toBe(true);
  });

  it("shows the dose as recorded", () => {
    expect(doseText({ doseLabel: null, doseNumber: 2 })).toBe("Dose 2");
    expect(doseText({ doseLabel: "Booster", doseNumber: null })).toBe("Booster");
    expect(doseText({ doseLabel: "Booster", doseNumber: 3 })).toBe("Booster (dose 3)");
    expect(doseText({ doseLabel: "Dose 1", doseNumber: 1 })).toBe("Dose 1");
    expect(doseText({ doseLabel: null, doseNumber: null })).toBeNull();
  });

  it("cleans catalogue options", () => {
    expect(cleanOptions([" IM ", "im", "SC", ""])).toEqual(["IM", "SC"]);
  });
});

describe("immunization input validation", () => {
  it("needs a lot number (or stock) for a dose given, and a reason for one not given", () => {
    expect(recordAdministeredSchema.safeParse({ vaccineId: VACCINE }).success).toBe(false);
    expect(recordAdministeredSchema.safeParse({ vaccineId: VACCINE, lotNumber: "A123" }).success).toBe(true);
    expect(
      recordAdministeredSchema.safeParse({
        vaccineId: VACCINE,
        stock: { locationId: VACCINE, lotId: VACCINE },
      }).success,
    ).toBe(true);
    expect(recordAdministeredSchema.safeParse({ vaccineId: VACCINE, status: "not_done" }).success).toBe(false);
    expect(recordAdministeredSchema.safeParse({ vaccineId: VACCINE, status: "not_done", notDoneReason: "refused" }).success).toBe(true);
    expect(recordAdministeredSchema.safeParse({ vaccineId: VACCINE, status: "not_done", notDoneReason: "other" }).success).toBe(false);
    expect(recordAdministeredSchema.safeParse({ vaccineId: VACCINE, status: "not_done", notDoneReason: "refused", lotNumber: "A1" }).success).toBe(false);
  });

  it("takes a day or a time for a dose given here, and the amount with its unit", () => {
    expect(recordAdministeredSchema.safeParse({ vaccineId: VACCINE, lotNumber: "A1", occurrence: "2026-09" }).success).toBe(false);
    expect(recordAdministeredSchema.safeParse({ vaccineId: VACCINE, lotNumber: "A1", occurrence: "2026-09-29" }).success).toBe(true);
    expect(recordAdministeredSchema.safeParse({ vaccineId: VACCINE, lotNumber: "A1", doseQuantity: 0.5 }).success).toBe(false);
    expect(recordAdministeredSchema.safeParse({ vaccineId: VACCINE, lotNumber: "A1", doseQuantity: 0.5, doseUnit: "mL" }).success).toBe(true);
  });

  it("records a reported dose with a partial date, a vaccine or its name, and where the information comes from", () => {
    const base = { occurrence: "2019", sourceDescription: "Vaccination card" };
    expect(recordHistoricalSchema.safeParse({ ...base, vaccineName: "Measles-containing vaccine" }).success).toBe(true);
    expect(recordHistoricalSchema.safeParse({ ...base, vaccineId: VACCINE }).success).toBe(true);
    expect(recordHistoricalSchema.safeParse({ ...base }).success).toBe(false);
    expect(recordHistoricalSchema.safeParse({ ...base, vaccineId: VACCINE, vaccineName: "X" }).success).toBe(false);
    expect(recordHistoricalSchema.safeParse({ occurrence: "2019", vaccineId: VACCINE }).success).toBe(false);
    expect(recordHistoricalSchema.safeParse({ ...base, vaccineId: VACCINE, occurrence: "2019-05-12T10:00:00Z" }).success).toBe(false);
  });
});
