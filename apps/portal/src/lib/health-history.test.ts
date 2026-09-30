import { describe, expect, it } from "vitest";
import { familyStateText, historySourceText, pastDate } from "./health-history";

describe("health history", () => {
  it("prints a past date as precisely as it is known", () => {
    expect(pastDate("2019")).toBe("2019");
    expect(pastDate("2019-05")).toBe("May 2019");
    expect(pastDate("2019-05-12")).toBe("May 12, 2019");
    expect(pastDate(null)).toBe("Date not known");
  });

  it("says where an entry comes from and the family history state in plain words", () => {
    expect(historySourceText("reported")).toMatch(/told/);
    expect(historySourceText("external_import")).toMatch(/another provider/);
    expect(familyStateText({ state: "not_recorded", unknownReason: null })).toMatch(/not recorded/);
    expect(familyStateText({ state: "unknown", unknownReason: "adopted" })).toMatch(/adopted/);
    expect(familyStateText({ state: "none_known", unknownReason: null })).toMatch(/No known/);
  });
});
