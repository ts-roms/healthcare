import {
  accessionNumber,
  ageInDays,
  canTransition,
  exceedsDecimalPlaces,
  interpretCoded,
  interpretNumeric,
  itemStatusForResult,
  orderStatusFromItems,
  type RangeCandidate,
  selectReferenceRange,
  signOffDecision,
} from "./laboratory.rules";

const range = (overrides: Partial<RangeCandidate>): RangeCandidate => ({
  id: "r",
  sex: null,
  ageMinDays: 0,
  ageMaxDays: null,
  low: 4,
  high: 10,
  criticalLow: 2,
  criticalHigh: 30,
  textRange: null,
  effectiveFrom: new Date("2020-01-01T00:00:00Z"),
  effectiveTo: null,
  ...overrides,
});

describe("selectReferenceRange", () => {
  const at = new Date("2026-06-01T00:00:00Z");
  const adult = 40 * 365;

  it("prefers a sex-specific range over an any-sex one", () => {
    const ranges = [range({ id: "any" }), range({ id: "male", sex: "male" }), range({ id: "female", sex: "female" })];
    expect(selectReferenceRange(ranges, { sex: "male", ageDays: adult }, at)?.id).toBe("male");
    expect(selectReferenceRange(ranges, { sex: "female", ageDays: adult }, at)?.id).toBe("female");
  });

  it("never guesses a sex: intersex and unknown get only any-sex ranges", () => {
    const ranges = [range({ id: "male", sex: "male" }), range({ id: "any" })];
    expect(selectReferenceRange(ranges, { sex: "unknown", ageDays: adult }, at)?.id).toBe("any");
    expect(selectReferenceRange([range({ id: "male", sex: "male" })], { sex: "intersex", ageDays: adult }, at)).toBeUndefined();
  });

  it("applies age bands with an exclusive upper bound", () => {
    const ranges = [range({ id: "newborn", ageMaxDays: 28 }), range({ id: "older", ageMinDays: 28 })];
    expect(selectReferenceRange(ranges, { sex: "male", ageDays: 27 }, at)?.id).toBe("newborn");
    expect(selectReferenceRange(ranges, { sex: "male", ageDays: 28 }, at)?.id).toBe("older");
  });

  it("uses the range effective at the time, so history keeps its interpretation", () => {
    const change = new Date("2026-01-01T00:00:00Z");
    const ranges = [range({ id: "old", effectiveTo: change }), range({ id: "new", effectiveFrom: change })];
    expect(selectReferenceRange(ranges, { sex: "male", ageDays: adult }, new Date("2025-12-31T00:00:00Z"))?.id).toBe("old");
    expect(selectReferenceRange(ranges, { sex: "male", ageDays: adult }, change)?.id).toBe("new");
  });
});

describe("interpretNumeric", () => {
  const r = range({});
  it.each([
    [1, "critical_low", true],
    [2, "critical_low", true],
    [3, "low", false],
    [4, "normal", false],
    [10, "normal", false],
    [11, "high", false],
    [30, "critical_high", true],
  ] as const)("%s → %s", (value, flag, critical) => {
    expect(interpretNumeric(value, r)).toEqual({ flag, critical });
  });

  it("gives no flag without a range", () => {
    expect(interpretNumeric(5, undefined)).toEqual({ flag: null, critical: false });
    expect(interpretNumeric(5, { low: null, high: null, criticalLow: null, criticalHigh: null })).toEqual({ flag: null, critical: false });
  });
});

describe("interpretCoded", () => {
  it("flags configured abnormal values", () => {
    expect(interpretCoded("Positive", ["Positive"])).toEqual({ flag: "abnormal", critical: false });
    expect(interpretCoded("Negative", ["Positive"])).toEqual({ flag: "normal", critical: false });
  });
});

it("checks decimal places", () => {
  expect(exceedsDecimalPlaces(7.25, 1)).toBe(true);
  expect(exceedsDecimalPlaces(7.2, 1)).toBe(false);
  expect(exceedsDecimalPlaces(7, 0)).toBe(false);
  expect(exceedsDecimalPlaces(7.123, null)).toBe(false);
});

describe("result transitions", () => {
  it("only move forward", () => {
    expect(canTransition("entered", "verified")).toBe(true);
    expect(canTransition("entered", "approved")).toBe(false);
    expect(canTransition("approved", "released")).toBe(true);
    expect(canTransition("released", "cancelled")).toBe(false);
    expect(canTransition("released", "superseded")).toBe(true);
    expect(canTransition("superseded", "released")).toBe(false);
  });
});

describe("signOffDecision", () => {
  const strict = { allowSelfVerification: false, allowSelfApproval: false };
  it("lets a different person sign off", () => {
    expect(signOffDecision("approve", { enteredBy: "a" }, "b", strict)).toEqual({ allowed: true, self: false });
  });
  it("refuses a self sign-off unless the facility allows it, and records it as self", () => {
    expect(signOffDecision("verify", { enteredBy: "a" }, "a", strict)).toEqual({ allowed: false, self: true });
    expect(signOffDecision("verify", { enteredBy: "a" }, "a", { ...strict, allowSelfVerification: true })).toEqual({ allowed: true, self: true });
    expect(signOffDecision("approve", { enteredBy: "a" }, "a", { ...strict, allowSelfVerification: true })).toEqual({ allowed: false, self: true });
  });
});

describe("order and item status", () => {
  it("derives the item status from its result", () => {
    expect(itemStatusForResult("approved")).toBe("resulted");
    expect(itemStatusForResult("released")).toBe("released");
  });
  it("completes an order when every item is released or cancelled", () => {
    expect(orderStatusFromItems([{ status: "released" }, { status: "cancelled" }])).toBe("completed");
    expect(orderStatusFromItems([{ status: "released" }, { status: "resulted" }])).toBe("active");
    expect(orderStatusFromItems([{ status: "cancelled" }, { status: "cancelled" }])).toBe("cancelled");
  });
});

it("formats accession numbers and ages", () => {
  expect(accessionNumber("2026-09-27", 7)).toBe("2609270007");
  expect(accessionNumber("2026-09-27", 12345)).toBe("26092712345");
  expect(ageInDays("2026-09-01", "2026-09-27")).toBe(26);
});
