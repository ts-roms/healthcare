import { describe, expect, it } from "vitest";
import { ADULT_VITAL_BANDS, interpretVital } from "./vital-bands";

describe("interpretVital", () => {
  it("is inclusive at both ends of the band", () => {
    expect(interpretVital("heartRate", 60)).toBe("normal");
    expect(interpretVital("heartRate", 100)).toBe("normal");
    expect(interpretVital("heartRate", 59)).toBe("low");
    expect(interpretVital("heartRate", 101)).toBe("high");
  });

  it("handles fractions and a missing reading", () => {
    expect(interpretVital("temperatureC", 37.5)).toBe("normal");
    expect(interpretVital("temperatureC", 37.6)).toBe("high");
    expect(interpretVital("spo2", 94)).toBe("low");
    expect(interpretVital("systolic", undefined)).toBe("normal");
  });

  it("keeps the bands the vital signs display has always used", () => {
    expect(ADULT_VITAL_BANDS.systolic).toEqual({ low: 90, high: 139 });
    expect(ADULT_VITAL_BANDS.diastolic).toEqual({ low: 60, high: 89 });
  });
});
