import { comparisonRange, formatRange, periodLabel, readPeriod, resolvePeriod, upToToday } from "./period";

// A Sunday (2026-11-22): the week began on Monday 2026-11-16.
const TODAY = "2026-11-22";
const read = (text: string) => readPeriod(text, TODAY);

describe("reading a period", () => {
  it.each([
    ["no-shows today", "today"],
    ["collections yesterday", "yesterday"],
    ["appointments tomorrow", "tomorrow"],
    ["appointments bukas", "tomorrow"],
    ["patients seen this week", "this-week"],
    ["no-shows last week", "last-week"],
    ["revenue the previous month", "last-month"],
    ["revenue this month", "this-month"],
    ["revenue this year", "this-year"],
    ["revenue year to date", "this-year"],
    ["patients seen in the last 7 days", "last-7-days"],
    ["patients seen past 2 weeks", "last-14-days"],
    ["no-shows last 3 months", "last-92-days"],
    ["no-shows in october", "2026-10"],
    ["no-shows in december", "2025-12"],
    ["no-shows october 2025", "2025-10"],
    ["revenue in may", "2026-05"],
    ["collections on nov 15", "2026-11-15"],
    ["collections 15 november", "2026-11-15"],
    ["collections 2026-11-03", "2026-11-03"],
    ["patients seen from 1 nov to 15 nov", "2026-11-01..2026-11-15"],
    ["patients seen between oct 1 and oct 15", "2026-10-01..2026-10-15"],
    ["patients seen nov 1 to 15", "2026-11-01..2026-11-15"],
    ["patients seen 1-15 nov", "2026-11-01..2026-11-15"],
    ["revenue march to may", "2026-03-01..2026-05-31"],
  ])("%s → %s", (text, key) => {
    expect(read(text).period).toBe(key);
  });

  it("leaves a sentence without a time alone, and does not take the verb 'may' for the month", () => {
    expect(read("what is running low").period).toBeUndefined();
    expect(read("may i see the no-shows").period).toBeUndefined();
    expect(read("may i see the no-shows in october").period).toBe("2026-10");
  });

  it("reads a comparison apart from the period, and keeps the question's words after it", () => {
    expect(read("revenue this month vs last month")).toMatchObject({ period: "this-month", compare: "previous", rest: "revenue" });
    expect(read("no-shows last week compared to the same week last year")).toMatchObject({ period: "last-week", compare: "last-year" });
    expect(read("this month versus last month revenue")).toMatchObject({ period: "this-month", compare: "previous", rest: "revenue" });
  });

  it("reads 'now' and the whole organization", () => {
    expect(read("who is waiting right now")).toMatchObject({ now: true, period: undefined, rest: "who is waiting" });
    expect(read("patients seen last week in all facilities")).toMatchObject({ allFacilities: true, period: "last-week" });
    expect(read("patients seen last week")).toMatchObject({ allFacilities: false, now: false });
  });
});

describe("resolving a period", () => {
  it.each([
    ["today", "2026-11-22", "2026-11-22"],
    ["yesterday", "2026-11-21", "2026-11-21"],
    ["tomorrow", "2026-11-23", "2026-11-23"],
    ["this-week", "2026-11-16", "2026-11-22"],
    ["last-week", "2026-11-09", "2026-11-15"],
    ["this-month", "2026-11-01", "2026-11-22"],
    ["last-month", "2026-10-01", "2026-10-31"],
    ["this-year", "2026-01-01", "2026-11-22"],
    ["last-year", "2025-01-01", "2025-12-31"],
    ["last-7-days", "2026-11-16", "2026-11-22"],
    ["2026-02", "2026-02-01", "2026-02-28"],
    ["2026-11-03", "2026-11-03", "2026-11-03"],
    ["2026-11-01..2026-11-15", "2026-11-01", "2026-11-15"],
  ])("%s → %s to %s", (key, from, to) => {
    expect(resolvePeriod(key, TODAY)).toEqual({ from, to });
  });

  it("refuses what is not a period, runs backwards or is longer than the dashboard reads", () => {
    for (const key of ["next-week", "2026-13", "2026-02-30", "2026-11-15..2026-11-01", "last-400-days", "2024-01-01..2026-01-01", "last-0-days"]) {
      expect(resolvePeriod(key, TODAY)).toBeNull();
    }
  });

  it("ends a period at today for figures that only exist up to today", () => {
    expect(upToToday({ from: "2026-11-01", to: "2026-11-30" }, TODAY)).toEqual({ from: "2026-11-01", to: "2026-11-22" });
    expect(upToToday({ from: "2026-12-01", to: "2026-12-31" }, TODAY)).toBeNull();
  });

  it("compares like for like: a month so far with the same days of the month before, a week with the week before", () => {
    const range = (key: string) => resolvePeriod(key, TODAY)!;
    expect(comparisonRange("this-month", range("this-month"), "previous")).toEqual({ from: "2026-10-01", to: "2026-10-22" });
    expect(comparisonRange("last-month", range("last-month"), "previous")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(comparisonRange("this-week", range("this-week"), "previous")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(comparisonRange("last-7-days", range("last-7-days"), "previous")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(comparisonRange("this-year", range("this-year"), "previous")).toEqual({ from: "2025-01-01", to: "2025-11-22" });
    expect(comparisonRange("this-month", range("this-month"), "last-year")).toEqual({ from: "2025-11-01", to: "2025-11-22" });
    // March 1–31 against February 1–28: a whole month against the whole month before.
    expect(comparisonRange("2026-03", { from: "2026-03-01", to: "2026-03-31" }, "previous")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("puts a period in words", () => {
    expect(periodLabel("last-week")).toBe("Last week");
    expect(periodLabel("last-30-days")).toBe("Last 30 days");
    expect(periodLabel("2026-10")).toBe("October 2026");
    expect(periodLabel("2026-11-15")).toBe("15 November 2026");
    expect(periodLabel("2026-11-01..2026-11-15")).toBe("1–15 November 2026");
    expect(formatRange("2026-10-01", "2026-11-15")).toBe("1 October – 15 November 2026");
    expect(formatRange("2025-12-01", "2026-01-15")).toBe("1 December 2025 – 15 January 2026");
  });
});
