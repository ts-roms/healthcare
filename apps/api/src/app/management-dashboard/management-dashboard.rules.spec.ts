import {
  compareFigure,
  coversAll,
  dailySeries,
  daysBetween,
  isSmallCell,
  patientRate,
  previousRange,
  rate,
  reportableFacilities,
  resolveRange,
  retentionFigures,
  shiftDate,
  shiftMonths,
  SMALL_CELL_THRESHOLD,
  suppressCount,
} from "./management-dashboard.rules";

describe("management dashboard rules", () => {
  it("moves dates across months and years", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  });

  it("defaults to the last 30 days ending today, and refuses unusable ranges", () => {
    expect(resolveRange({}, "2026-09-29")).toEqual({ from: "2026-08-31", to: "2026-09-29" });
    expect(resolveRange({ to: "2026-09-10" }, "2026-09-29")).toEqual({ from: "2026-08-12", to: "2026-09-10" });
    expect(resolveRange({ from: "2026-09-01" }, "2026-09-29")).toEqual({ from: "2026-09-01", to: "2026-09-29" });
    expect(resolveRange({ from: "2026-09-10", to: "2026-09-01" }, "2026-09-29")).toEqual({ error: "The range starts after it ends" });
    expect(resolveRange({ from: "2025-01-01", to: "2026-09-29" }, "2026-09-29")).toEqual({ error: "Choose at most 366 days" });
    expect(resolveRange({ from: "2025-09-29", to: "2026-09-29" }, "2026-09-29")).toEqual({ from: "2025-09-29", to: "2026-09-29" });
  });

  it("limits facility-scoped grants to their facilities", () => {
    expect(reportableFacilities([{ facilityId: null }], ["a", "b"])).toEqual({ all: true, facilityIds: ["a", "b"] });
    expect(reportableFacilities([{ facilityId: "b" }, { facilityId: "c" }], ["a", "b"])).toEqual({ all: false, facilityIds: ["b"] });
    expect(reportableFacilities([], ["a"])).toEqual({ all: false, facilityIds: [] });
  });

  it("fills daily series with zeros", () => {
    expect(
      dailySeries(
        ["2026-09-01", "2026-09-02"],
        [
          { key: "encounters", rows: [{ date: "2026-09-02", encounters: 4 }], field: "encounters" },
          { key: "collected", rows: [{ date: "2026-09-01", collected: 1500 }], field: "collected" },
        ],
      ),
    ).toEqual([
      { date: "2026-09-01", encounters: 0, collected: 1500 },
      { date: "2026-09-02", encounters: 4, collected: 0 },
    ]);
  });

  it("computes rates to three decimals", () => {
    expect(rate(1, 3)).toBe(0.333);
    expect(rate(0, 0)).toBeNull();
    // Utilization may exceed 100%.
    expect(rate(300, 240)).toBe(1.25);
  });

  describe("small-cell suppression", () => {
    it("shows patient counts of 1–4 as <5, and 0 and 5+ exactly", () => {
      expect(SMALL_CELL_THRESHOLD).toBe(5);
      expect([0, 1, 2, 3, 4, 5, 6, 120].map(suppressCount)).toEqual([0, "<5", "<5", "<5", "<5", 5, 6, 120]);
      expect(isSmallCell(0)).toBe(false);
      expect(isSmallCell(4)).toBe(true);
    });

    it("withholds a rate whose numerator or denominator is a small cell", () => {
      expect(patientRate(3, 10)).toEqual({ rate: null, suppressed: true });
      expect(patientRate(6, 4)).toEqual({ rate: null, suppressed: true });
      expect(patientRate(5, 10)).toEqual({ rate: 0.5, suppressed: false });
      // Zero is not a small cell: 0 of 10 is disclosed; 0 of 0 has no rate.
      expect(patientRate(0, 10)).toEqual({ rate: 0, suppressed: false });
      expect(patientRate(0, 0)).toEqual({ rate: null, suppressed: false });
    });
  });

  describe("previous-period comparison", () => {
    it("takes the equal period immediately before", () => {
      expect(previousRange({ from: "2026-09-01", to: "2026-09-30" })).toEqual({ from: "2026-08-02", to: "2026-08-31" });
      expect(previousRange({ from: "2026-03-01", to: "2026-03-01" })).toEqual({ from: "2026-02-28", to: "2026-02-28" });
    });

    it("reads the change against the figure's direction of improvement", () => {
      expect(compareFigure("noShowRate", "rate", "down", 0.25, 0.2)).toEqual({
        key: "noShowRate",
        unit: "rate",
        better: "down",
        current: 0.25,
        previous: 0.2,
        change: { absolute: 0.05, relative: null, direction: "up", assessment: "worse" },
      });
      expect(compareFigure("consultations", "count", "up", 12, 8).change).toEqual({ absolute: 4, relative: 0.5, direction: "up", assessment: "better" });
      expect(compareFigure("averageWait", "minutes", "down", 20, 30).change).toMatchObject({ direction: "down", assessment: "better", relative: -0.3333 });
      expect(compareFigure("consultations", "count", "up", 5, 5).change).toMatchObject({ direction: "flat", assessment: "unchanged" });
      expect(compareFigure("volume", "count", "neither", 5, 3).change).toMatchObject({ assessment: "neutral" });
      // From zero there is no relative change.
      expect(compareFigure("consultations", "count", "up", 3, 0).change).toMatchObject({ absolute: 3, relative: null });
    });

    it("has no change when either value is unknown or suppressed", () => {
      expect(compareFigure("patientsSeen", "patients", "up", "<5", 10).change).toBeNull();
      expect(compareFigure("patientsSeen", "patients", "up", 10, "<5").change).toBeNull();
      expect(compareFigure("noShowRate", "rate", "down", null, 0.2).change).toBeNull();
    });
  });

  describe("retention", () => {
    it("moves dates by months, clamped to the month's end", () => {
      expect(shiftMonths("2026-09-29", -12)).toBe("2025-09-29");
      expect(shiftMonths("2026-03-31", -1)).toBe("2026-02-28");
      expect(shiftMonths("2024-02-29", -12)).toBe("2023-02-28");
    });

    it("suppresses small cohorts and the rates built on them", () => {
      expect(retentionFigures({ seen: 20, retained: 12, returnCohort: 10, returned: 5 })).toEqual({
        lookbackMonths: 12,
        returnWindowDays: 90,
        seen: 20,
        retained: 12,
        retentionRate: 0.6,
        retentionRateSuppressed: false,
        returnCohort: 10,
        returned: 5,
        returnRate: 0.5,
        returnRateSuppressed: false,
      });
      expect(retentionFigures({ seen: 7, retained: 6, returnCohort: 3, returned: 0 })).toMatchObject({
        seen: 7,
        retained: 6,
        retentionRate: 0.857,
        returnCohort: "<5",
        returned: 0,
        returnRate: null,
        returnRateSuppressed: true,
      });
      expect(retentionFigures({ seen: 0, retained: 0, returnCohort: 0, returned: 0 })).toMatchObject({ retentionRate: null, retentionRateSuppressed: false });
    });
  });

  it("shows revenue only when the billing permission covers every facility in scope", () => {
    expect(coversAll([{ facilityId: null }], ["a", "b"])).toBe(true);
    expect(coversAll([{ facilityId: "a" }], ["a", "b"])).toBe(false);
    expect(coversAll([{ facilityId: "a" }, { facilityId: "b" }], ["a", "b"])).toBe(true);
    expect(coversAll([{ facilityId: null, departmentId: "d" }], ["a"])).toBe(false);
    expect(coversAll([], ["a"])).toBe(false);
  });
});
