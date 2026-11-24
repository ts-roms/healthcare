import { describe, expect, it } from "vitest";
import { segmentDraftFrom } from "./outreach-draft";

describe("segment draft from a link", () => {
  it("reads an audience idea's link", () => {
    expect(segmentDraftFrom({ segment: "new", name: "Not seen in 5 months", noVisitForMonths: "5" })).toEqual({
      name: "Not seen in 5 months",
      criteria: { noVisitForMonths: 5 },
    });
    expect(segmentDraftFrom({ segment: "new", name: "Birthdays in December", birthMonth: "12" })?.criteria).toEqual({ birthMonth: 12 });
  });

  it("opens nothing without segment=new", () => {
    expect(segmentDraftFrom({})).toBeNull();
    expect(segmentDraftFrom({ segment: "edit", name: "x" })).toBeNull();
  });

  it("keeps only known criteria within the accepted ranges", () => {
    const draft = segmentDraftFrom({
      segment: "new",
      noVisitForMonths: "0",
      birthMonth: "13",
      ageMin: "60",
      sex: "other",
      myHealth: "not_active",
      registeredTo: "2026-02-30x",
      lastVisitBefore: "2026-01-31",
      diagnosis: "E11",
      registeredFacilityId: "not-a-uuid",
      province: "Cebu",
    });
    expect(draft).toEqual({ name: "", criteria: { ageMin: 60, myHealth: "not_active", lastVisitBefore: "2026-01-31", province: "Cebu" } });
  });

  it("takes the first of repeated values and caps the name", () => {
    expect(segmentDraftFrom({ segment: ["new", "x"], name: "a".repeat(200), birthMonth: ["3", "4"] })).toEqual({
      name: "a".repeat(120),
      criteria: { birthMonth: 3 },
    });
  });
});
