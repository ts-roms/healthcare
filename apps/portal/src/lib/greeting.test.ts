import { describe, expect, it } from "vitest";
import { formatCalendarDate, greeting } from "./greeting";

describe("greeting", () => {
  it("uses the hour in Manila, not the server's time zone", () => {
    expect(greeting(new Date("2026-09-27T00:30:00Z"))).toBe("Good morning"); // 08:30 PHT
    expect(greeting(new Date("2026-09-27T05:00:00Z"))).toBe("Good afternoon"); // 13:00 PHT
    expect(greeting(new Date("2026-09-27T12:00:00Z"))).toBe("Good evening"); // 20:00 PHT
    expect(greeting(new Date("2026-09-26T19:00:00Z"))).toBe("Good evening"); // 03:00 PHT
  });
});

describe("formatCalendarDate", () => {
  it("keeps the calendar day", () => {
    expect(formatCalendarDate("1980-05-14")).toBe("May 14, 1980");
    expect(formatCalendarDate("2000-01-01")).toBe("January 1, 2000");
  });
  it("returns unexpected input unchanged", () => {
    expect(formatCalendarDate("unknown")).toBe("unknown");
  });
});
