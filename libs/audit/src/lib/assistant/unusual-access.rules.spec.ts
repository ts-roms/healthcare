import { UNUSUAL_ACCESS_RULE, unusualAccessSuggestions, unusualReasons, type UnusualAccessInput } from "./unusual-access.rules";

const params = UNUSUAL_ACCESS_RULE.defaultParameters;
const account = (over: Partial<UnusualAccessInput> = {}): UnusualAccessInput => ({
  userId: "u1",
  displayName: "Maria Santos",
  patients: 20,
  usualDays: [18, 22, 20, 25, 19, 21],
  offHoursPatients: 0,
  denials: 0,
  ...over,
});

describe("security.unusual-access", () => {
  it("says nothing about an ordinary day", () => {
    expect(unusualAccessSuggestions([account()], params, "2026-11-20")).toEqual([]);
  });

  it("flags many more patients than the account's usual day, naming the account and linking to its audit trail", () => {
    const [s] = unusualAccessSuggestions([account({ patients: 140 })], params, "2026-11-20");
    expect(s).toMatchObject({ ruleId: "security.unusual-access", severity: "advice", strength: "matched", action: { href: "/admin/audit?actor=u1" } });
    expect(s!.title).toBe("Maria Santos: opened 140 patients' records in 24 hours, against about 21 on a usual day");
    expect(s!.id).toBe("security.unusual-access@1:user:u1:2026-11-20");
  });

  it("needs both the multiple and the minimum for volume", () => {
    expect(unusualReasons(account({ patients: 45, usualDays: [5, 5, 5, 5, 5] }), params).reasons).toEqual([]);
    expect(unusualReasons(account({ patients: 60 }), params).reasons).toEqual([]);
  });

  it("flags volume without history as weak, and off-hours and refusals on their own", () => {
    const [weak] = unusualAccessSuggestions([account({ patients: 80, usualDays: [] })], params, "2026-11-20");
    expect(weak!.strength).toBe("weak");
    expect(unusualReasons(account({ offHoursPatients: 6 }), params).reasons).toEqual(["opened 6 patients' records outside 7:00–19:00"]);
    expect(unusualReasons(account({ denials: 12 }), params).reasons).toEqual(["was refused 12 times"]);
  });

  it("warns when an account stands out in two ways", () => {
    const [s] = unusualAccessSuggestions([account({ offHoursPatients: 9, denials: 15 })], params, "2026-11-20");
    expect(s!.severity).toBe("warning");
    expect(s!.rationale).toContain("Also was refused 15 times.");
  });

  it("accepts its default parameters", () => {
    expect(UNUSUAL_ACCESS_RULE.parametersSchema.safeParse(UNUSUAL_ACCESS_RULE.defaultParameters).success).toBe(true);
    expect(UNUSUAL_ACCESS_RULE.parametersSchema.safeParse({ ...params, workStartHour: 19, workEndHour: 7 }).success).toBe(false);
  });
});
