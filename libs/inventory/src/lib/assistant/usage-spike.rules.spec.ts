import { USAGE_SPIKE_RULE, usageSpikeSuggestions } from "./usage-spike.rules";

const params = { weeks: 8, spread: 3, minIssued: 20 };
const item = (weekly: number[]) => ({ itemId: "i1", name: "Gauze pad 4x4", stockUnit: "piece", weekly });

describe("inventory.usage-spike", () => {
  it("flags a week far above the usual week, with the usual week as evidence", () => {
    const [s] = usageSpikeSuggestions([item([40, 44, 38, 42, 40, 41, 39, 43, 160])], params);
    expect(s).toMatchObject({ ruleId: "inventory.usage-spike", severity: "advice", basis: "statistic", strength: "matched" });
    expect(s!.title).toBe("Gauze pad 4x4: 160 piece issued in the last 7 days, about 3.9 times the usual week");
    expect(s!.evidence.map((e) => e.value)).toEqual(["160 piece", "about 41 piece"]);
  });

  it("leaves ordinary swings, small quantities and short histories alone", () => {
    // The usual week is about 41 with a margin of 3 × 4.1: up to about 53 is ordinary.
    expect(usageSpikeSuggestions([item([40, 44, 38, 42, 40, 41, 39, 43, 50])], params)).toEqual([]);
    expect(usageSpikeSuggestions([item([1, 2, 1, 1, 2, 1, 1, 1, 15])], params)).toEqual([]);
    expect(usageSpikeSuggestions([item([40, 40, 160])], params)).toEqual([]);
  });

  it("keeps a margin for a perfectly steady item", () => {
    expect(usageSpikeSuggestions([item([50, 50, 50, 50, 50, 60])], params)).toEqual([]);
    expect(usageSpikeSuggestions([item([50, 50, 50, 50, 50, 90])], params)).toHaveLength(1);
  });

  it("calls a history mostly of empty weeks a weak signal", () => {
    const [s] = usageSpikeSuggestions([item([0, 0, 0, 0, 0, 10, 0, 0, 60])], params);
    expect(s!.strength).toBe("weak");
  });

  it("accepts its default parameters", () => {
    expect(USAGE_SPIKE_RULE.parametersSchema.safeParse(USAGE_SPIKE_RULE.defaultParameters).success).toBe(true);
  });
});
