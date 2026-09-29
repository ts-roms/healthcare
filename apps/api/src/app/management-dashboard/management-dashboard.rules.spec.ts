import { dailySeries, daysBetween, rate, reportableFacilities, resolveRange, shiftDate } from "./management-dashboard.rules";

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
  });
});
