import { describe, expect, it } from "vitest";
import { comparison, percentOf, previousLabel, rangePresets } from "./management-mapping";

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
  });

  it("names the previous period", () => {
    expect(previousLabel("2026-09-01", "2026-09-30")).toBe("the previous 30 days");
    expect(previousLabel("2026-09-29", "2026-09-29")).toBe("the previous day");
  });
});
