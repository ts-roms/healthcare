import { describe, expect, it } from "vitest";
import type { AppointmentItem, Practitioner, QueueVisit, VisitType } from "./api/types";
import {
  appointmentActions,
  canTriage,
  groupByPractitioner,
  moveNeedsReason,
  queueMoves,
  shiftDate,
  toAppointment,
  todayIn,
  toQueueEntry,
} from "./clinic-mapping";

const visit: QueueVisit = {
  id: "v1",
  facilityId: "f1",
  patientId: "p1",
  appointmentId: null,
  arrivalMode: "walk_in",
  ticket: "A-007",
  queueNumber: 7,
  queueDate: "2026-09-27",
  priority: "routine",
  status: "awaiting_consultation",
  chiefComplaint: "Fever",
  checkedInAt: "2026-09-27T01:00:00Z",
  calledAt: null,
  calledTo: null,
  assignedPractitionerId: null,
  version: 3,
  waitingMinutes: 12,
  patient: { patientNumber: "P00000001", displayName: "DELA CRUZ, Juan", sex: "male", age: 46 },
};

describe("toQueueEntry", () => {
  it("maps API statuses to board columns with a readable station", () => {
    expect(toQueueEntry(visit)).toEqual({
      id: "v1",
      ticket: "A-007",
      patientName: "DELA CRUZ, Juan",
      station: "Ready for provider · Fever",
      status: "ready",
      arrivedAt: "2026-09-27T01:00:00Z",
      priority: undefined,
    });
    expect(toQueueEntry({ ...visit, status: "in_triage" }).status).toBe("vitals");
    expect(toQueueEntry({ ...visit, status: "in_consultation" }).status).toBe("with-provider");
    expect(toQueueEntry({ ...visit, status: "left_without_being_seen" }).station).toBe("Left without being seen · Fever");
  });

  it("shows where a called patient should go, and non-routine priority", () => {
    expect(toQueueEntry({ ...visit, calledTo: "Room 2", priority: "emergency" })).toMatchObject({ station: "Called to Room 2", priority: "emergency" });
  });
});

describe("queue moves", () => {
  it("mirrors the API's queue transitions", () => {
    expect(queueMoves("waiting")).toEqual(["in_triage", "cancelled", "left_without_being_seen"]);
    expect(queueMoves("in_consultation")).toEqual([]);
    expect(moveNeedsReason("left_without_being_seen")).toBe(true);
    expect(moveNeedsReason("in_triage")).toBe(false);
  });
});

const practitioners = new Map<string, Practitioner>([
  ["dr-b", { id: "dr-b", displayName: "Dr. Santos", profession: "physician", specialty: null, status: "active" }],
  ["dr-a", { id: "dr-a", displayName: "Dr. Reyes", profession: "physician", specialty: null, status: "active" }],
]);
const visitTypes = new Map<string, VisitType>([
  ["vt", { id: "vt", code: "consult", name: "Consultation", defaultDurationMinutes: 15, modality: "in_person", status: "active" }],
  ["tele", { id: "tele", code: "tele", name: "Online consult", defaultDurationMinutes: 20, modality: "telemedicine", status: "active" }],
]);
const appointment: AppointmentItem = {
  id: "a1",
  facilityId: "f1",
  patientId: "p1",
  practitionerId: "dr-a",
  visitTypeId: "vt",
  startsAt: "2026-09-27T01:00:00Z",
  endsAt: "2026-09-27T01:15:00Z",
  status: "checked_in",
  bookingChannel: "front_desk",
  reason: "BP follow-up",
  version: 2,
  patient: { patientNumber: "P00000001", displayName: "DELA CRUZ, Juan", sex: "male", age: 46 },
};

describe("toAppointment", () => {
  it("maps API appointments to schedule rows", () => {
    expect(toAppointment(appointment, practitioners, visitTypes)).toEqual({
      id: "a1",
      patientId: "p1",
      patientName: "DELA CRUZ, Juan · P00000001",
      provider: "Dr. Reyes",
      start: "2026-09-27T01:00:00Z",
      durationMin: 15,
      type: "consultation",
      mode: "in-person",
      status: "arrived",
      reason: "Consultation · BP follow-up",
    });
    expect(toAppointment({ ...appointment, visitTypeId: "tele", status: "no_show" }, practitioners, visitTypes)).toMatchObject({
      mode: "online",
      status: "no-show",
    });
  });
});

describe("appointmentActions", () => {
  const context = { now: new Date("2026-09-27T00:30:00Z"), isToday: true, canManage: true, canCheckIn: true };

  it("offers check-in only today, and no-show only after the start", () => {
    const booked = { status: "booked" as const, startsAt: "2026-09-27T01:00:00Z" };
    expect(appointmentActions(booked, context)).toEqual(["check_in", "confirm", "cancel"]);
    expect(appointmentActions(booked, { ...context, now: new Date("2026-09-27T01:05:00Z") })).toEqual(["check_in", "confirm", "no_show", "cancel"]);
    expect(appointmentActions(booked, { ...context, isToday: false })).toEqual(["confirm", "cancel"]);
  });

  it("offers nothing on closed appointments or without permission", () => {
    expect(appointmentActions({ status: "completed", startsAt: "2026-09-27T01:00:00Z" }, context)).toEqual([]);
    expect(appointmentActions({ status: "confirmed", startsAt: "2026-09-27T01:00:00Z" }, { ...context, canManage: false, canCheckIn: false })).toEqual([]);
  });
});

describe("helpers", () => {
  it("groups schedule rows by practitioner name, rows by time", () => {
    const rows = [
      { practitionerId: "dr-b", startsAt: "2026-09-27T02:00:00Z" },
      { practitionerId: "dr-a", startsAt: "2026-09-27T03:00:00Z" },
      { practitionerId: "dr-a", startsAt: "2026-09-27T01:00:00Z" },
    ];
    const groups = groupByPractitioner(rows, practitioners);
    expect(groups.map((g) => g.practitioner?.displayName)).toEqual(["Dr. Reyes", "Dr. Santos"]);
    expect(groups[0]?.items.map((r) => r.startsAt)).toEqual(["2026-09-27T01:00:00Z", "2026-09-27T03:00:00Z"]);
  });

  it("does calendar and time-zone date arithmetic", () => {
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(todayIn("Asia/Manila", new Date("2026-09-26T17:00:00Z"))).toBe("2026-09-27");
  });
});

describe("canTriage", () => {
  it("allows triage before the consultation starts, as the API does", () => {
    expect(canTriage("waiting")).toBe(true);
    expect(canTriage("in_triage")).toBe(true);
    expect(canTriage("awaiting_consultation")).toBe(true);
    expect(canTriage("in_consultation")).toBe(false);
    expect(canTriage("completed")).toBe(false);
  });
});
