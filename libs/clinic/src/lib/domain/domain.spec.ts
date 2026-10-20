import { availableSlots } from "./availability";
import { canApply, noShowAllowed } from "./appointment-state";
import {
  canAdvanceRoute,
  canRouteVisit,
  canTransition,
  compareQueueOrder,
  currentRouteStep,
  nextRouteStep,
  queueDisplay,
  queueTicket,
  requiresReason,
  routeComplete,
  routeInPlan,
  routePlanProblem,
  servicePointQueue,
} from "./queue-state";
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

  it("routes to a service point only after triage has started, never from a closed visit", () => {
    expect(canRouteVisit("waiting")).toBe(false);
    expect(canRouteVisit("in_triage")).toBe(true);
    expect(canRouteVisit("awaiting_consultation")).toBe(true);
    expect(canRouteVisit("in_consultation")).toBe(false);
    expect(canRouteVisit("completed")).toBe(false);
    expect(canRouteVisit("cancelled")).toBe(false);
    expect(canRouteVisit("left_without_being_seen")).toBe(false);
  });

  it("advances a route only from a routable visit, to the lowest planned step, and says when it is complete", () => {
    const step = (position: number, status: "planned" | "current" | "done" | "skipped" | "removed", servicePointId = `sp${position}`) => ({
      position,
      status,
      servicePointId,
    });
    const route = [step(1, "done"), step(2, "current"), step(3, "planned"), step(4, "planned")];
    expect(currentRouteStep(route)?.position).toBe(2);
    expect(nextRouteStep(route)?.position).toBe(3);
    expect(canAdvanceRoute("awaiting_consultation", route)).toEqual({ ok: true, current: route[1], next: route[2] });
    // The lowest planned step wins even when listed out of order; removed and skipped steps are passed over.
    const shuffled = [step(5, "planned"), step(3, "removed"), step(4, "skipped"), step(2, "current"), step(6, "planned")];
    expect(nextRouteStep(shuffled)?.position).toBe(5);
    expect(routeInPlan(shuffled).map((s) => s.position)).toEqual([2, 4, 5, 6]);
    // At the last stop the step is finished and the visit stays: next is null.
    expect(canAdvanceRoute("in_triage", [step(1, "done"), step(2, "current")])).toEqual({
      ok: true,
      current: expect.objectContaining({ position: 2 }),
      next: null,
    });
    // A visit on a line that is not in the plan is sent to the first planned step.
    expect(canAdvanceRoute("awaiting_consultation", [step(1, "planned")])).toEqual({ ok: true, current: null, next: expect.objectContaining({ position: 1 }) });
    expect(canAdvanceRoute("waiting", route)).toEqual({ ok: false, code: "visit_not_routable" });
    expect(canAdvanceRoute("in_consultation", route)).toEqual({ ok: false, code: "visit_not_routable" });
    expect(canAdvanceRoute("awaiting_consultation", [])).toEqual({ ok: false, code: "no_route" });
    expect(canAdvanceRoute("awaiting_consultation", [step(1, "removed")])).toEqual({ ok: false, code: "no_route" });
    expect(canAdvanceRoute("awaiting_consultation", [step(1, "done"), step(2, "skipped")])).toEqual({ ok: false, code: "route_complete" });
    expect(routeComplete([step(1, "done"), step(2, "skipped")])).toBe(true);
    expect(routeComplete([step(1, "done"), step(2, "planned")])).toBe(false);
    expect(routeComplete([])).toBe(false);
  });

  it("refuses an empty plan, a stop repeated back to back, and a first stop the visit is already at", () => {
    expect(routePlanProblem([], null)).toBe("route_empty");
    expect(routePlanProblem(["lab", "xray", "lab"], null)).toBeNull();
    expect(routePlanProblem(["lab", "lab"], null)).toBe("route_step_repeated");
    expect(routePlanProblem(["lab", "xray"], "lab")).toBe("route_step_repeated");
    expect(routePlanProblem(["xray", "lab"], "lab")).toBeNull();
  });

  it("lists a service point's queue by priority, then arrival, and the consultation line as the null service point", () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 20, 1, minute));
    const er = "er";
    const rows = [
      { id: "a", priority: "routine" as const, checkedInAt: at(0), servicePointId: er },
      { id: "b", priority: "routine" as const, checkedInAt: at(5), servicePointId: null },
      { id: "c", priority: "emergency" as const, checkedInAt: at(10), servicePointId: er },
      { id: "d", priority: "urgent" as const, checkedInAt: at(15), servicePointId: er },
      { id: "e", priority: "urgent" as const, checkedInAt: at(20), servicePointId: "xray" },
    ];
    expect(servicePointQueue(rows, er).map((r) => r.id)).toEqual(["c", "d", "a"]);
    expect(servicePointQueue(rows, null).map((r) => r.id)).toEqual(["b"]);
    expect(servicePointQueue(rows, "none")).toEqual([]);
  });

  it("orders by priority, then arrival", () => {
    const early = { priority: "routine" as const, checkedInAt: new Date("2026-10-05T00:00:00Z") };
    const late = { priority: "routine" as const, checkedInAt: new Date("2026-10-05T00:10:00Z") };
    const urgent = { priority: "urgent" as const, checkedInAt: new Date("2026-10-05T00:20:00Z") };
    expect([late, urgent, early].sort(compareQueueOrder)).toEqual([urgent, early, late]);
    expect(queueTicket(7)).toBe("A-007");
  });

  it("shows the waiting room the open in-person calls, newest first, and how many wait — nothing else", () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 9, 1, minute));
    const row = (queueNumber: number, status: Parameters<typeof canTransition>[0], calledAt: Date | null, calledTo: string | null, inPerson = true) => ({
      queueNumber,
      status,
      calledAt,
      calledTo,
      inPerson,
    });
    const display = queueDisplay(
      [
        row(1, "in_consultation", at(5), "Room 1"),
        row(2, "awaiting_consultation", at(20), "Triage 1"),
        row(3, "waiting", null, null),
        row(4, "completed", at(30), "Room 2"),
        row(5, "waiting", at(40), "Room 3", false),
        row(6, "left_without_being_seen", null, null),
        row(7, "waiting", at(25), "Triage 2"),
      ],
      2,
    );
    expect(display.calls).toEqual([
      { ticket: "A-007", calledTo: "Triage 2", calledAt: at(25) },
      { ticket: "A-002", calledTo: "Triage 1", calledAt: at(20) },
    ]);
    // Waiting for triage or the doctor: A-002, A-003, A-007 (closed and online visits never count).
    expect(display.waiting).toBe(3);
    expect(Object.keys(display.calls[0]!).sort()).toEqual(["calledAt", "calledTo", "ticket"]);
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
