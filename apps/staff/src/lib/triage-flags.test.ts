import { describe, expect, it } from "vitest";
import { addComplaint, minutesSince, outOfRange, readings, toggleFlag, vitalHints } from "./triage-flags";

describe("readings and out-of-range", () => {
  const values = { systolicMmhg: 148, diastolicMmhg: 94, heartRateBpm: 112, respiratoryRateBpm: 20, temperatureC: 38.6, spo2Percent: 97 };

  it("lists the entered readings against the adult bands", () => {
    expect(readings(values).map((r) => [r.key, r.interpretation])).toEqual([
      ["bp", "high"],
      ["heartRate", "high"],
      ["respiratoryRate", "normal"],
      ["temperatureC", "high"],
      ["spo2", "normal"],
    ]);
  });

  it("names only what is outside the band, with the value and unit", () => {
    expect(outOfRange(values).map((r) => `${r.label} ${r.text}`)).toEqual(["Blood pressure 148/94 mmHg", "Heart rate 112 /min", "Temperature 38.6 °C"]);
  });

  it("flags a low oxygen saturation and ignores blood pressure when only one number is entered", () => {
    expect(outOfRange({ spo2Percent: 92, systolicMmhg: 150 }).map((r) => r.key)).toEqual(["spo2"]);
  });

  it("reads a low diastolic number when the systolic one is within the band", () => {
    expect(readings({ systolicMmhg: 120, diastolicMmhg: 55 })[0]?.interpretation).toBe("low");
    expect(readings({ systolicMmhg: 120, diastolicMmhg: 80 })[0]?.interpretation).toBe("normal");
  });
});

describe("vitalHints", () => {
  it("shows the band while a field is blank and where the reading sits once entered", () => {
    expect(vitalHints({}).heartRate).toEqual({ text: "Normal 60–100", flagged: false });
    expect(vitalHints({ heartRateBpm: 112 }).heartRate).toEqual({ text: "High · normal 60–100", flagged: true });
    expect(vitalHints({ spo2Percent: 97 }).spo2).toEqual({ text: "Normal ≥95", flagged: false });
    expect(vitalHints({ systolicMmhg: 148, diastolicMmhg: 94 }).bp).toEqual({ text: "High · normal 90–139 / 60–89", flagged: true });
  });

  it("gives BMI once weight and height are entered, and says when glucose was not measured", () => {
    expect(vitalHints({ weightKg: 72, heightCm: 170 }).bmi?.text).toBe("BMI 24.9 · normal");
    expect(vitalHints({}).bmi).toBeUndefined();
    expect(vitalHints({}).glucose?.text).toBe("Not measured");
    expect(vitalHints({ bloodGlucoseMgDl: 100 }).glucose?.text).toBe("");
  });
});

describe("complaints, flags and waiting", () => {
  it("adds a complaint to the written text once", () => {
    expect(addComplaint("", "Fever")).toBe("Fever");
    expect(addComplaint("Cough for 2 days.", "Fever")).toBe("Cough for 2 days, fever");
    expect(addComplaint("Fever for 2 days", "Fever")).toBe("Fever for 2 days");
  });

  it("toggles a risk flag regardless of case", () => {
    expect(toggleFlag([], "Fall risk")).toEqual(["Fall risk"]);
    expect(toggleFlag(["Fall risk", "PWD"], "fall risk")).toEqual(["PWD"]);
  });

  it("counts whole minutes since check-in", () => {
    const now = new Date("2026-10-21T02:00:00Z");
    expect(minutesSince("2026-10-21T01:41:30Z", now)).toBe(18);
    expect(minutesSince("2026-10-21T03:00:00Z", now)).toBe(0);
  });
});
