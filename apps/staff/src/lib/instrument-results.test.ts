import { describe, expect, it } from "vitest";
import { MATCH_PROBLEM, SPECIMEN_FIELDS, sentValue } from "./instrument-results";

describe("instrument results", () => {
  it("shows the value with the unit the instrument sent", () => {
    expect(sentValue({ value: "6.1", units: "mmol/L" })).toBe("6.1 mmol/L");
    expect(sentValue({ value: "Positive", units: null })).toBe("Positive");
  });

  it("explains every match problem and offers each protocol's specimen fields", () => {
    expect(Object.keys(MATCH_PROBLEM)).toHaveLength(5);
    expect(SPECIMEN_FIELDS.hl7v2.map((f) => f.value)).toEqual(["OBR-2", "OBR-3", "SPM-2"]);
    expect(SPECIMEN_FIELDS.astm.map((f) => f.value)).toEqual(["O-3", "O-4"]);
  });
});
