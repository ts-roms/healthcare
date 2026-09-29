import { describe, expect, it } from "vitest";
import type { ManagementFigureComparison } from "./api/types";
import { changeLabel, countLabel, csvApiQuery, csvHref, patientRateLabel, percentOf, rangePresets } from "./management-mapping";

describe("suppressed counts and rates", () => {
  it("keeps <5 and formats numbers", () => {
    expect(countLabel("<5")).toBe("<5");
    expect(countLabel(1234)).toBe("1,234");
    expect(countLabel(0)).toBe("0");
    expect(patientRateLabel(null, true)).toBe("withheld (<5)");
    expect(patientRateLabel(0.875, false)).toBe("87.5%");
  });
});

describe("changeLabel", () => {
  const figure = (unit: ManagementFigureComparison["unit"], change: ManagementFigureComparison["change"]): ManagementFigureComparison => ({
    key: "k",
    unit,
    better: "down",
    current: 0,
    previous: 0,
    change,
  });

  it("reads a rate's change in points, with arrow and verdict", () => {
    expect(changeLabel(figure("rate", { absolute: 0.05, relative: null, direction: "up", assessment: "worse" }))).toEqual({
      arrow: "↑",
      text: "+5.0 points vs previous period (worse)",
      tone: "worse",
    });
  });

  it("reads counts, minutes and pesos with the percentage", () => {
    expect(changeLabel(figure("count", { absolute: 2, relative: 0.3333, direction: "up", assessment: "better" }))?.text).toBe(
      "+2 (+33.3%) vs previous period (better)",
    );
    expect(changeLabel(figure("minutes", { absolute: -10, relative: -0.25, direction: "down", assessment: "better" }))).toEqual({
      arrow: "↓",
      text: "−10 min (−25%) vs previous period (better)",
      tone: "better",
    });
    expect(changeLabel(figure("centavos", { absolute: 50_000, relative: null, direction: "up", assessment: "better" }))?.text).toBe(
      "+₱500.00 vs previous period (better)",
    );
    expect(changeLabel(figure("count", { absolute: 0, relative: 0, direction: "flat", assessment: "unchanged" }))).toEqual({
      arrow: "→",
      text: "No change vs previous period",
      tone: "neutral",
    });
  });

  it("says nothing when there is nothing to compare", () => {
    expect(changeLabel(figure("patients", null))).toBeNull();
  });
});

describe("CSV links", () => {
  it("builds the download link and the API query, refusing unknown sections", () => {
    expect(csvHref("summary", { from: "2026-09-01", to: "2026-09-30", facilityId: "f" })).toBe(
      "/management/export?section=summary&from=2026-09-01&to=2026-09-30&facilityId=f",
    );
    expect(csvApiQuery(new URLSearchParams("section=services&from=2026-09-01&to=bad&facilityId=x"))).toEqual({ section: "services", from: "2026-09-01" });
    expect(csvApiQuery(new URLSearchParams("section=patients-list"))).toBeNull();
    expect(csvApiQuery(new URLSearchParams(""))).toBeNull();
  });
});

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
