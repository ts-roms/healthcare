import { describe, expect, it } from "vitest";
import {
  type CalendarEntry,
  dayHourRange,
  daySpan,
  daySummary,
  daysCovered,
  durationLabel,
  entriesByDay,
  eventInstants,
  layoutDay,
  minuteOfDay,
  stepDate,
  timeLabel,
  toEntries,
  viewDays,
  viewRange,
} from "./calendar";
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

describe("the day timeline", () => {
  // 2026-11-05 in Manila (UTC+8): 09:00 local is 01:00 UTC.
  const at = (hhmm: string, day = "2026-11-05") => new Date(`${day}T${hhmm}:00+08:00`).toISOString();
  const entry = (key: string, from: string, to: string, over: Partial<CalendarEntry> = {}): CalendarEntry => ({
    key,
    source: "appointment",
    title: key,
    startsAt: at(from),
    endsAt: at(to),
    allDay: false,
    cancelled: false,
    detail: null,
    ...over,
  });
  const DAY = "2026-11-05";

  it("reads times in the facility's time zone", () => {
    expect(timeLabel(at("09:30"), MANILA)).toMatch(/^9:30\s?(am|AM)$/i);
    expect(daySpan(entry("a", "09:00", "10:30"), DAY, MANILA)).toEqual({ start: 540, end: 630 });
    expect(minuteOfDay(at("11:24"), DAY, MANILA)).toBe(684);
    expect(minuteOfDay(at("11:24", "2026-11-06"), DAY, MANILA)).toBeNull();
  });

  it("cuts an entry that crosses midnight to the day shown", () => {
    const overnight: CalendarEntry = { ...entry("n", "22:00", "23:00"), endsAt: at("02:00", "2026-11-06") };
    expect(daySpan(overnight, DAY, MANILA)).toEqual({ start: 1320, end: 1440 });
    expect(daySpan(overnight, "2026-11-06", MANILA)).toEqual({ start: 0, end: 120 });
  });

  it("puts overlapping entries side by side and lets later ones use the full width again", () => {
    const blocks = layoutDay(
      [entry("a", "09:00", "10:30"), entry("b", "09:30", "10:00"), entry("c", "10:00", "11:00"), entry("d", "13:00", "14:00")],
      DAY,
      MANILA,
    );
    const by = Object.fromEntries(blocks.map((b) => [b.entry.key, b]));
    expect([by.a!.lane, by.b!.lane]).toEqual([0, 1]);
    // c starts when b ends, so it takes b's lane; the whole cluster needs two lanes.
    expect(by.c!.lane).toBe(1);
    expect([by.a!.lanes, by.b!.lanes, by.c!.lanes]).toEqual([2, 2, 2]);
    expect([by.d!.lane, by.d!.lanes]).toEqual([0, 1]);
  });

  it("keeps all-day entries off the timeline and draws a very short entry readably", () => {
    const blocks = layoutDay([entry("allday", "00:00", "00:00", { allDay: true }), entry("quick", "09:00", "09:05")], DAY, MANILA);
    expect(blocks.map((b) => b.entry.key)).toEqual(["quick"]);
    expect(blocks[0]!.end - blocks[0]!.start).toBeGreaterThanOrEqual(30);
  });

  it("shows working hours, widened to hold early and late entries", () => {
    expect(dayHourRange([])).toEqual({ startHour: 7, endHour: 19 });
    const early = layoutDay([entry("e", "05:30", "06:30"), entry("l", "19:30", "21:10")], DAY, MANILA);
    expect(dayHourRange(early)).toEqual({ startHour: 5, endHour: 22 });
  });

  it("totals the day, keeping cancelled entries out of the hours", () => {
    const summary = daySummary(
      [
        entry("a", "09:00", "10:00"),
        entry("b", "10:00", "10:30"),
        entry("x", "11:00", "12:00", { cancelled: true }),
        entry("m", "13:00", "14:30", { source: "event" }),
        entry("allday", "00:00", "00:00", { source: "event", allDay: true }),
      ],
      DAY,
      MANILA,
    );
    expect(summary).toEqual({ appointments: 2, events: 2, cancelled: 1, appointmentMinutes: 90, eventMinutes: 90 });
  });

  it("writes a length of time for a person", () => {
    expect(durationLabel(45)).toBe("45 min");
    expect(durationLabel(60)).toBe("1 h");
    expect(durationLabel(90)).toBe("1 h 30 min");
    expect(durationLabel(210)).toBe("3 h 30 min");
  });
});
