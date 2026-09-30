import {
  autoNoShowDue,
  DEFAULT_BOOKING_RULES,
  onlineCheckInWindow,
  patientBookingWindow,
  patientMayChange,
  waitlistMatches,
  waitlistRangeProblem,
} from "./patient-booking";

const now = new Date("2026-09-28T01:00:00Z");
const inMinutes = (m: number) => new Date(now.getTime() + m * 60_000);

describe("patient booking rules", () => {
  it("needs two hours' notice", () => {
    expect(patientBookingWindow(inMinutes(119), now)).toBe("too_soon");
    expect(patientBookingWindow(inMinutes(120), now)).toBeNull();
  });

  it("books at most 60 days ahead", () => {
    expect(patientBookingWindow(inMinutes(60 * 24 * 60), now)).toBeNull();
    expect(patientBookingWindow(inMinutes(60 * 24 * 60 + 1), now)).toBe("too_far_ahead");
  });

  it("lets patients change an appointment until two hours before", () => {
    expect(patientMayChange(inMinutes(120), now)).toBe(true);
    expect(patientMayChange(inMinutes(119), now)).toBe(false);
    expect(patientMayChange(inMinutes(-10), now)).toBe(false);
  });

  it("follows a facility's own rules", () => {
    const strict = { ...DEFAULT_BOOKING_RULES, minLeadMinutes: 24 * 60, maxAdvanceDays: 14, changeCutoffMinutes: 48 * 60 };
    expect(patientBookingWindow(inMinutes(23 * 60), now, strict)).toBe("too_soon");
    expect(patientBookingWindow(inMinutes(24 * 60), now, strict)).toBeNull();
    expect(patientBookingWindow(inMinutes(15 * 24 * 60), now, strict)).toBe("too_far_ahead");
    expect(patientMayChange(inMinutes(47 * 60), now, strict)).toBe(false);
    expect(patientMayChange(inMinutes(48 * 60), now, strict)).toBe(true);
    expect(DEFAULT_BOOKING_RULES.waitlistEnabled).toBe(false);
  });
});

describe("waiting list rules", () => {
  const rules = DEFAULT_BOOKING_RULES;

  it("takes a range starting today or later, within the horizon, of at most two weeks", () => {
    expect(waitlistRangeProblem("2026-10-01", "2026-10-01", "2026-09-28", rules)).toBeNull();
    expect(waitlistRangeProblem("2026-09-28", "2026-10-11", "2026-09-28", rules)).toBeNull();
    expect(waitlistRangeProblem("2026-09-28", "2026-10-12", "2026-09-28", rules)).toBe("too_wide");
    expect(waitlistRangeProblem("2026-10-05", "2026-10-01", "2026-09-28", rules)).toBe("invalid_range");
    expect(waitlistRangeProblem("2026-09-27", "2026-09-29", "2026-09-28", rules)).toBe("in_the_past");
    expect(waitlistRangeProblem("2026-12-20", "2026-12-21", "2026-09-28", rules)).toBe("too_far_ahead");
    expect(waitlistRangeProblem("2026-11-27", "2026-11-27", "2026-09-28", rules)).toBeNull();
  });

  it("matches a freed time by date, doctor and visit type, with 'any' when unset", () => {
    const entry = { earliestDate: "2026-10-01", latestDate: "2026-10-03", practitionerId: null, visitTypeId: "vt1" };
    expect(waitlistMatches(entry, { date: "2026-10-02", practitionerId: "dr1", visitTypeId: "vt1" })).toBe(true);
    expect(waitlistMatches(entry, { date: "2026-10-04", practitionerId: "dr1", visitTypeId: "vt1" })).toBe(false);
    expect(waitlistMatches(entry, { date: "2026-10-02", practitionerId: "dr1", visitTypeId: "vt2" })).toBe(false);
    expect(waitlistMatches({ ...entry, practitionerId: "dr2" }, { date: "2026-10-02", practitionerId: "dr1", visitTypeId: "vt1" })).toBe(false);
    expect(waitlistMatches({ ...entry, visitTypeId: null }, { date: "2026-10-02", practitionerId: "dr1", visitTypeId: "vt9" })).toBe(true);
  });
});

describe("online check-in and automatic no-shows", () => {
  const start = new Date("2026-10-01T02:00:00Z"); // 10:00 in Manila
  const on = { ...DEFAULT_BOOKING_RULES, onlineCheckIn: true, checkInOpensMinutes: 60, checkInClosesMinutes: 15 };
  const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

  it("offers online check-in only where the clinic turned it on, within its window", () => {
    expect(onlineCheckInWindow(start, at(-30), DEFAULT_BOOKING_RULES)).toBe("not_offered");
    expect(onlineCheckInWindow(start, at(-61), on)).toBe("too_early");
    expect(onlineCheckInWindow(start, at(-60), on)).toBeNull();
    expect(onlineCheckInWindow(start, at(15), on)).toBeNull();
    expect(onlineCheckInWindow(start, at(16), on)).toBe("too_late");
  });

  it("marks an unattended appointment only after the clinic's hour on its own day", () => {
    const rules = { ...DEFAULT_BOOKING_RULES, autoNoShow: true, autoNoShowHour: 20 };
    const appointment = { endsAt: at(30), dayStart: new Date("2026-09-30T16:00:00Z") }; // Oct 1, 00:00 Manila
    expect(autoNoShowDue(appointment, new Date("2026-10-01T11:59:00Z"), rules)).toBe(false); // 19:59
    expect(autoNoShowDue(appointment, new Date("2026-10-01T12:00:00Z"), rules)).toBe(true); // 20:00
    expect(autoNoShowDue(appointment, new Date("2026-10-02T01:00:00Z"), rules)).toBe(true); // the next morning
    expect(autoNoShowDue(appointment, new Date("2026-10-01T12:00:00Z"), DEFAULT_BOOKING_RULES)).toBe(false);
    // An evening appointment that has not ended yet is left alone.
    expect(autoNoShowDue({ ...appointment, endsAt: new Date("2026-10-01T12:30:00Z") }, new Date("2026-10-01T12:10:00Z"), rules)).toBe(false);
  });
});
