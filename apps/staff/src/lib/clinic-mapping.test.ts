import { describe, expect, it } from "vitest";
import type { AppointmentItem, Practitioner, PractitionerScheduleRow, QueueVisit, VisitType } from "./api/types";
import {
  referralRecipient,
  appointmentActions,
  canRouteVisit,
  canStartConsultation,
  canTriage,
  defaultServicePoint,
  groupByPractitioner,
  groupByRoom,
  moveNeedsReason,
  nextScheduledDate,
  queueMoves,
  scheduleBlocksOn,
  scheduleDaysText,
  shiftDate,
  toAppointment,
  todayIn,
  upcomingAppointments,
  zonedLocalToIso,
  toQueueEntry,
  queueFigures,
} from "./clinic-mapping";

const visit: QueueVisit = {
  id: "v1",
  facilityId: "f1",
  patientId: "p1",
  appointmentId: null,
  arrivalMode: "walk_in",
  checkedInVia: "staff",
  ticket: "A-007",
  queueNumber: 7,
  queueDate: "2026-09-27",
  route: [],
  priority: "routine",
  status: "awaiting_consultation",
  chiefComplaint: "Fever",
  checkedInAt: "2026-09-27T01:00:00Z",
  calledAt: null,
  calledTo: null,
  assignedPractitionerId: null,
  version: 3,
  waitingMinutes: 12,
  encounterId: null,
  modality: "in_person",
  patient: { patientNumber: "P00000001", displayName: "DELA CRUZ, Juan", sex: "male", age: 46 },
  servicePointId: null,
  servicePoint: null,
};

describe("queueFigures", () => {
  const at = (minutesAgo: number, status: QueueVisit["status"], name = "DELA CRUZ, Juan"): QueueVisit => ({
    ...visit,
    status,
    checkedInAt: new Date(Date.parse("2026-09-27T02:00:00Z") - minutesAgo * 60_000).toISOString(),
    patient: { patientNumber: "P1", displayName: name, sex: "male", age: 30 },
  });
  const now = new Date("2026-09-27T02:00:00Z");

  it("counts who is in the queue, who is done and how long the others have waited", () => {
    const figures = queueFigures(
      [
        at(10, "waiting"),
        at(30, "in_triage", "SANTOS, Maria"),
        at(20, "awaiting_consultation"),
        at(50, "in_consultation"),
        at(90, "completed"),
        at(80, "cancelled"),
      ],
      now,
    );
    expect(figures).toMatchObject({ inQueue: 4, done: 2, waiting: 3, withProvider: 1, averageWaitMinutes: 20 });
    expect(figures.longestWait).toEqual({ minutes: 30, patientName: "SANTOS, Maria", ticket: "A-007", priority: "routine" });
  });

  it("has no waits when nobody is waiting", () => {
    expect(queueFigures([], now)).toEqual({ inQueue: 0, done: 0, waiting: 0, withProvider: 0, averageWaitMinutes: null, longestWait: null });
    expect(queueFigures([at(5, "in_consultation")], now).longestWait).toBeNull();
  });
});

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
      arrival: "walk-in",
      detail: "Fever",
    });
    expect(toQueueEntry({ ...visit, arrivalMode: "appointment" }).arrival).toBe("appointment");
    expect(toQueueEntry({ ...visit, calledTo: "Room 2", calledAt: "2026-09-27T01:05:00Z" }).detail).toBe("Called to Room 2");
    expect(toQueueEntry({ ...visit, status: "in_triage" }).status).toBe("vitals");
    expect(toQueueEntry({ ...visit, status: "in_consultation" }).status).toBe("with-provider");
    expect(toQueueEntry({ ...visit, status: "left_without_being_seen" }).station).toBe("Left without being seen · Fever");
    // An in-person patient who checked in from MyHealth; an online consultation's waiting room is not "checked in online".
    expect(toQueueEntry({ ...visit, status: "waiting", checkedInVia: "patient_portal" }).station).toBe("Waiting · Checked in online · Fever");
    expect(toQueueEntry({ ...visit, checkedInVia: "patient_portal", modality: "telemedicine" }).station).not.toContain("online");
  });

  it("marks a senior on the board without overriding a triage priority", () => {
    const senior = { ...visit, patient: { ...visit.patient!, age: 60 } };
    expect(toQueueEntry(senior).priority).toBe("senior");
    expect(toQueueEntry({ ...senior, priority: "urgent" }).priority).toBe("urgent");
    expect(toQueueEntry({ ...visit, patient: { ...visit.patient!, age: 59 } }).priority).toBeUndefined();
  });

  it("shows where a called patient should go, and non-routine priority", () => {
    expect(toQueueEntry({ ...visit, calledTo: "Room 2", priority: "emergency" })).toMatchObject({ station: "Called to Room 2", priority: "emergency" });
  });

  it("names the service point the patient was sent to", () => {
    const er = { id: "sp-er", code: "er", name: "Emergency room", kind: "emergency" as const, location: null };
    expect(toQueueEntry({ ...visit, servicePointId: er.id, servicePoint: er }).station).toBe("Ready for provider · Emergency room · Fever");
    expect(toQueueEntry({ ...visit, servicePointId: er.id, servicePoint: er, calledTo: "Bed 3" }).station).toBe("Called to Bed 3 · Emergency room");
  });

  it("names the next stop of the route, never a finished or skipped one", () => {
    const xray = { id: "sp-xray", code: "xray", name: "X-ray", kind: "imaging" as const, location: "X-ray, ground floor" };
    const step = (id: string, position: number, status: "planned" | "current" | "done" | "skipped") => ({
      id,
      position,
      status,
      servicePointId: xray.id,
      servicePoint: xray,
      startedAt: null,
      completedAt: null,
      note: null,
    });
    expect(toQueueEntry({ ...visit, route: [step("s1", 1, "done"), step("s2", 2, "current"), step("s3", 3, "planned")] }).station).toBe(
      "Ready for provider · next: X-ray · Fever",
    );
    expect(toQueueEntry({ ...visit, route: [step("s1", 1, "done"), step("s2", 2, "skipped")] }).station).toBe("Ready for provider · Fever");
  });
});

describe("service points", () => {
  const points = [
    { id: "sp-xray", kind: "imaging" as const, status: "active" as const },
    { id: "sp-opd", kind: "consultation" as const, status: "inactive" as const },
    { id: "sp-opd2", kind: "consultation" as const, status: "active" as const },
  ];

  it("routes only from in triage or awaiting consultation, as the API does", () => {
    expect(canRouteVisit("waiting")).toBe(false);
    expect(canRouteVisit("in_triage")).toBe(true);
    expect(canRouteVisit("awaiting_consultation")).toBe(true);
    expect(canRouteVisit("in_consultation")).toBe(false);
    expect(canRouteVisit("completed")).toBe(false);
  });

  it("starts the triage picker on the visit's own service point, else the first active consultation line, else none", () => {
    expect(defaultServicePoint(points, "sp-xray")).toBe("sp-xray");
    expect(defaultServicePoint(points, null)).toBe("sp-opd2");
    expect(defaultServicePoint([points[0]!], null)).toBe("");
    expect(defaultServicePoint([], null)).toBe("");
  });
});

describe("practitioner schedule days", () => {
  const block = (dayOfWeek: number, startTime: string, endTime: string, extra: Partial<PractitionerScheduleRow> = {}): PractitionerScheduleRow => ({
    id: `${dayOfWeek}-${startTime}`,
    practitionerId: "dr",
    facilityId: "main",
    roomId: null,
    dayOfWeek,
    startTime,
    endTime,
    slotMinutes: 20,
    validFrom: "2026-01-01",
    validUntil: null,
    status: "active",
    retiredAt: null,
    ...extra,
  });
  const rows = [
    block(2, "08:00:00", "12:00:00"),
    block(4, "08:00:00", "12:00:00"),
    block(5, "13:00:00", "17:00:00"),
    block(1, "08:00:00", "12:00:00", { status: "retired" }),
    block(1, "08:00:00", "12:00:00", { facilityId: "annex" }),
    block(3, "08:00:00", "12:00:00", { validUntil: "2026-10-01" }),
  ];

  it("lists the days and hours of the current schedule at the facility", () => {
    expect(scheduleDaysText(rows, "dr", "main", "2026-10-26")).toBe("Tue, Thu 08:00–12:00 · Fri 13:00–17:00");
    expect(scheduleDaysText(rows, "dr", "annex", "2026-10-26")).toBe("Mon 08:00–12:00");
    expect(scheduleDaysText(rows, "nobody", "main", "2026-10-26")).toBe("");
  });

  it("finds the blocks valid on a date, and the next scheduled day after it", () => {
    // Monday 26 October 2026: no block at the main clinic (the Monday one is retired).
    expect(scheduleBlocksOn(rows, "dr", "main", "2026-10-26")).toEqual([]);
    expect(scheduleBlocksOn(rows, "dr", "main", "2026-10-27").map((b) => b.dayOfWeek)).toEqual([2]);
    expect(nextScheduledDate(rows, "dr", "main", "2026-10-26")).toBe("2026-10-27");
    expect(nextScheduledDate(rows, "dr", "main", "2026-10-29")).toBe("2026-10-30");
    expect(nextScheduledDate(rows, "dr", "main", "2026-10-30")).toBe("2026-11-03");
    // A block that is no longer valid, or starts later, is not a day to jump to.
    expect(nextScheduledDate([block(3, "08:00:00", "12:00:00", { validUntil: "2026-10-01" })], "dr", "main", "2026-10-26")).toBeNull();
    expect(nextScheduledDate([block(3, "08:00:00", "12:00:00", { validFrom: "2026-11-04" })], "dr", "main", "2026-10-26")).toBe("2026-11-04");
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
  ["dr-b", { id: "dr-b", userId: null, displayName: "Dr. Santos", profession: "physician", specialty: null, status: "active" }],
  ["dr-a", { id: "dr-a", userId: null, displayName: "Dr. Reyes", profession: "physician", specialty: null, status: "active" }],
]);
const visitTypes = new Map<string, VisitType>([
  [
    "vt",
    {
      id: "vt",
      code: "consult",
      name: "Consultation",
      defaultDurationMinutes: 15,
      modality: "in_person",
      status: "active",
      requiresTriage: true,
      onlineBooking: true,
      version: 1,
    },
  ],
  [
    "tele",
    {
      id: "tele",
      code: "tele",
      name: "Online consult",
      defaultDurationMinutes: 20,
      modality: "telemedicine",
      status: "active",
      requiresTriage: false,
      onlineBooking: false,
      version: 1,
    },
  ],
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
    expect(toAppointment({ ...appointment, bookedByPatient: true }, practitioners, visitTypes).reason).toBe(
      "Consultation · Booked online by the patient · BP follow-up",
    );
  });
});

describe("appointmentActions", () => {
  const context = { now: new Date("2026-09-27T00:30:00Z"), isToday: true, canManage: true, canCheckIn: true };

  it("offers check-in only today, and no-show only after the start", () => {
    const booked = { status: "booked" as const, startsAt: "2026-09-27T01:00:00Z" };
    expect(appointmentActions(booked, context)).toEqual(["check_in", "confirm", "reschedule", "cancel"]);
    expect(appointmentActions(booked, { ...context, now: new Date("2026-09-27T01:05:00Z") })).toEqual([
      "check_in",
      "confirm",
      "no_show",
      "reschedule",
      "cancel",
    ]);
    expect(appointmentActions(booked, { ...context, isToday: false })).toEqual(["confirm", "reschedule", "cancel"]);
  });

  it("leaves check-in of an online appointment to the patient's waiting room", () => {
    const booked = { status: "booked" as const, startsAt: "2026-09-27T01:00:00Z" };
    expect(appointmentActions(booked, { ...context, online: true })).toEqual(["confirm", "reschedule", "cancel"]);
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

describe("canStartConsultation", () => {
  it("allows starting before the consultation, not after", () => {
    expect(canStartConsultation("awaiting_consultation")).toBe(true);
    expect(canStartConsultation("waiting")).toBe(true);
    expect(canStartConsultation("in_consultation")).toBe(false);
    expect(canStartConsultation("cancelled")).toBe(false);
  });
});

describe("upcomingAppointments", () => {
  it("keeps open appointments that have not ended, in start order", () => {
    const at = (h: string) => `2026-09-27T${h}:00Z`;
    const rows = [
      { id: "later", status: "confirmed" as const, startsAt: at("05"), endsAt: at("06") },
      { id: "now", status: "booked" as const, startsAt: at("01"), endsAt: at("03") },
      { id: "past", status: "booked" as const, startsAt: at("00"), endsAt: at("01") },
      { id: "arrived", status: "checked_in" as const, startsAt: at("04"), endsAt: at("05") },
    ];
    expect(upcomingAppointments(rows, new Date(at("02"))).map((r) => r.id)).toEqual(["now", "later"]);
  });
});

describe("referral recipient", () => {
  it("names the practitioner referred to, or the outside provider and facility", () => {
    expect(referralRecipient({ kind: "internal", toPractitioner: { displayName: "Dr. Cruz" }, externalProvider: null, externalFacility: null })).toBe(
      "Dr. Cruz",
    );
    expect(referralRecipient({ kind: "external", toPractitioner: null, externalProvider: "Dr. Reyes", externalFacility: "Heart Center" })).toBe(
      "Dr. Reyes, Heart Center",
    );
  });
});

describe("zonedLocalToIso", () => {
  it("reads a wall-clock time in the facility's time zone", () => {
    expect(zonedLocalToIso("2026-10-01T09:30", "Asia/Manila")).toBe("2026-10-01T01:30:00.000Z");
    expect(zonedLocalToIso("2026-10-01T00:15", "Asia/Manila")).toBe("2026-09-30T16:15:00.000Z");
    expect(zonedLocalToIso("2026-07-01T09:00", "America/New_York")).toBe("2026-07-01T13:00:00.000Z");
    expect(() => zonedLocalToIso("2026-10-01 09:30", "Asia/Manila")).toThrow();
  });

  it("lays a day out by room: every active room, in name order, then bookings without a room", () => {
    const at = (h: number) => `2026-10-06T0${h}:00:00.000Z`;
    const rows = [
      { startsAt: at(3), room: { id: "r2", name: "Room 2" } },
      { startsAt: at(1), room: { id: "r2", name: "Room 2" } },
      { startsAt: at(2), room: null },
      { startsAt: at(4), room: { id: "old", name: "Old room" } },
    ];
    const rooms = [
      { id: "r2", name: "Room 2", status: "active" as const },
      { id: "r1", name: "Room 1", status: "active" as const },
      { id: "r9", name: "Storage", status: "inactive" as const },
    ];
    const columns = groupByRoom(rows, rooms);
    expect(columns.map((c) => [c.name, c.items.length])).toEqual([
      ["Room 1", 0],
      ["Room 2", 2],
      ["Old room", 1],
      ["No room", 1],
    ]);
    expect(columns[1]!.items.map((i) => i.startsAt)).toEqual([at(1), at(3)]);
    expect(groupByRoom([], rooms).map((c) => c.name)).toEqual(["Room 1", "Room 2"]);
  });
});
