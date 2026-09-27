import { dayOfWeek, intervalsOverlap, localDate, localDayBounds, localTime, zonedToUtc } from "./zoned-time";

describe("zoned time", () => {
  it("converts Philippine wall-clock time to UTC (UTC+8, no DST)", () => {
    expect(zonedToUtc("2026-10-05", "09:30", "Asia/Manila").toISOString()).toBe("2026-10-05T01:30:00.000Z");
    expect(zonedToUtc("2026-10-05", "06:00", "Asia/Manila").toISOString()).toBe("2026-10-04T22:00:00.000Z");
  });

  it("handles zones with daylight saving", () => {
    expect(zonedToUtc("2026-07-01", "09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedToUtc("2026-01-15", "09:00", "America/New_York").toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("reads local date and time of an instant", () => {
    const instant = new Date("2026-10-04T22:00:00Z");
    expect(localDate(instant, "Asia/Manila")).toBe("2026-10-05");
    expect(localTime(instant, "Asia/Manila")).toBe("06:00");
  });

  it("computes day of week and local day bounds", () => {
    expect(dayOfWeek("2026-10-05")).toBe(1); // Monday
    const bounds = localDayBounds("2026-10-05", "Asia/Manila");
    expect(bounds.start.toISOString()).toBe("2026-10-04T16:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-10-05T16:00:00.000Z");
  });

  it("detects half-open interval overlap", () => {
    const a = { start: new Date("2026-01-01T01:00:00Z"), end: new Date("2026-01-01T02:00:00Z") };
    expect(intervalsOverlap(a, { start: new Date("2026-01-01T02:00:00Z"), end: new Date("2026-01-01T03:00:00Z") })).toBe(false);
    expect(intervalsOverlap(a, { start: new Date("2026-01-01T01:59:00Z"), end: new Date("2026-01-01T03:00:00Z") })).toBe(true);
  });
});
