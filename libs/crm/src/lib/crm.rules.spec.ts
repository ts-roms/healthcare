import {
  approvalReminderDue,
  bookingLinkText,
  bookingLinkUrl,
  canApprove,
  canSeriesTransition,
  canTransition,
  capReached,
  firstAvailableChannel,
  firstNameOf,
  isDueToSend,
  nextOccurrence,
  plannedChannels,
  prioritized,
  quietHoldUntil,
  renderedLength,
  renderWording,
  type Schedule,
  scheduleProblems,
  segmentCriteriaSchema,
  summarizeReach,
  unknownPlaceholders,
  wordingProblems,
} from "./crm.rules";

describe("outreach rules", () => {
  it("accepts non-clinical criteria only and needs at least one", () => {
    expect(segmentCriteriaSchema.safeParse({ ageMin: 50, sex: "female", cityMunicipality: "Makati City" }).success).toBe(true);
    expect(segmentCriteriaSchema.safeParse({}).success).toBe(false);
    expect(segmentCriteriaSchema.safeParse({ ageMin: 60, ageMax: 50 }).success).toBe(false);
    expect(segmentCriteriaSchema.safeParse({ lastVisitBefore: "2026-01-01", noVisitForMonths: 6 }).success).toBe(false);
    // No diagnosis, result or medication criterion exists.
    expect(segmentCriteriaSchema.safeParse({ diagnosisCode: "E11" }).success).toBe(false);
  });

  it("checks the wording against each channel", () => {
    expect(wordingProblems({ channels: ["sms"], subject: null, body: "Flu shots are available this month. Call the clinic." })).toEqual([]);
    expect(wordingProblems({ channels: ["sms"], subject: null, body: "x".repeat(321) }).map((p) => p.channel)).toEqual(["sms"]);
    expect(wordingProblems({ channels: ["email"], subject: null, body: "Hello there" }).map((p) => p.channel)).toEqual(["subject"]);
    expect(wordingProblems({ channels: ["push"], subject: null, body: "x".repeat(161) })).toHaveLength(1);
  });

  it("moves a campaign through submission and approval by a second person", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
    expect(canTransition("submitted", "approved")).toBe(true);
    expect(canTransition("approved", "sending")).toBe(true);
    expect(canTransition("completed", "cancelled")).toBe(false);
    expect(canTransition("sending", "cancelled")).toBe(false);
    expect(canApprove({ createdBy: "a", submittedBy: "a" }, "a")).toBe(false);
    expect(canApprove({ createdBy: "a", submittedBy: "b" }, "b")).toBe(false);
    expect(canApprove({ createdBy: "a", submittedBy: "b" }, "c")).toBe(true);
  });

  it("sends approved campaigns at their time, or at once without one", () => {
    const now = new Date("2026-10-02T06:00:00Z");
    expect(isDueToSend({ status: "approved", sendAt: null }, now)).toBe(true);
    expect(isDueToSend({ status: "approved", sendAt: new Date("2026-10-02T05:00:00Z") }, now)).toBe(true);
    expect(isDueToSend({ status: "approved", sendAt: new Date("2026-10-02T07:00:00Z") }, now)).toBe(false);
    expect(isDueToSend({ status: "submitted", sendAt: null }, now)).toBe(false);
  });
});

describe("segment criteria beyond age and place", () => {
  it("accepts a birth month, a MyHealth state, a registering facility and a number on file", () => {
    expect(segmentCriteriaSchema.safeParse({ birthMonth: 5 }).success).toBe(true);
    expect(segmentCriteriaSchema.safeParse({ myHealth: "not_active" }).success).toBe(true);
    expect(segmentCriteriaSchema.safeParse({ identifierOnFile: "philhealth_pin", myHealth: "active" }).success).toBe(true);
    expect(segmentCriteriaSchema.safeParse({ registeredFacilityId: "3f1c7f0e-6a55-4d3e-9a62-1b0f2c8a9d11" }).success).toBe(true);
  });

  it("refuses anything that is not one of them: a month out of range, another number, a facility that is not an id", () => {
    expect(segmentCriteriaSchema.safeParse({ birthMonth: 13 }).success).toBe(false);
    expect(segmentCriteriaSchema.safeParse({ birthMonth: 0 }).success).toBe(false);
    expect(segmentCriteriaSchema.safeParse({ identifierOnFile: "passport" }).success).toBe(false);
    expect(segmentCriteriaSchema.safeParse({ myHealth: "maybe" }).success).toBe(false);
    expect(segmentCriteriaSchema.safeParse({ registeredFacilityId: "main" }).success).toBe(false);
    expect(segmentCriteriaSchema.safeParse({ birthYear: 1980 }).success).toBe(false);
  });
});

describe("outreach limits and reach", () => {
  const night = { start: "22:00", end: "07:00" };

  it("holds a message that falls in quiet hours until they end, across midnight (Asia/Manila is UTC+8)", () => {
    // 23:00 in Manila: held until 07:00 the next morning (23:00 UTC).
    expect(quietHoldUntil(new Date("2026-10-26T15:00:00Z"), night)?.toISOString()).toBe("2026-10-26T23:00:00.000Z");
    // 04:30 in Manila: held for two and a half hours.
    expect(quietHoldUntil(new Date("2026-10-26T20:30:00Z"), night)?.toISOString()).toBe("2026-10-26T23:00:00.000Z");
    // The period starts at 22:00 and ends at 07:00 (the end is already allowed).
    expect(quietHoldUntil(new Date("2026-10-26T14:00:00Z"), night)?.toISOString()).toBe("2026-10-26T23:00:00.000Z");
    expect(quietHoldUntil(new Date("2026-10-26T23:00:00Z"), night)).toBeNull();
    expect(quietHoldUntil(new Date("2026-10-27T02:00:00Z"), night)).toBeNull();
    expect(quietHoldUntil(new Date("2026-10-26T13:59:59Z"), night)).toBeNull();
  });

  it("handles a quiet period inside one day", () => {
    const lunch = { start: "12:00", end: "13:00" };
    expect(quietHoldUntil(new Date("2026-10-26T04:30:00Z"), lunch)?.toISOString()).toBe("2026-10-26T05:00:00.000Z");
    expect(quietHoldUntil(new Date("2026-10-26T05:00:00Z"), lunch)).toBeNull();
  });

  it("holds a patient back only when the cap is set and already reached", () => {
    expect(capReached(5, null)).toBe(false);
    expect(capReached(0, { maxCampaigns: 1, windowDays: 14 })).toBe(false);
    expect(capReached(1, { maxCampaigns: 1, windowDays: 14 })).toBe(true);
    expect(capReached(2, { maxCampaigns: 3, windowDays: 30 })).toBe(false);
  });

  it("tallies who can be reached on each channel and why the others cannot, most common reason first", () => {
    const yes = { allowed: true } as const;
    const no = (reason: string) => ({ allowed: false, reason }) as const;
    const summary = summarizeReach(
      ["sms", "email"],
      [
        { sms: yes, email: no("no_email_address") },
        { sms: no("no_outreach_opt_in"), email: no("no_outreach_opt_in") },
        { sms: no("no_outreach_opt_in"), email: no("no_email_address") },
      ],
      5,
    );
    expect(summary).toEqual({
      evaluated: 3,
      sampled: true,
      byChannel: [
        { channel: "sms", reachable: 1, notReached: [{ reason: "no_outreach_opt_in", total: 2 }] },
        {
          channel: "email",
          reachable: 0,
          notReached: [
            { reason: "no_email_address", total: 2 },
            { reason: "no_outreach_opt_in", total: 1 },
          ],
        },
      ],
      reachableOnAny: 1,
      unreachable: 2,
    });
    expect(summarizeReach(["sms"], [], 0)).toMatchObject({ evaluated: 0, sampled: false, reachableOnAny: 0, unreachable: 0 });
  });

  it("adds the booking link after the body and counts it against each channel's length", () => {
    expect(bookingLinkUrl("https://myhealth.example.ph/")).toBe("https://myhealth.example.ph/appointments/book");
    expect(bookingLinkText("https://myhealth.example.ph")).toBe("\n\nBook a visit: https://myhealth.example.ph/appointments/book");
    const reserved = bookingLinkText("https://myhealth.example.ph").length;
    expect(wordingProblems({ channels: ["sms"], subject: null, body: "x".repeat(300) })).toEqual([]);
    expect(wordingProblems({ channels: ["sms"], subject: null, body: "x".repeat(300), reservedChars: reserved }).map((p) => p.channel)).toEqual(["sms"]);
  });
});

describe("wording variables", () => {
  it("fills in the first name and the clinic's name, and nothing else", () => {
    expect(renderWording("Hello {{firstName}}, {{ clinicName }} has flu shots.", { firstName: "Maria", clinicName: "Demo Health" })).toBe(
      "Hello Maria, Demo Health has flu shots.",
    );
    expect(unknownPlaceholders("Hi {{firstName}}, your balance is {{balance}} {{ Diagnosis }}")).toEqual(["balance", "Diagnosis"]);
    expect(unknownPlaceholders("Hello {{firstName}} at {{clinicName}}")).toEqual([]);
  });

  it("shows a first name that is short and never empty", () => {
    expect(firstNameOf("Juan Carlos")).toBe("Juan");
    expect(firstNameOf("  Maria  ")).toBe("Maria");
    expect(firstNameOf("")).toBe("there");
    expect(firstNameOf(null)).toBe("there");
    expect(firstNameOf("A".repeat(50))).toHaveLength(30);
  });

  it("checks the length with the longest first name, so what was approved always fits", () => {
    expect(renderedLength("Hi {{firstName}}", "Demo")).toBe(3 + 30);
    expect(renderedLength("{{clinicName}}", "Demo Health")).toBe("Demo Health".length);
    // 310 characters including the placeholder fit a text message as typed (limit 320) but not with a 30-letter name.
    const body = `${"x".repeat(297)}{{firstName}}`;
    expect(body.length).toBe(310);
    expect(wordingProblems({ channels: ["sms"], subject: null, body, clinicName: "Demo" }).map((p) => p.channel)).toEqual(["sms"]);
    expect(wordingProblems({ channels: ["email"], subject: "Hi {{firstName}}", body, clinicName: "Demo" })).toEqual([]);
  });

  it("refuses a placeholder the platform does not fill in", () => {
    const problems = wordingProblems({ channels: ["sms"], subject: null, body: "Dear {{firstName}}, your result {{labResult}} is ready.", clinicName: "Demo" });
    expect(problems).toEqual([{ channel: "body", message: expect.stringContaining("{{labResult}}") }]);
  });
});

describe("one message per patient", () => {
  const yes = { allowed: true } as const;
  const no = { allowed: false, reason: "no_outreach_opt_in" } as const;

  it("tries push, then text message, then email, then the MyHealth inbox", () => {
    expect(prioritized(["email", "sms", "in_app", "push"])).toEqual(["push", "sms", "email", "in_app"]);
    expect(firstAvailableChannel(["email", "sms"], { sms: yes, email: yes })).toBe("sms");
    expect(firstAvailableChannel(["email", "sms"], { sms: no, email: yes })).toBe("email");
    expect(firstAvailableChannel(["sms", "push"], { sms: yes, push: yes })).toBe("push");
    expect(firstAvailableChannel(["sms", "email"], { sms: no, email: no })).toBeNull();
  });

  it("counts how many patients each channel would carry, and how many none reaches", () => {
    expect(
      plannedChannels(
        ["email", "sms"],
        [
          { sms: yes, email: yes },
          { sms: no, email: yes },
          { sms: no, email: no },
          { sms: yes, email: no },
        ],
      ),
    ).toEqual({
      byChannel: [
        { channel: "sms", total: 2 },
        { channel: "email", total: 1 },
      ],
      none: 1,
    });
  });
});

describe("approval reminders", () => {
  const submitted = new Date("2026-10-20T08:00:00Z");
  const waiting = { status: "submitted", submittedAt: submitted, approvalRemindedAt: null };

  it("reminds once, after two days, only for a campaign still waiting", () => {
    expect(approvalReminderDue(waiting, new Date("2026-10-21T08:00:00Z"))).toBe(false);
    expect(approvalReminderDue(waiting, new Date("2026-10-22T08:00:00Z"))).toBe(true);
    expect(approvalReminderDue({ ...waiting, approvalRemindedAt: new Date("2026-10-22T09:00:00Z") }, new Date("2026-10-30T08:00:00Z"))).toBe(false);
    expect(approvalReminderDue({ ...waiting, status: "approved" }, new Date("2026-10-30T08:00:00Z"))).toBe(false);
    expect(approvalReminderDue({ ...waiting, status: "draft", submittedAt: null }, new Date("2026-10-30T08:00:00Z"))).toBe(false);
  });
});

describe("recurring schedules", () => {
  // 2026-10-26 is a Monday; Manila is UTC+8, so 09:00 there is 01:00 UTC.
  const mondays: Schedule = { cadence: "weekly", weekday: 1, dayOfMonth: null, sendTime: "09:00", startsOn: "2026-10-26", endsOn: null };
  const fifteenth: Schedule = { cadence: "monthly", weekday: null, dayOfMonth: 15, sendTime: "21:30", startsOn: "2026-10-01", endsOn: null };

  it("finds the next weekly occurrence strictly after a moment, never before the first day", () => {
    expect(nextOccurrence(mondays, new Date("2026-10-20T00:00:00Z"))?.toISOString()).toBe("2026-10-26T01:00:00.000Z");
    expect(nextOccurrence(mondays, new Date("2026-10-26T00:59:00Z"))?.toISOString()).toBe("2026-10-26T01:00:00.000Z");
    expect(nextOccurrence(mondays, new Date("2026-10-26T01:00:00Z"))?.toISOString()).toBe("2026-11-02T01:00:00.000Z");
    expect(nextOccurrence(mondays, new Date("2026-10-31T10:00:00Z"))?.toISOString()).toBe("2026-11-02T01:00:00.000Z");
  });

  it("finds the next monthly occurrence, on the local day (a late evening in Manila is the same day in UTC)", () => {
    expect(nextOccurrence(fifteenth, new Date("2026-10-10T00:00:00Z"))?.toISOString()).toBe("2026-10-15T13:30:00.000Z");
    expect(nextOccurrence(fifteenth, new Date("2026-10-15T13:30:00Z"))?.toISOString()).toBe("2026-11-15T13:30:00.000Z");
    expect(nextOccurrence({ ...fifteenth, sendTime: "23:30" }, new Date("2026-10-15T00:00:00Z"))?.toISOString()).toBe("2026-10-15T15:30:00.000Z");
  });

  it("stops after the last day", () => {
    const ending = { ...mondays, endsOn: "2026-11-01" };
    expect(nextOccurrence(ending, new Date("2026-10-26T01:00:00Z"))).toBeNull();
    expect(nextOccurrence({ ...mondays, endsOn: "2026-11-02" }, new Date("2026-10-26T01:00:00Z"))?.toISOString()).toBe("2026-11-02T01:00:00.000Z");
    expect(nextOccurrence({ ...mondays, endsOn: "2026-10-25" }, new Date("2026-10-01T00:00:00Z"))).toBeNull();
  });

  it("names what is wrong with a schedule being drafted", () => {
    const ok = { cadence: "weekly" as const, weekday: 1, dayOfMonth: null, sendTime: "09:00", startsOn: "2026-10-27", endsOn: null };
    expect(scheduleProblems(ok, "2026-10-26")).toEqual([]);
    expect(scheduleProblems({ ...ok, weekday: null }, "2026-10-26")).toEqual(["Choose the day of the week"]);
    expect(scheduleProblems({ ...ok, startsOn: "2026-10-01" }, "2026-10-26")).toEqual(["The first day cannot be in the past"]);
    expect(scheduleProblems({ ...ok, sendTime: "9am" }, "2026-10-26")).toEqual(["Give the time of day, like 09:00"]);
    expect(scheduleProblems({ ...ok, endsOn: "2026-10-01" }, "2026-10-26")).toEqual(["The last day is before the first day"]);
    expect(scheduleProblems({ ...ok, cadence: "monthly", weekday: 1, dayOfMonth: 5 }, "2026-10-26")).toEqual(["A monthly schedule has no day of the week"]);
  });

  it("moves a recurring campaign through approval, pause and end, and changes only by going back to a draft", () => {
    expect(canSeriesTransition("draft", "submitted")).toBe(true);
    expect(canSeriesTransition("submitted", "active")).toBe(true);
    expect(canSeriesTransition("active", "paused")).toBe(true);
    expect(canSeriesTransition("paused", "active")).toBe(true);
    expect(canSeriesTransition("paused", "draft")).toBe(true);
    expect(canSeriesTransition("active", "draft")).toBe(false);
    expect(canSeriesTransition("ended", "active")).toBe(false);
    expect(canSeriesTransition("cancelled", "draft")).toBe(false);
  });
});
