import {
  autoNoShowDue,
  DEFAULT_BOOKING_RULES,
  onlineCheckInWindow,
  patientBookingWindow,
  patientMayChange,
  waitlistMatches,
  waitlistRangeProblem,
  resolveWaitlistRule,
  offerCandidates,
  offerExpiry,
  offerable,
  type OfferCandidate,
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

  describe("waiting-list rules per visit type or practitioner (0096)", () => {
    const facility = { waitlistEnabled: true, maxWaitlistEntries: 3, maxAdvanceDays: 60 };
    const forType = { scope: "visit_type" as const, visitTypeId: "vt", practitionerId: null, enabled: false, maxEntries: 1, maxDaysAhead: null };
    const forDoctor = { scope: "practitioner" as const, visitTypeId: null, practitionerId: "dr", enabled: true, maxEntries: 5, maxDaysAhead: 90 };

    it("falls back to the facility's rule", () => {
      expect(resolveWaitlistRule(facility, [], { visitTypeId: "vt", practitionerId: null })).toEqual({
        enabled: true,
        maxEntries: 3,
        maxDaysAhead: 60,
        source: "facility",
      });
      expect(resolveWaitlistRule(facility, [forType], { visitTypeId: "other", practitionerId: "x" })).toMatchObject({ source: "facility" });
    });

    it("applies a visit type's rule, and a practitioner's over it; a rule's horizon never exceeds the facility's", () => {
      expect(resolveWaitlistRule(facility, [forType], { visitTypeId: "vt", practitionerId: null })).toEqual({
        enabled: false,
        maxEntries: 1,
        maxDaysAhead: 60,
        source: "visit_type",
      });
      expect(resolveWaitlistRule(facility, [forType, forDoctor], { visitTypeId: "vt", practitionerId: "dr" })).toEqual({
        enabled: true,
        maxEntries: 5,
        maxDaysAhead: 60,
        source: "practitioner",
      });
      expect(resolveWaitlistRule({ ...facility, maxAdvanceDays: 120 }, [forDoctor], { visitTypeId: null, practitionerId: "dr" }).maxDaysAhead).toBe(90);
    });
  });

  describe("offers from the waiting list (0096)", () => {
    const entry = (id: string, over: Partial<OfferCandidate> = {}): OfferCandidate => ({
      id,
      patientId: `p-${id}`,
      priority: "routine",
      createdAt: new Date("2026-09-01T00:00:00Z"),
      earliestDate: "2026-10-05",
      latestDate: "2026-10-07",
      practitionerId: null,
      visitTypeId: null,
      ...over,
    });
    const opened = { date: "2026-10-06", practitionerId: "dr", visitTypeId: "vt", freedByPatientId: "p-c" };

    it("offers to matching entries, urgent first then oldest, never the patient who freed it nor one already offered that day", () => {
      const entries = [
        entry("a", { createdAt: new Date("2026-09-02T00:00:00Z") }),
        entry("b", { priority: "soon", createdAt: new Date("2026-09-03T00:00:00Z") }),
        entry("c"),
        entry("d", { practitionerId: "other" }),
        entry("e", { earliestDate: "2026-10-08", latestDate: "2026-10-09" }),
        entry("f", { createdAt: new Date("2026-08-01T00:00:00Z") }),
      ];
      expect(offerCandidates(entries, opened, new Set(["f"]), 2).map((e) => e.id)).toEqual(["b", "a"]);
      expect(offerCandidates(entries, opened, new Set(), 10).map((e) => e.id)).toEqual(["b", "f", "a"]);
      expect(offerCandidates(entries, opened, new Set(), 0)).toHaveLength(1);
    });

    it("holds a time for the facility's hold, but never past the online lead time before the start", () => {
      const now = new Date("2026-10-06T00:00:00Z");
      const rules = { offerHoldMinutes: 120, minLeadMinutes: 120 };
      expect(offerExpiry(now, new Date("2026-10-06T08:00:00Z"), rules)).toEqual(new Date("2026-10-06T02:00:00Z"));
      expect(offerExpiry(now, new Date("2026-10-06T03:00:00Z"), rules)).toEqual(new Date("2026-10-06T01:00:00Z"));
      expect(offerable(now, new Date("2026-10-06T08:00:00Z"), rules)).toBe(true);
      expect(offerable(now, new Date("2026-10-06T02:00:30Z"), rules)).toBe(false);
    });
  });
});
