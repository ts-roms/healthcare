import { describe, expect, it } from "vitest";
import { toIsoDate } from "./birth-date";

const today = "2026-11-03";

describe("toIsoDate", () => {
  it("builds an ISO date from three fields", () => {
    expect(toIsoDate({ day: "5", month: "3", year: "1950" }, today)).toBe("1950-03-05");
  });

  it("refuses days that do not exist", () => {
    expect(toIsoDate({ day: "31", month: "4", year: "1990" }, today)).toBeNull();
    expect(toIsoDate({ day: "29", month: "2", year: "2001" }, today)).toBeNull();
    expect(toIsoDate({ day: "29", month: "2", year: "2000" }, today)).toBe("2000-02-29");
  });

  it("refuses the future, the distant past and half-typed years", () => {
    expect(toIsoDate({ day: "4", month: "11", year: "2026" }, today)).toBeNull();
    expect(toIsoDate({ day: "3", month: "11", year: "2026" }, today)).toBe("2026-11-03");
    expect(toIsoDate({ day: "1", month: "1", year: "1700" }, today)).toBeNull();
    expect(toIsoDate({ day: "1", month: "1", year: "19" }, today)).toBeNull();
    expect(toIsoDate({ day: "", month: "1", year: "1990" }, today)).toBeNull();
  });
});
