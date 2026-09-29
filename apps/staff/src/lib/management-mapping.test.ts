import { describe, expect, it } from "vitest";
import { percentOf, rangePresets } from "./management-mapping";

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
