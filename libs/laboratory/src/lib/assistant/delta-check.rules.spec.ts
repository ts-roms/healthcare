import { DELTA_CHECK_RULE, deltaCheckSuggestions, percentChange, type DeltaCheckInput } from "./delta-check.rules";

const params = { percent: 50, lookbackDays: 365 };
const result = (over: Partial<DeltaCheckInput> = {}): DeltaCheckInput => ({
  resultId: "r1",
  orderNumber: "LO00000123",
  testName: "Creatinine",
  unit: "mg/dL",
  value: 2.4,
  stage: "entered",
  previous: { value: 1.0, unit: "mg/dL", releasedAt: "2026-10-01T03:00:00Z" },
  ...over,
});

describe("laboratory.delta-check", () => {
  it("expresses a change in percent, and not from zero", () => {
    expect(percentChange(2.4, 1)).toBeCloseTo(140);
    expect(percentChange(5, 10)).toBe(-50);
    expect(percentChange(3, 0)).toBeNull();
  });

  it("asks for a second look at a large change, naming the order and never the patient", () => {
    const [s] = deltaCheckSuggestions([result()], params);
    expect(s).toMatchObject({ ruleId: "laboratory.delta-check", severity: "warning", action: { href: "/laboratory/worklist?stage=verify" } });
    expect(s!.title).toBe("Creatinine, order LO00000123: 2.4 mg/dL (+140% from the last released 1 mg/dL)");
    expect(s!.evidence.map((e) => e.value)).toEqual(["2.4 mg/dL", "1 mg/dL", "+140%"]);
  });

  it("calls a change under twice the threshold advice, and points to the next stage", () => {
    const [s] = deltaCheckSuggestions([result({ value: 1.6, stage: "verified" })], params);
    expect(s).toMatchObject({ severity: "advice", action: { href: "/laboratory/worklist?stage=approve" } });
    expect(s!.title).toContain("+60%");
  });

  it("stays silent for small changes, other units, no history or a previous zero", () => {
    expect(deltaCheckSuggestions([result({ value: 1.3 })], params)).toEqual([]);
    expect(deltaCheckSuggestions([result({ previous: { value: 1, unit: "µmol/L", releasedAt: "2026-10-01T03:00:00Z" } })], params)).toEqual([]);
    expect(deltaCheckSuggestions([result({ previous: null })], params)).toEqual([]);
    expect(deltaCheckSuggestions([result({ previous: { value: 0, unit: "mg/dL", releasedAt: "2026-10-01T03:00:00Z" } })], params)).toEqual([]);
  });

  it("flags a large fall too", () => {
    expect(deltaCheckSuggestions([result({ value: 0.4 })], params)[0]!.title).toContain("−60%");
  });

  it("accepts its default parameters", () => {
    expect(DELTA_CHECK_RULE.parametersSchema.safeParse(DELTA_CHECK_RULE.defaultParameters).success).toBe(true);
  });
});
