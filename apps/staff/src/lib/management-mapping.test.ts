import { describe, expect, it } from "vitest";
import { comparison, countLabel, patientRateLabel, percentOf, previousLabel, rangePresets, verdict } from "./management-mapping";

describe("rangePresets", () => {
  it("offers ranges ending today, and last month across a year boundary", () => {
    const presets = Object.fromEntries(rangePresets("2026-01-15").map((p) => [p.key, [p.from, p.to]]));
    expect(presets).toEqual({
      today: ["2026-01-15", "2026-01-15"],
      "7d": ["2026-01-09", "2026-01-15"],
      "30d": ["2025-12-17", "2026-01-15"],
      month: ["2026-01-01", "2026-01-15"],
      "last-month": ["2025-12-01", "2025-12-31"],
    });
  });
});

describe("percentOf", () => {
  it("formats rates for people", () => {
    expect(percentOf(0.125)).toBe("12.5%");
    expect(percentOf(1)).toBe("100%");
    expect(percentOf(null)).toBe("—");
  });
});

describe("comparison", () => {
  it("describes the change against the previous period in words", () => {
    expect(comparison(112, 100, "count")).toBe("▲ 12%");
    expect(comparison(90, 100, "count")).toBe("▼ 10%");
    expect(comparison(5, 0, "count")).toBe("▲ from none");
    expect(comparison(0, 0, "count")).toBe("no change");
    expect(comparison(0.15, 0.125, "rate")).toBe("▲ 2.5 pts");
    expect(comparison(25, 40, "minutes")).toBe("▼ 15 min");
    expect(comparison(null, 40, "minutes")).toBe("no comparison");
    expect(comparison("<5", 6, "count")).toBe("no comparison");
  });

  it("names the previous period", () => {
    expect(previousLabel("2026-09-01", "2026-09-30")).toBe("the previous 30 days");
    expect(previousLabel("2026-09-29", "2026-09-29")).toBe("the previous day");
  });
});

describe("verdict", () => {
  it("says whether a change is better or worse by the figure's direction", () => {
    const change = (assessment: "better" | "worse" | "unchanged" | "neutral") => ({
      unit: "rate" as const,
      better: "down" as const,
      change: { absolute: 0.05, relative: null, direction: "up" as const, assessment },
    });
    expect(verdict(change("worse"))).toEqual({ text: "worse", tone: "worse" });
    expect(verdict(change("better"))).toEqual({ text: "better", tone: "better" });
    expect(verdict(change("neutral"))).toEqual({ text: "neither better nor worse", tone: "neutral" });
    expect(verdict(change("unchanged"))).toBeNull();
    expect(verdict({ unit: "patients", better: "up", change: null })).toBeNull();
    expect(verdict(undefined)).toBeNull();
  });
});

describe("suppressed counts and rates", () => {
  it("keeps <5 and formats numbers", () => {
    expect(countLabel("<5")).toBe("<5");
    expect(countLabel(1234)).toBe("1,234");
    expect(countLabel(0)).toBe("0");
    expect(patientRateLabel(null, true)).toBe("withheld (<5)");
    expect(patientRateLabel(0.875, false)).toBe("87.5%");
  });
});
