import { canApprove, canTransition, isDueToSend, segmentCriteriaSchema, wordingProblems } from "./crm.rules";

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
