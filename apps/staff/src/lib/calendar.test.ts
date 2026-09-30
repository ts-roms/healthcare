import { describe, expect, it } from "vitest";
import { daysCovered, entriesByDay, eventInstants, stepDate, toEntries, viewDays, viewRange } from "./calendar";
import type { CalendarEventItem } from "./api/types";

const MANILA = "Asia/Manila";

describe("calendar views", () => {
  it("shows whole weeks around a month", () => {
    const days = viewDays("month", "2026-10-15");
    expect(days[0]).toBe("2026-09-27");
    expect(days.at(-1)).toBe("2026-10-31");
    expect(days.length % 7).toBe(0);
  });
  it("shows seven days from Sunday for a week, and one for a day", () => {
    expect(viewDays("week", "2026-09-30")).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(viewDays("day", "2026-09-30")).toEqual(["2026-09-30"]);
  });
  it("steps by view and covers the facility's local days as instants", () => {
    expect(stepDate("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(stepDate("week", "2026-09-30", -1)).toBe("2026-09-23");
    const { from, to } = viewRange("day", "2026-09-30", MANILA);
    expect(from).toBe("2026-09-29T16:00:00.000Z");
    expect(to).toBe("2026-09-30T16:00:00.000Z");
  });
});

describe("calendar entries", () => {
  const event = (over: Partial<CalendarEventItem>): CalendarEventItem => ({
    id: "e1",
    facilityId: "f",
    title: "Staff meeting",
    kind: "meeting",
    startsAt: "2026-09-30T01:00:00.000Z",
    endsAt: "2026-09-30T02:00:00.000Z",
    allDay: false,
    location: null,
    description: null,
    visibility: "facility",
    status: "scheduled",
    organizerUserId: "u",
    organizerName: "Dr. Cruz",
    cancelReason: null,
    version: 1,
    attendees: [],
    editable: true,
    ...over,
  });

  it("counts an overnight or all-day event on each local day it covers", () => {
    expect(daysCovered("2026-09-30T14:00:00.000Z", "2026-10-01T02:00:00.000Z", MANILA)).toEqual(["2026-09-30", "2026-10-01"]);
    // A whole local day ends at the next local midnight, which is not part of the event.
    expect(daysCovered("2026-09-29T16:00:00.000Z", "2026-09-30T16:00:00.000Z", MANILA)).toEqual(["2026-09-30"]);
  });
  it("orders all-day entries first, then by time, and groups them by day", () => {
    const entries = toEntries(
      [event({ id: "b", startsAt: "2026-09-30T05:00:00.000Z", endsAt: "2026-09-30T06:00:00.000Z" }), event({ id: "a" }), event({ id: "c", allDay: true })],
      [],
      () => ({ title: "", detail: null }),
    );
    expect(entries.map((e) => e.event?.id)).toEqual(["c", "a", "b"]);
    expect(entriesByDay(entries, MANILA).get("2026-09-30")).toHaveLength(3);
  });
});

describe("event form", () => {
  it("builds instants in the facility time zone", () => {
    expect(eventInstants({ startDate: "2026-10-01", startTime: "09:00", endDate: "2026-10-01", endTime: "10:00", allDay: false }, MANILA)).toEqual({
      startsAt: "2026-10-01T01:00:00.000Z",
      endsAt: "2026-10-01T02:00:00.000Z",
    });
  });
  it("refuses an event that ends before it starts, and covers whole days when all-day", () => {
    expect(eventInstants({ startDate: "2026-10-01", startTime: "10:00", endDate: "2026-10-01", endTime: "09:00", allDay: false }, MANILA)).toBeNull();
    expect(eventInstants({ startDate: "2026-10-01", startTime: "", endDate: "2026-10-02", endTime: "", allDay: true }, MANILA)).toEqual({
      startsAt: "2026-09-30T16:00:00.000Z",
      endsAt: "2026-10-02T16:00:00.000Z",
    });
  });
});
