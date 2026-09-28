import { competencyFor, isExcursion, missingToClose, readingOverdue } from "./quality-management.rules";

describe("temperature monitoring", () => {
  it("flags readings outside the unit's range, limits inclusive", () => {
    expect(isExcursion(4, 2, 8)).toBe(false);
    expect(isExcursion(2, 2, 8)).toBe(false);
    expect(isExcursion(8, 2, 8)).toBe(false);
    expect(isExcursion(8.1, 2, 8)).toBe(true);
    expect(isExcursion(-21, -20, -15)).toBe(true);
  });

  it("knows when a reading is due", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    expect(readingOverdue(null, null, now)).toBe(false);
    expect(readingOverdue(null, 12, now)).toBe(true);
    expect(readingOverdue(new Date("2026-09-28T01:00:00Z"), 12, now)).toBe(false);
    expect(readingOverdue(new Date("2026-09-27T23:00:00Z"), 12, now)).toBe(true);
  });
});

describe("nonconformance closing", () => {
  it("needs root cause, corrective action and an effectiveness check", () => {
    expect(missingToClose(["note", "correction"])).toEqual(["root cause", "corrective action", "effectiveness check"]);
    expect(missingToClose(["root_cause", "corrective_action"])).toEqual(["effectiveness check"]);
    expect(missingToClose(["root_cause", "corrective_action", "effectiveness_check"])).toEqual([]);
  });
});

describe("competency", () => {
  const test = { id: "glu", departmentId: "chem" };
  const at = (day: string) => new Date(`${day}T08:00:00Z`);
  const a = (over: Partial<Parameters<typeof competencyFor>[0][number]>) => ({
    testId: null,
    departmentId: "chem",
    outcome: "competent" as const,
    assessedOn: "2026-01-10",
    nextDueOn: "2027-01-10",
    recordedAt: at("2026-01-10"),
    ...over,
  });

  it("uses the department's assessment when the test has none, until it is due", () => {
    expect(competencyFor([a({})], test, "2026-09-28").state).toBe("competent");
    expect(competencyFor([a({})], test, "2027-01-10").state).toBe("competent");
    expect(competencyFor([a({})], test, "2027-01-11").state).toBe("due");
    expect(competencyFor([a({ departmentId: "hema" })], test, "2026-09-28").state).toBe("not_assessed");
  });

  it("prefers the test's own latest assessment", () => {
    const failed = a({ testId: "glu", departmentId: null, outcome: "not_yet_competent", assessedOn: "2026-05-01", recordedAt: at("2026-05-01") });
    expect(competencyFor([a({}), failed], test, "2026-09-28").state).toBe("not_yet_competent");
    const passed = a({ testId: "glu", departmentId: null, assessedOn: "2026-06-01", recordedAt: at("2026-06-01"), nextDueOn: null });
    expect(competencyFor([a({}), failed, passed], test, "2030-01-01")).toMatchObject({ state: "competent", assessment: passed });
  });
});
