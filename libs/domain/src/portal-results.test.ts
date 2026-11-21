import { describe, expect, it } from "vitest";
import { latestPerTest, type PortalResult, resultDate, resultExplanation, resultMeaning, resultValue, usualRange } from "./portal-results";

describe("resultExplanation", () => {
  const glucose = {
    resultType: "numeric" as const,
    valueNumeric: 5.1,
    valueText: null,
    valueCoded: null,
    unit: "mmol/L",
    flag: "normal" as PortalResult["flag"],
    refLow: 3.9,
    refHigh: 5.5,
    refText: null,
    corrected: false,
    performingLaboratory: null,
  };
  const RANGE_NOTE =
    "A usual range describes the results of most healthy people tested by that laboratory, so a result outside it is not always a problem, and one inside it does not rule a problem out.";
  const DOCTOR = "Your doctor will explain what your result means for you.";

  it("says where the value sits against the laboratory's own range, and that the doctor explains it", () => {
    expect(resultExplanation(glucose)).toEqual([
      "Your result, 5.1 mmol/L, is within the usual range for this test at the laboratory that did it: 3.9 to 5.5 mmol/L.",
      RANGE_NOTE,
      DOCTOR,
    ]);
    expect(resultExplanation({ ...glucose, valueNumeric: 7.8, flag: "high", performingLaboratory: "Partner Diagnostics" })[0]).toBe(
      "Your result, 7.8 mmol/L, is higher than the usual range for this test at Partner Diagnostics: 3.9 to 5.5 mmol/L.",
    );
    expect(resultExplanation({ ...glucose, valueNumeric: 3.1, flag: "low", refLow: null })[0]).toBe(
      "Your result, 3.1 mmol/L, is lower than the usual range for this test at the laboratory that did it: up to 5.5 mmol/L.",
    );
  });

  it("says a critical result went to the care team, and nothing more", () => {
    const [position, careTeam, ...rest] = resultExplanation({ ...glucose, valueNumeric: 25, flag: "critical_high" });
    expect(position).toBe("Your result, 25 mmol/L, is much higher than the usual range for this test at the laboratory that did it: 3.9 to 5.5 mmol/L.");
    expect(careTeam).toMatch(/^Results this far from the usual range are reported to your care team .* your care team was told about this one/);
    expect(rest).toEqual([RANGE_NOTE, DOCTOR]);
  });

  it("words coded and text results against what is expected, and results without a range", () => {
    const coded = { ...glucose, resultType: "coded" as const, valueNumeric: null, valueCoded: "Reactive", unit: null, refLow: null, refHigh: null };
    expect(resultExplanation({ ...coded, flag: "abnormal", refText: "Nonreactive" })[0]).toBe(
      "Your result, Reactive, is not what is usually expected for this test (expected: Nonreactive).",
    );
    expect(resultExplanation({ ...coded, flag: null, refText: null })).toEqual([
      "Your result is Reactive. There is no usual range to compare it with.",
      DOCTOR,
    ]);
    expect(resultExplanation({ ...glucose, flag: null })[0]).toBe(
      "Your result is 5.1 mmol/L. The usual range for this test at the laboratory that did it is 3.9 to 5.5 mmol/L.",
    );
  });

  it("says when the laboratory updated a result, and never interprets it", () => {
    const corrected = resultExplanation({ ...glucose, flag: "high", valueNumeric: 6.2, corrected: true });
    expect(corrected).toContain("The laboratory updated this result after it was first released; this is the current value.");
    for (const flag of ["normal", "high", "low", "critical_high", "critical_low", "abnormal", null] as const) {
      const text = resultExplanation({ ...glucose, flag }).join(" ");
      expect(text).not.toMatch(/diabet|disease|healthy result|you have|you are (sick|well)|normal for you|treatment/i);
    }
  });
});

describe("resultMeaning", () => {
  it("describes the position against the range without interpreting it", () => {
    expect(resultMeaning({ flag: "high" })).toEqual({ tone: "attention", text: "Higher than the usual range" });
    expect(resultMeaning({ flag: "normal" }).tone).toBe("normal");
    expect(resultMeaning({ flag: "critical_high" }).text).toMatch(/care team has been told/);
    expect(resultMeaning({ flag: null }).tone).toBe("neutral");
  });
});

describe("usualRange", () => {
  it("reads naturally", () => {
    expect(usualRange({ refLow: 3.9, refHigh: 5.5, refText: null, unit: "mmol/L" })).toBe("Usual range: 3.9 to 5.5 mmol/L");
    expect(usualRange({ refLow: null, refHigh: 5.6, refText: null, unit: "%" })).toBe("Usual range: up to 5.6 %");
    expect(usualRange({ refLow: null, refHigh: null, refText: "Nonreactive", unit: null })).toBe("Expected: Nonreactive");
    expect(usualRange({ refLow: null, refHigh: null, refText: null, unit: null })).toBeNull();
  });
});

it("shows the value of each result type", () => {
  expect(resultValue({ resultType: "numeric", valueNumeric: 5.2, valueText: null, valueCoded: null })).toBe("5.2");
  expect(resultValue({ resultType: "numeric", valueNumeric: null, valueText: null, valueCoded: null })).toBe("—");
  expect(resultValue({ resultType: "coded", valueNumeric: null, valueText: null, valueCoded: "Nonreactive" })).toBe("Nonreactive");
});

it("keeps the latest result per test", () => {
  const r = (testId: string, collectedAt: string) => ({ testId, collectedAt, releasedAt: collectedAt }) as PortalResult;
  expect(
    latestPerTest([r("a", "2026-01-01"), r("b", "2026-03-01"), r("a", "2026-05-01")]).map((g) => [g.latest.testId, g.count, g.latest.collectedAt]),
  ).toEqual([
    ["a", 2, "2026-05-01"],
    ["b", 1, "2026-03-01"],
  ]);
});

it("dates results in the clinic's time zone", () => {
  expect(resultDate("2026-09-29T17:30:00Z", "Asia/Manila")).toBe("Sep 30, 2026"); // 1:30 AM on the 30th in Manila
  expect(resultDate(null, "Asia/Manila")).toBe("");
});
