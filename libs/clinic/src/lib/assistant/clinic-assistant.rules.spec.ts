import { NO_SHOW_RISK_RULE, noShowRiskSuggestions } from "./no-show-risk.rules";
import { QUEUE_WAIT_RULE, queueWaitSuggestions } from "./queue-wait.rules";

describe("clinic.no-show-risk", () => {
  const params = { historyDays: 730, minAppointments: 3, missedPercent: 34 };
  const appt = (over: Partial<Parameters<typeof noShowRiskSuggestions>[0][number]> = {}) => ({
    appointmentId: "a1",
    startsAt: "2026-11-20T02:30:00Z", // 10:30 in Manila
    date: "2026-11-20",
    confirmed: false,
    attended: 2,
    missed: 2,
    ...over,
  });

  it("flags an appointment whose patient missed a large share, by time and never by name", () => {
    const [s] = noShowRiskSuggestions([appt()], params, "Asia/Manila");
    expect(s).toMatchObject({ ruleId: "clinic.no-show-risk", severity: "advice", strength: "weak" });
    expect(s!.title).toBe("10:30 AM appointment: the patient missed 2 of their last 4 appointments");
    expect(s!.action!.href).toBe("/appointments?date=2026-11-20&appointmentId=a1");
  });

  it("is only information for a confirmed appointment", () => {
    expect(noShowRiskSuggestions([appt({ confirmed: true })], params, "Asia/Manila")[0]!.severity).toBe("info");
  });

  it("needs enough history and a large enough share", () => {
    expect(noShowRiskSuggestions([appt({ attended: 1, missed: 1 })], params, "Asia/Manila")).toEqual([]);
    expect(noShowRiskSuggestions([appt({ attended: 9, missed: 1 })], params, "Asia/Manila")).toEqual([]);
    expect(noShowRiskSuggestions([appt({ attended: 6, missed: 0 })], params, "Asia/Manila")).toEqual([]);
  });

  it("lists the day in order of time", () => {
    const list = noShowRiskSuggestions(
      [appt({ appointmentId: "late", startsAt: "2026-11-20T07:00:00Z" }), appt({ appointmentId: "early" })],
      params,
      "Asia/Manila",
    );
    expect(list.map((s) => s.evidence[0]!.resourceId)).toEqual(["early", "late"]);
  });

  it("accepts its default parameters", () => {
    expect(NO_SHOW_RISK_RULE.parametersSchema.safeParse(NO_SHOW_RISK_RULE.defaultParameters).success).toBe(true);
  });
});

describe("clinic.queue-wait", () => {
  const params = { historyDays: 28, minVisits: 20, percentile: 90 };
  const past = Array.from({ length: 40 }, (_, i) => 5 + (i % 20)); // 5–24 minutes
  const type = (waitingNow: number[], pastWaits = past) => ({ visitTypeId: "vt1", visitTypeName: "General consultation", pastWaits, waitingNow });

  it("flags patients waiting beyond the usual wait for their visit type", () => {
    const [s] = queueWaitSuggestions([type([10, 30, 60])], params, "2026-11-20");
    expect(s).toMatchObject({ ruleId: "clinic.queue-wait", severity: "warning", strength: "matched" });
    expect(s!.action).toBeUndefined();
    expect(s!.title).toBe("General consultation: 2 patients have waited longer than usual");
    expect(s!.evidence.map((e) => e.value)).toEqual(["22 min", "2, longest 60 min"]);
    expect(s!.id).toBe("clinic.queue-wait@1:visit-type:vt1:2026-11-20");
  });

  it("stays silent within the usual wait or without enough past visits", () => {
    expect(queueWaitSuggestions([type([5, 20])], params, "2026-11-20")).toEqual([]);
    expect(queueWaitSuggestions([type([90], past.slice(0, 10))], params, "2026-11-20")).toEqual([]);
  });

  it("accepts its default parameters", () => {
    expect(QUEUE_WAIT_RULE.parametersSchema.safeParse(QUEUE_WAIT_RULE.defaultParameters).success).toBe(true);
  });
});
