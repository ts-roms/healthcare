import { describe, expect, it } from "vitest";
import type { LabSendOut, LabTrend, PatientLabResult } from "./api/types";
import {
  byReferenceLaboratory,
  bySpecimenType,
  formatDuration,
  groupResultsByTest,
  mixedUnits,
  overdueMinutes,
  parseResultInput,
  referenceText,
  resultValue,
  sendOutTone,
  trendPoints,
  uiFlag,
} from "./lab-mapping";

describe("uiFlag", () => {
  it("maps API flags to the design system's", () => {
    expect(uiFlag("critical_high")).toBe("critical-high");
    expect(uiFlag("normal")).toBe("normal");
    expect(uiFlag(null)).toBeNull();
  });
});

describe("result display", () => {
  it("shows the value by type", () => {
    expect(resultValue({ resultType: "numeric", valueNumeric: 7.2, valueText: null, valueCoded: null })).toBe("7.2");
    expect(resultValue({ resultType: "coded", valueNumeric: null, valueText: null, valueCoded: "Reactive" })).toBe("Reactive");
  });

  it("formats the snapshotted reference range", () => {
    expect(referenceText({ refLow: 3.9, refHigh: 5.5, refText: null })).toBe("3.9–5.5");
    expect(referenceText({ refLow: null, refHigh: 5.6, refText: null })).toBe("≤ 5.6");
    expect(referenceText({ refLow: 40, refHigh: null, refText: null })).toBe("≥ 40");
    expect(referenceText({ refLow: null, refHigh: null, refText: "Nonreactive" })).toBe("Nonreactive");
    expect(referenceText({ refLow: null, refHigh: null, refText: null })).toBe("");
  });
});

describe("parseResultInput", () => {
  it("accepts plain decimal numbers only", () => {
    expect(parseResultInput("numeric", " 7.2 ")).toEqual({ ok: true, value: { valueNumeric: 7.2 } });
    expect(parseResultInput("numeric", "7,2").ok).toBe(false);
    expect(parseResultInput("numeric", ">500").ok).toBe(false);
    expect(parseResultInput("numeric", "").ok).toBe(false);
  });
  it("passes coded and text values through", () => {
    expect(parseResultInput("coded", "Reactive")).toEqual({ ok: true, value: { valueCoded: "Reactive" } });
    expect(parseResultInput("text", "Gram-positive cocci")).toEqual({ ok: true, value: { valueText: "Gram-positive cocci" } });
  });
});

it("groups items to collect by specimen type", () => {
  const items = [{ specimenTypeId: "serum" }, { specimenTypeId: "edta" }, { specimenTypeId: "serum" }] as never[];
  expect([...bySpecimenType(items).entries()].map(([k, v]) => [k, (v as unknown[]).length])).toEqual([
    ["serum", 2],
    ["edta", 1],
  ]);
});

describe("trends", () => {
  const point = (collectedAt: string, value: number | null, unit = "mmol/L") => ({
    resultId: collectedAt,
    collectedAt,
    releasedAt: collectedAt,
    testCode: "fbs",
    valueNumeric: value,
    valueText: null,
    valueCoded: null,
    unit,
    flag: null,
    critical: false,
    refLow: 3.9,
    refHigh: 5.5,
    refText: null,
    corrected: false,
  });
  const trend: LabTrend = { analyte: "loinc:1558-6", testName: "FBS", unit: "mmol/L", points: [point("2026-01-01", 6.1), point("2026-06-01", null)] };

  it("keeps numeric points only", () => {
    expect(trendPoints(trend)).toEqual([{ date: "2026-01-01", value: 6.1 }]);
  });
  it("notices mixed units", () => {
    expect(mixedUnits(trend)).toBe(false);
    expect(mixedUnits({ ...trend, points: [point("2026-01-01", 6.1), point("2026-02-01", 110, "mg/dL")] })).toBe(true);
  });
});

it("groups a patient's results per test, latest first", () => {
  const r = (testId: string, collectedAt: string) => ({ testId, testName: testId, collectedAt, releasedAt: collectedAt }) as PatientLabResult;
  const grouped = groupResultsByTest([r("fbs", "2026-01-01"), r("k", "2026-03-01"), r("fbs", "2026-05-01")]);
  expect(grouped.map((g) => [g.testId, g.count, g.latest.collectedAt])).toEqual([
    ["fbs", 2, "2026-05-01"],
    ["k", 1, "2026-03-01"],
  ]);
});

it("computes overdue minutes against the turnaround time", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  expect(overdueMinutes({ turnaroundMinutes: 60, status: "received" }, "2026-09-27T10:00:00Z", now)).toBe(60);
  expect(overdueMinutes({ turnaroundMinutes: 180, status: "received" }, "2026-09-27T10:00:00Z", now)).toBeNull();
  expect(overdueMinutes({ turnaroundMinutes: 60, status: "released" }, "2026-09-27T10:00:00Z", now)).toBeNull();
});

describe("send-outs", () => {
  const row = (referenceLaboratoryId: string, name: string, id: string) => ({ id, referenceLaboratoryId, referenceLaboratoryName: name }) as LabSendOut;

  it("formats turnaround durations", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(6 * 60 + 10)).toBe("6 h");
    expect(formatDuration(48 * 60)).toBe("2 d");
    expect(formatDuration(51 * 60)).toBe("2 d 3 h");
  });

  it("marks overdue send-outs critical and answered ones as done", () => {
    expect(sendOutTone({ status: "dispatched", overdue: true })).toBe("critical");
    expect(sendOutTone({ status: "dispatched", overdue: false })).toBe("info");
    expect(sendOutTone({ status: "prepared", overdue: false })).toBe("warning");
    expect(sendOutTone({ status: "results_received", overdue: false })).toBe("success");
    expect(sendOutTone({ status: "cancelled", overdue: false })).toBe("neutral");
  });

  it("groups prepared send-outs by reference laboratory (one manifest each)", () => {
    const groups = byReferenceLaboratory([row("b", "Beta Lab", "1"), row("a", "Alpha Lab", "2"), row("b", "Beta Lab", "3")]);
    expect(groups.map((g) => [g.name, g.rows.map((r) => r.id)])).toEqual([
      ["Alpha Lab", ["2"]],
      ["Beta Lab", ["1", "3"]],
    ]);
  });
});
