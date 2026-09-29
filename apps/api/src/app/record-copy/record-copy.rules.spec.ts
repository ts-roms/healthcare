import { dateInPeriod, flagLabel, instantInPeriod, periodLabel, referenceRange, resultValue, spanOverlapsPeriod } from "./record-copy.rules";

describe("record copy rules", () => {
  const period = { from: "2026-03-01", to: "2026-03-31" };

  it("places an instant in the period by its local date", () => {
    // 1 Mar 2026, 07:30 in Manila is still 28 Feb in UTC.
    expect(instantInPeriod("2026-02-28T23:30:00Z", period, "Asia/Manila")).toBe(true);
    expect(instantInPeriod("2026-02-28T23:30:00Z", period, "UTC")).toBe(false);
    expect(instantInPeriod("2026-03-31T16:30:00Z", period, "Asia/Manila")).toBe(false);
    expect(instantInPeriod(null, period, "Asia/Manila")).toBe(false);
    expect(instantInPeriod("2020-01-01T00:00:00Z", {}, "Asia/Manila")).toBe(true);
  });

  it("includes both ends of the period and leaves open ends open", () => {
    expect(dateInPeriod("2026-03-01", period)).toBe(true);
    expect(dateInPeriod("2026-03-31", period)).toBe(true);
    expect(dateInPeriod("2026-04-01", period)).toBe(false);
    expect(dateInPeriod("2030-01-01", { from: "2026-03-01" })).toBe(true);
    expect(dateInPeriod("2020-01-01", { to: "2026-03-01" })).toBe(true);
  });

  it("keeps a span that overlaps the period, including one still running", () => {
    expect(spanOverlapsPeriod("2026-01-01", null, period)).toBe(true);
    expect(spanOverlapsPeriod("2026-01-01", "2026-02-28", period)).toBe(false);
    expect(spanOverlapsPeriod("2026-04-01", null, period)).toBe(false);
    expect(spanOverlapsPeriod("2026-03-31", "2026-06-01", period)).toBe(true);
  });

  it("describes the period", () => {
    const f = (d: string) => d;
    expect(periodLabel({}, f)).toBe("All records");
    expect(periodLabel({ from: "2026-03-01" }, f)).toBe("From 2026-03-01");
    expect(periodLabel({ to: "2026-03-31" }, f)).toBe("Up to 2026-03-31");
    expect(periodLabel(period, f)).toBe("2026-03-01 to 2026-03-31");
  });

  it("prints results with their unit, range and flag in words", () => {
    expect(resultValue({ valueNumeric: 6.1, valueText: null, valueCoded: null, unit: "%" })).toBe("6.1 %");
    expect(resultValue({ valueNumeric: null, valueText: "Negative", valueCoded: null, unit: null })).toBe("Negative");
    expect(referenceRange({ refLow: 4, refHigh: 5.6, refText: null })).toBe("4 to 5.6");
    expect(referenceRange({ refLow: null, refHigh: 200, refText: null })).toBe("< 200");
    expect(referenceRange({ refLow: null, refHigh: null, refText: "Negative" })).toBe("Negative");
    expect(flagLabel("high")).toBe("High");
    expect(flagLabel("normal")).toBe("");
    expect(flagLabel(null)).toBe("");
  });
});
