import { DAYS_OF_COVER_RULE, daysOfCoverSuggestions, type DaysOfCoverInput } from "./days-of-cover.rules";

const params = { windowDays: 30, leadTimeDays: 14, targetCoverDays: 30, minIssues: 5 };
const item = (over: Partial<DaysOfCoverInput> = {}): DaysOfCoverInput => ({
  itemId: "i1",
  code: "para",
  name: "Paracetamol 500 mg",
  stockUnit: "tablet",
  usable: 100,
  onOrder: 0,
  issued: 600, // 20 a day
  issues: 12,
  ...over,
});

describe("inventory.days-of-cover", () => {
  it("flags stock that will not outlast the delivery time and suggests a quantity", () => {
    const [s] = daysOfCoverSuggestions([item()], params);
    expect(s).toMatchObject({ ruleId: "inventory.days-of-cover", ruleVersion: 1, strength: "matched", basis: "statistic", severity: "warning" });
    // 5 days of cover; a 30-day target at 20 a day is 600, less the 100 in hand.
    expect(s!.title).toContain("5 days");
    expect(s!.rationale).toContain("Ordering 500 tablet");
    expect(s!.evidence.length).toBeGreaterThan(0);
    expect(s!.id).toBe("inventory.days-of-cover@1:item:i1");
  });

  it("stays silent when stock lasts, when nothing was issued, or when there is too little history", () => {
    expect(daysOfCoverSuggestions([item({ usable: 1000 })], params)).toEqual([]);
    expect(daysOfCoverSuggestions([item({ issued: 0, issues: 0 })], params)).toEqual([]);
    expect(daysOfCoverSuggestions([item({ issues: 1 })], params)).toEqual([]);
  });

  it("counts what is on order, and shows a thin history as a weak signal", () => {
    expect(daysOfCoverSuggestions([item({ onOrder: 900 })], params)).toEqual([]);
    const [weak] = daysOfCoverSuggestions([item({ issues: 3 })], params);
    expect(weak!.strength).toBe("weak");
  });

  it("calls it advice rather than a warning when cover is past half the delivery time", () => {
    const [s] = daysOfCoverSuggestions([item({ usable: 200 })], params); // 10 days of 14
    expect(s!.severity).toBe("advice");
  });

  it("accepts its default parameters", () => {
    expect(DAYS_OF_COVER_RULE.parametersSchema.safeParse(DAYS_OF_COVER_RULE.defaultParameters).success).toBe(true);
    expect(DAYS_OF_COVER_RULE.parametersSchema.safeParse({ ...params, windowDays: 1 }).success).toBe(false);
  });
});
