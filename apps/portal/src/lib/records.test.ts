import { describe, expect, it } from "vitest";
import type { PortalPrescription, PortalResult } from "./api/types";
import { howToTake, latestPerTest, resultMeaning, usualRange, visitTime } from "./records";

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

it("keeps the latest result per test", () => {
  const r = (testId: string, collectedAt: string) => ({ testId, collectedAt, releasedAt: collectedAt }) as PortalResult;
  expect(
    latestPerTest([r("a", "2026-01-01"), r("b", "2026-03-01"), r("a", "2026-05-01")]).map((g) => [g.latest.testId, g.count, g.latest.collectedAt]),
  ).toEqual([
    ["a", 2, "2026-05-01"],
    ["b", 1, "2026-03-01"],
  ]);
});

it("summarizes how to take a medicine", () => {
  const base = {
    doseAmount: 1,
    doseUnit: "tablet",
    frequency: "twice_daily",
    frequencyText: null,
    asNeededReason: null,
    durationValue: 7,
    durationUnit: "days",
  } as const;
  expect(howToTake(base as unknown as PortalPrescription["items"][number])).toBe("1 tablet twice a day for 7 days");
  expect(
    howToTake({
      ...base,
      doseAmount: null,
      frequency: "as_needed",
      asNeededReason: "fever",
      durationValue: null,
    } as unknown as PortalPrescription["items"][number]),
  ).toBe("when needed for fever");
});

it("shows visit times in the clinic's time zone", () => {
  expect(visitTime({ startsAt: "2026-09-30T01:30:00Z", timeZone: "Asia/Manila" })).toBe("Wed, Sep 30, 2026, 9:30 AM");
});
