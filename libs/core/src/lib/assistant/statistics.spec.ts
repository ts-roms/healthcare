import { mean, median, percentile, zScore } from "./statistics";
import { parseSuggestionId, suggestionId } from "./suggestion";

describe("assistant statistics", () => {
  it("answers null below the minimum sample", () => {
    expect(mean([], 1)).toBeNull();
    expect(median([1, 2], 3)).toBeNull();
    expect(zScore(10, [1, 2, 3], 8)).toBeNull();
  });

  it("computes mean, median and percentiles", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5], 90)).toBeCloseTo(4.6);
    expect(percentile([7], 50)).toBe(7);
  });

  it("scores a value against its history and ignores a flat history", () => {
    const history = [10, 12, 11, 9, 10, 11, 10, 12];
    expect(zScore(30, history)).toBeGreaterThan(3);
    expect(zScore(10, [5, 5, 5, 5, 5, 5, 5, 5])).toBeNull();
  });
});

describe("suggestion ids", () => {
  it("round-trips", () => {
    const id = suggestionId("inventory.days-of-cover", 1, "item:abc|loc:def");
    expect(parseSuggestionId(id)).toEqual({ ruleId: "inventory.days-of-cover", ruleVersion: 1, subjectKey: "item:abc|loc:def" });
    expect(parseSuggestionId("nonsense")).toBeNull();
  });
});
