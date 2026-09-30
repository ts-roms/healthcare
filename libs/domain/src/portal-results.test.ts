import { describe, expect, it } from "vitest";
import { latestPerTest, type PortalResult, resultDate, resultMeaning, resultValue, usualRange } from "./portal-results";

describe("resultMeaning", () => {
  it("describes the position against the range without interpreting it", () => {
    expect(resultMeaning({ flag: "high" })).toEqual({ tone: "attention", text: "Higher than the usual range" });
    expect(resultMeaning({ flag: "normal" }).tone).toBe("normal");
    expect(resultMeaning({ flag: "critical_high" }).text).toMatch(/care team has been told/);
    expect(resultMeaning({ flag: null }).tone).toBe("neutral");
  });
});

describe("usualRange", () => {
  it("reads naturally", () => {
    expect(usualRange({ refLow: 3.9, refHigh: 5.5, refText: null, unit: "mmol/L" })).toBe("Usual range: 3.9 to 5.5 mmol/L");
    expect(usualRange({ refLow: null, refHigh: 5.6, refText: null, unit: "%" })).toBe("Usual range: up to 5.6 %");
    expect(usualRange({ refLow: null, refHigh: null, refText: "Nonreactive", unit: null })).toBe("Expected: Nonreactive");
    expect(usualRange({ refLow: null, refHigh: null, refText: null, unit: null })).toBeNull();
  });
});

it("shows the value of each result type", () => {
  expect(resultValue({ resultType: "numeric", valueNumeric: 5.2, valueText: null, valueCoded: null })).toBe("5.2");
  expect(resultValue({ resultType: "numeric", valueNumeric: null, valueText: null, valueCoded: null })).toBe("—");
  expect(resultValue({ resultType: "coded", valueNumeric: null, valueText: null, valueCoded: "Nonreactive" })).toBe("Nonreactive");
});

it("keeps the latest result per test", () => {
  const r = (testId: string, collectedAt: string) => ({ testId, collectedAt, releasedAt: collectedAt }) as PortalResult;
  expect(
    latestPerTest([r("a", "2026-01-01"), r("b", "2026-03-01"), r("a", "2026-05-01")]).map((g) => [g.latest.testId, g.count, g.latest.collectedAt]),
  ).toEqual([
    ["a", 2, "2026-05-01"],
    ["b", 1, "2026-03-01"],
  ]);
});

it("dates results in the clinic's time zone", () => {
  expect(resultDate("2026-09-29T17:30:00Z", "Asia/Manila")).toBe("Sep 30, 2026"); // 1:30 AM on the 30th in Manila
  expect(resultDate(null, "Asia/Manila")).toBe("");
});
