import { duePeriods, isDue, isoWeekday, periodEndingBefore, reportFileName } from "./management-report.rules";

describe("scheduled report periods", () => {
  it("knows the weekday", () => {
    expect(isoWeekday("2026-10-05")).toBe(1); // Monday
    expect(isoWeekday("2026-10-04")).toBe(7); // Sunday
  });

  it("reports the previous Monday to Sunday every day of the week", () => {
    // Monday 5 October 2026 → the week of 28 September to 4 October.
    expect(periodEndingBefore("weekly", "2026-10-05")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    // Any later day that week reports the same completed week.
    expect(periodEndingBefore("weekly", "2026-10-08")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(periodEndingBefore("weekly", "2026-10-11")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    // Monday 12 October → the next week.
    expect(periodEndingBefore("weekly", "2026-10-12")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
  });

  it("reports the previous calendar month from its first day, across year ends and short months", () => {
    expect(periodEndingBefore("monthly", "2026-10-01")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodEndingBefore("monthly", "2026-10-20")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodEndingBefore("monthly", "2027-01-03")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(periodEndingBefore("monthly", "2028-03-01")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("is due only once the period has ended", () => {
    expect(isDue({ from: "2026-09-28", to: "2026-10-04" }, "2026-10-05")).toBe(true);
    expect(isDue({ from: "2026-09-28", to: "2026-10-04" }, "2026-10-04")).toBe(false);
  });

  it("catches up at most a few missed periods, oldest first, skipping those already produced", () => {
    expect(duePeriods("weekly", "2026-10-12", new Set())).toEqual([
      { from: "2026-09-21", to: "2026-09-27" },
      { from: "2026-09-28", to: "2026-10-04" },
      { from: "2026-10-05", to: "2026-10-11" },
    ]);
    expect(duePeriods("weekly", "2026-10-12", new Set(["2026-09-28", "2026-09-21"]))).toEqual([{ from: "2026-10-05", to: "2026-10-11" }]);
    expect(duePeriods("monthly", "2026-10-01", new Set(["2026-09-01"]), 1)).toEqual([]);
  });

  it("names files like the screen's export", () => {
    expect(reportFileName("summary", { from: "2026-09-01", to: "2026-09-30" })).toBe("management-summary-2026-09-01-to-2026-09-30.csv");
  });
});
