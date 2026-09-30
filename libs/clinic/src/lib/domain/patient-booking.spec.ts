import { DEFAULT_BOOKING_RULES, patientBookingWindow, patientMayChange, waitlistMatches, waitlistRangeProblem } from "./patient-booking";

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
