import { describe, expect, it } from "vitest";
import type { AppointmentItem, PractitionerScheduleRow } from "@/lib/api/types";
import {
  clockToMinutes,
  closuresOn,
  dayFigures,
  durationText,
  initialsOf,
  minutesInZone,
  placeAppointments,
  slotCount,
  timelineRange,
  unavailableBands,
  weekOf,
  workingBlocks,
} from "./appointment-day";

const TZ = "Asia/Manila";
const FAC = "fac";
const DOC = "doc";

const row = (over: Partial<PractitionerScheduleRow>): PractitionerScheduleRow => ({
  id: Math.random().toString(36),
  practitionerId: DOC,
  facilityId: FAC,
  roomId: "room-2",
  dayOfWeek: 6,
  startTime: "08:00:00",
  endTime: "12:00:00",
  slotMinutes: 15,
  validFrom: "2026-01-01",
  validUntil: null,
  status: "active",
  retiredAt: null,
  ...over,
});

const appt = (over: Partial<AppointmentItem>): AppointmentItem => ({
  id: Math.random().toString(36),
  facilityId: FAC,
  patientId: "p",
  practitionerId: DOC,
  visitTypeId: "vt",
  startsAt: "2026-12-05T01:00:00.000Z",
  endsAt: "2026-12-05T01:15:00.000Z",
  status: "confirmed",
  bookingChannel: "follow_up",
  reason: null,
  version: 1,
  patient: null,
  ...over,
});

describe("time helpers", () => {
  it("reads instants on the facility's clock", () => {
    expect(minutesInZone("2026-12-05T01:00:00.000Z", TZ)).toBe(9 * 60);
    expect(clockToMinutes("13:30:00")).toBe(13 * 60 + 30);
  });

  it("gives the Monday-to-Sunday week", () => {
    expect(weekOf("2026-12-05")).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
    expect(weekOf("2026-11-30")[0]).toBe("2026-11-30");
  });

  it("writes durations and initials", () => {
    expect(durationText(15)).toBe("15 min");
    expect(durationText(90)).toBe("1 h 30 min");
    expect(initialsOf("Dr. Ana Santos")).toBe("AS");
    expect(initialsOf("SANTOS, Maria Reyes")).toBe("MS");
  });
});

describe("a practitioner's day", () => {
  const rows = [row({}), row({ startTime: "13:00:00", endTime: "17:00:00" }), row({ dayOfWeek: 1 }), row({ practitionerId: "other" })];
  const blocks = workingBlocks(rows, DOC, FAC, "2026-12-05");

  it("takes the blocks published for that weekday", () => {
    expect(blocks.map((b) => [b.start, b.end])).toEqual([
      [480, 720],
      [780, 1020],
    ]);
  });

  it("shades the break between blocks and the hours outside them", () => {
    const range = timelineRange(blocks, []);
    expect(range).toEqual({ start: 480, end: 1020 });
    expect(unavailableBands(blocks, [], range)).toEqual([{ start: 720, end: 780, label: "Break" }]);
    expect(unavailableBands(blocks, [], { start: 420, end: 1080 }).map((b) => b.label)).toEqual(["Not scheduled", "Break", "Not scheduled"]);
    expect(unavailableBands([], [], range)).toEqual([{ ...range, label: "Not scheduled" }]);
  });

  it("widens the range to an appointment outside the schedule", () => {
    expect(timelineRange(blocks, [{ start: 17 * 60 + 30, end: 17 * 60 + 45 }])).toEqual({ start: 480, end: 18 * 60 });
  });

  it("always shows the whole clinic day, even with only evening bookings and no published hours", () => {
    expect(timelineRange([], [])).toEqual({ start: 480, end: 1020 });
    expect(timelineRange([], [{ start: 17 * 60, end: 18 * 60 }])).toEqual({ start: 480, end: 18 * 60 });
    expect(timelineRange([{ start: 7 * 60 + 30, end: 11 * 60 }], [])).toEqual({ start: 420, end: 1020 });
  });

  it("counts open slots, less bookings and closures", () => {
    expect(slotCount(blocks, [], [])).toEqual({ open: 32, total: 32 });
    expect(slotCount(blocks, [{ start: 780, end: 840 }], [{ start: 540, end: 555 }])).toEqual({ open: 27, total: 32 });
  });

  it("clips closures to the day and keeps the facility-wide ones", () => {
    const closures = closuresOn(
      [
        { id: "1", facilityId: FAC, practitionerId: null, startsAt: "2026-12-05T05:00:00.000Z", endsAt: "2026-12-05T06:00:00.000Z", reason: "Staff meeting" },
        { id: "2", facilityId: FAC, practitionerId: "other", startsAt: "2026-12-05T00:00:00.000Z", endsAt: "2026-12-05T09:00:00.000Z", reason: "Leave" },
        { id: "3", facilityId: FAC, practitionerId: DOC, startsAt: "2026-12-04T00:00:00.000Z", endsAt: "2026-12-05T00:30:00.000Z", reason: "Conference" },
      ],
      DOC,
      "2026-12-04T16:00:00.000Z",
      "2026-12-05T16:00:00.000Z",
      TZ,
    );
    expect(closures).toEqual([
      { start: 0, end: 510, reason: "Conference" },
      { start: 780, end: 840, reason: "Staff meeting" },
    ]);
  });
});

describe("placing appointments", () => {
  it("puts overlapping ones side by side", () => {
    const placed = placeAppointments(
      [
        appt({ id: "a", startsAt: "2026-12-05T01:00:00.000Z", endsAt: "2026-12-05T01:30:00.000Z" }),
        appt({ id: "b", startsAt: "2026-12-05T01:15:00.000Z", endsAt: "2026-12-05T01:45:00.000Z" }),
        appt({ id: "c", startsAt: "2026-12-05T02:00:00.000Z", endsAt: "2026-12-05T02:15:00.000Z" }),
      ],
      TZ,
    );
    expect(placed.map((p) => [p.item.id, p.start, p.lane, p.lanes])).toEqual([
      ["a", 540, 0, 2],
      ["b", 555, 1, 2],
      ["c", 600, 0, 1],
    ]);
  });
});

describe("dayFigures", () => {
  it("counts what holds time, who arrived and who is next", () => {
    const items = [
      appt({ id: "seen", status: "completed", startsAt: "2026-12-05T00:00:00.000Z", endsAt: "2026-12-05T00:30:00.000Z" }),
      appt({ id: "next", status: "confirmed" }),
      appt({ id: "gone", status: "cancelled" }),
    ];
    const f = dayFigures(items, new Date("2026-12-05T00:40:00.000Z"));
    expect(f).toMatchObject({ scheduled: 2, bookedMinutes: 45, checkedIn: 1 });
    expect(f.nextUp?.id).toBe("next");
  });
});
