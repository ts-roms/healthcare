import { describe, expect, it } from "vitest";
import type { AppointmentItem } from "./api/types";
import {
  barWindow,
  closedDaysIn,
  closureTouchesDay,
  dayBars,
  hoursLabel,
  monthOf,
  nextWeekCapacity,
  nextWeekStart,
  setupSteps,
  shiftMonth,
  slotLengthNote,
  slotsOf,
  upcomingByDay,
  weeklyHours,
} from "./doctor-profile";

const MON_MORNING = { dayOfWeek: 1, startTime: "08:00:00", endTime: "12:00:00", slotMinutes: 15 };
const TZ = "Asia/Manila";

describe("weekly hours and slots", () => {
  it("counts the slots that fit and the hours and days worked", () => {
    expect(slotsOf(MON_MORNING)).toBe(16);
    expect(slotsOf({ ...MON_MORNING, endTime: "08:10:00" })).toBe(0);
    const rows = [
      MON_MORNING,
      { dayOfWeek: 1, startTime: "13:00", endTime: "15:30", slotMinutes: 30 },
      { dayOfWeek: 3, startTime: "09:00", endTime: "12:00", slotMinutes: 15 },
    ];
    expect(weeklyHours(rows)).toEqual({ minutes: 4 * 60 + 150 + 180, clinicDays: 2 });
    expect(weeklyHours([])).toEqual({ minutes: 0, clinicDays: 0 });
  });

  it("words the hours", () => {
    expect(hoursLabel(240)).toBe("4 h");
    expect(hoursLabel(2250)).toBe("37 h 30 min");
    expect(hoursLabel(45)).toBe("45 min");
    expect(hoursLabel(0)).toBe("0 h");
  });
});

describe("schedule bars", () => {
  it("draws Monday first within 08:00–20:00, widening the window only when a schedule needs it", () => {
    expect(barWindow([MON_MORNING])).toEqual({ start: 480, end: 1200 });
    expect(barWindow([{ ...MON_MORNING, startTime: "06:30", endTime: "21:15" }])).toEqual({ start: 360, end: 1320 });
    const bars = dayBars([MON_MORNING, { dayOfWeek: 0, startTime: "10:00", endTime: "12:00", slotMinutes: 15 }]);
    expect(bars.map((b) => b.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(bars[0]).toMatchObject({ hours: "08:00-12:00", slots: 16 });
    const monday = bars[0]?.segments[0];
    expect(monday?.left).toBe(0);
    expect(monday?.width).toBeCloseTo(33.33, 1);
    expect(bars[1]).toEqual({ dayOfWeek: 2, segments: [], hours: null, slots: 0 });
    expect(bars[6]).toMatchObject({ hours: "10:00-12:00", slots: 8 });
  });

  it("says how long the slots are", () => {
    expect(slotLengthNote([MON_MORNING])).toBe("Slots are 15 minutes.");
    expect(slotLengthNote([MON_MORNING, { ...MON_MORNING, dayOfWeek: 2, slotMinutes: 30 }])).toBe("Slot length varies by day.");
  });
});

describe("next week", () => {
  it("starts on the Monday after this week; a Sunday belongs to the week that ends", () => {
    expect(nextWeekStart("2026-10-21")).toBe("2026-10-26"); // Wednesday
    expect(nextWeekStart("2026-10-26")).toBe("2026-11-02"); // Monday
    expect(nextWeekStart("2026-10-25")).toBe("2026-10-26"); // Sunday
  });

  it("offers the week's slots, none on a day a closure touches", () => {
    const rows = [MON_MORNING, { dayOfWeek: 3, startTime: "09:00", endTime: "11:00", slotMinutes: 15 }];
    expect(nextWeekCapacity(rows, [], "2026-10-21", TZ)).toBe(16 + 8);
    // Leave on Wednesday 28 October, Manila time.
    const leave = { startsAt: "2026-10-27T16:00:00Z", endsAt: "2026-10-28T16:00:00Z" };
    expect(nextWeekCapacity(rows, [leave], "2026-10-21", TZ)).toBe(16);
  });

  it("finds the days of a closure in the facility's zone", () => {
    const leave = { startsAt: "2026-10-11T16:00:00Z", endsAt: "2026-10-12T16:00:00Z" }; // all of the 12th in Manila
    expect(closureTouchesDay(leave, "2026-10-12", TZ)).toBe(true);
    expect(closureTouchesDay(leave, "2026-10-11", TZ)).toBe(false);
    expect(closureTouchesDay(leave, "2026-10-13", TZ)).toBe(false);
    expect([...closedDaysIn("2026-10", [leave], TZ)]).toEqual(["2026-10-12"]);
  });
});

describe("months", () => {
  it("reads and moves the month of the address", () => {
    expect(monthOf("2026-11", "2026-10-21")).toBe("2026-11");
    expect(monthOf("nonsense", "2026-10-21")).toBe("2026-10");
    expect(monthOf("2026-13", "2026-10-21")).toBe("2026-10");
    expect(monthOf(undefined, "2026-10-21")).toBe("2026-10");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});

const appointment = (id: string, startsAt: string, status: AppointmentItem["status"] = "booked"): AppointmentItem => ({
  id,
  facilityId: "f1",
  patientId: `p-${id}`,
  practitionerId: "dr",
  visitTypeId: "vt",
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + 15 * 60_000).toISOString(),
  status,
  bookingChannel: "staff",
  reason: null,
  version: 1,
  patient: { patientNumber: "P1", displayName: "SANTOS, Maria", sex: "female", age: 40 },
});

describe("upcomingByDay", () => {
  const now = new Date("2026-10-21T02:00:00Z");

  it("groups what is still to come by day in the facility's zone, soonest first, leaving out the rest", () => {
    const days = upcomingByDay(
      [
        appointment("c", "2026-10-26T01:15:00Z"), // 09:15 Manila on the 26th
        appointment("a", "2026-10-26T00:00:00Z"), // 08:00 Manila
        appointment("x", "2026-10-26T00:30:00Z", "cancelled"),
        appointment("old", "2026-10-20T01:00:00Z"),
        appointment("z", "2026-10-27T16:30:00Z"), // 00:30 Manila on the 28th
      ],
      TZ,
      now,
    );
    expect(days.map((d) => [d.date, d.label, d.items.map((i) => i.id)])).toEqual([
      ["2026-10-26", "MON, OCT 26", ["a", "c"]],
      ["2026-10-28", "WED, OCT 28", ["z"]],
    ]);
  });
});

describe("setupSteps", () => {
  it("lists what is missing, nothing when the profile is complete", () => {
    expect(setupSteps({ userId: null, licenseNumber: null }, true).map((s) => s.key)).toEqual(["account", "licence"]);
    expect(setupSteps({ userId: "u1", licenseNumber: null }, false).map((s) => s.key)).toEqual(["licence", "schedule"]);
    expect(setupSteps({ userId: "u1", licenseNumber: "0123456" }, true)).toEqual([]);
  });
});
