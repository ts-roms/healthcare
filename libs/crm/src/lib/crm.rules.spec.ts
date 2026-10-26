import {
  bookingLinkText,
  bookingLinkUrl,
  canApprove,
  canTransition,
  capReached,
  isDueToSend,
  quietHoldUntil,
  segmentCriteriaSchema,
  summarizeReach,
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
