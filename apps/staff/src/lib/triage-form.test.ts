import { describe, expect, it } from "vitest";
import { bmi, EMPTY_VITALS, parseRiskFlags, parseVitals, vitalErrorsFromApi } from "./triage-form";

describe("parseVitals", () => {
  it("omits blank fields and parses decimals, accepting a decimal comma", () => {
    const { values, errors } = parseVitals({ ...EMPTY_VITALS, temperatureC: "37,8", heartRateBpm: " 88 " });
    expect(values).toEqual({ temperatureC: 37.8, heartRateBpm: 88 });
    expect(errors).toEqual({});
  });

  it("flags impossible values without correcting them", () => {
    const { values, errors } = parseVitals({ ...EMPTY_VITALS, temperatureC: "378", spo2Percent: "97.5", heartRateBpm: "abc" });
    expect(values).toEqual({});
    expect(errors.temperatureC).toMatch(/Outside 30–45/);
    expect(errors.spo2Percent).toBe("Enter a whole number");
    expect(errors.heartRateBpm).toBe("Enter a number");
  });

  it("requires both blood pressure values, with diastolic below systolic", () => {
    expect(parseVitals({ ...EMPTY_VITALS, systolicMmhg: "120" }).errors.diastolicMmhg).toMatch(/both/);
    expect(parseVitals({ ...EMPTY_VITALS, diastolicMmhg: "80" }).errors.systolicMmhg).toMatch(/both/);
    expect(parseVitals({ ...EMPTY_VITALS, systolicMmhg: "80", diastolicMmhg: "90" }).errors.diastolicMmhg).toMatch(/lower/);
    expect(parseVitals({ ...EMPTY_VITALS, systolicMmhg: "120", diastolicMmhg: "80" }).errors).toEqual({});
  });
});

describe("helpers", () => {
  it("computes BMI only with both weight and height", () => {
    expect(bmi(70, 175)).toBe(22.9);
    expect(bmi(70, undefined)).toBeNull();
  });

  it("parses risk flags", () => {
    expect(parseRiskFlags(" fall risk, pregnant ,, fall risk")).toEqual(["fall risk", "pregnant"]);
  });

  it("maps API plausibility details to fields, ignoring unknown ones", () => {
    expect(
      vitalErrorsFromApi([
        { field: "temperatureC", message: "check" },
        { field: "x", message: "y" },
      ]),
    ).toEqual({ temperatureC: "check" });
    expect(vitalErrorsFromApi(undefined)).toEqual({});
  });
});
