import { availableSlots } from "./availability";
import { canApply, noShowAllowed } from "./appointment-state";
import { canTransition, compareQueueOrder, queueTicket, requiresReason } from "./queue-state";
import { bodyMassIndex, implausibleVitals } from "./vital-signs";

describe("appointment state", () => {
  it("allows check-in and cancellation only before the visit starts", () => {
    expect(canApply("check_in", "booked")).toBe(true);
    expect(canApply("cancel", "checked_in")).toBe(false);
    expect(canApply("reschedule", "cancelled")).toBe(false);
    expect(canApply("complete", "checked_in")).toBe(true);
  });

  it("records a no-show only after the start time", () => {
    const startsAt = new Date("2026-10-05T01:00:00Z");
    expect(noShowAllowed(startsAt, new Date("2026-10-05T00:59:00Z"))).toBe(false);
    expect(noShowAllowed(startsAt, new Date("2026-10-05T01:00:00Z"))).toBe(true);
  });
});

describe("queue state", () => {
  it("follows the clinic workflow", () => {
    expect(canTransition("waiting", "in_triage")).toBe(true);
    expect(canTransition("in_triage", "awaiting_consultation")).toBe(true);
    expect(canTransition("waiting", "completed")).toBe(false);
    expect(canTransition("completed", "waiting")).toBe(false);
    expect(canTransition("in_consultation", "left_without_being_seen")).toBe(false);
  });

  it("requires a reason to close a visit without care", () => {
    expect(requiresReason("left_without_being_seen")).toBe(true);
    expect(requiresReason("in_triage")).toBe(false);
  });

  it("orders by priority, then arrival", () => {
    const early = { priority: "routine" as const, checkedInAt: new Date("2026-10-05T00:00:00Z") };
    const late = { priority: "routine" as const, checkedInAt: new Date("2026-10-05T00:10:00Z") };
    const urgent = { priority: "urgent" as const, checkedInAt: new Date("2026-10-05T00:20:00Z") };
    expect([late, urgent, early].sort(compareQueueOrder)).toEqual([urgent, early, late]);
    expect(queueTicket(7)).toBe("A-007");
  });
});

describe("availableSlots", () => {
  const base = {
    date: "2026-10-05",
    timeZone: "Asia/Manila",
    blocks: [{ startTime: "09:00", endTime: "11:00", slotMinutes: 30, roomId: null }],
    durationMinutes: 30,
    unavailable: [],
    now: new Date("2026-10-01T00:00:00Z"),
  };

  it("cuts schedule blocks into slots in local time", () => {
    const slots = availableSlots(base);
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      "2026-10-05T01:00:00.000Z",
      "2026-10-05T01:30:00.000Z",
      "2026-10-05T02:00:00.000Z",
      "2026-10-05T02:30:00.000Z",
    ]);
  });

  it("removes booked, unavailable and past slots, and slots that do not fit", () => {
    const slots = availableSlots({
      ...base,
      durationMinutes: 45,
      unavailable: [{ start: new Date("2026-10-05T01:30:00Z"), end: new Date("2026-10-05T02:00:00Z") }],
      now: new Date("2026-10-05T00:59:00Z"),
    });
    // 09:00-09:45 overlaps the 09:30 booking; 10:30-11:15 overruns the block.
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual(["2026-10-05T02:00:00.000Z"]);
  });
});

describe("vital signs", () => {
  it("accepts plausible values", () => {
    expect(implausibleVitals({ systolicMmhg: 120, diastolicMmhg: 80, heartRateBpm: 72, temperatureC: 36.8, spo2Percent: 98 })).toEqual([]);
  });

  it("rejects impossible values without correcting them", () => {
    expect(implausibleVitals({ temperatureC: 368 }).map((p) => p.field)).toEqual(["temperatureC"]);
    expect(implausibleVitals({ systolicMmhg: 80, diastolicMmhg: 120 }).map((p) => p.field)).toEqual(["diastolicMmhg"]);
    expect(implausibleVitals({ systolicMmhg: 120 })).toHaveLength(1);
  });

  it("computes BMI for display", () => {
    expect(bodyMassIndex(70, 170)).toBe(24.2);
    expect(bodyMassIndex(null, 170)).toBeNull();
  });
});
