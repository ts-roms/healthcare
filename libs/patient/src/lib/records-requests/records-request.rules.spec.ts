import { copySectionsForScope, daysWaiting, recordsRequestOpen, recordsRequestOverdue, respondByDate } from "./records-request.rules";

describe("records request rules", () => {
  it("is open while submitted or in review", () => {
    expect(recordsRequestOpen("submitted")).toBe(true);
    expect(recordsRequestOpen("in_review")).toBe(true);
    expect(recordsRequestOpen("fulfilled")).toBe(false);
    expect(recordsRequestOpen("declined")).toBe(false);
    expect(recordsRequestOpen("withdrawn")).toBe(false);
  });

  it("counts whole days waiting", () => {
    const now = new Date("2026-10-10T08:00:00Z");
    expect(daysWaiting(new Date("2026-10-10T07:00:00Z"), now)).toBe(0);
    expect(daysWaiting(new Date("2026-10-07T09:00:00Z"), now)).toBe(2);
    expect(daysWaiting(new Date("2026-10-11T09:00:00Z"), now)).toBe(0);
  });

  it("starts a copy of the record from what the patient asked for, in the copy's order", () => {
    expect(copySectionsForScope(["laboratory", "consultations"])).toEqual(["allergies", "consultations", "laboratory", "care_plans"]);
    expect(copySectionsForScope(["imaging", "dental", "certificates"])).toEqual(["dental", "certificates", "documents"]);
    expect(copySectionsForScope(["other"])).toEqual([]);
  });

  it("dates the response from the organization's own response time, and flags open requests past it", () => {
    expect(respondByDate("2026-09-29", 15)).toBe("2026-10-14");
    expect(respondByDate("2026-09-29", null)).toBeNull();
    expect(recordsRequestOverdue({ status: "in_review", respondBy: "2026-10-14" }, "2026-10-15")).toBe(true);
    expect(recordsRequestOverdue({ status: "in_review", respondBy: "2026-10-14" }, "2026-10-14")).toBe(false);
    expect(recordsRequestOverdue({ status: "fulfilled", respondBy: "2026-10-14" }, "2026-10-20")).toBe(false);
    expect(recordsRequestOverdue({ status: "submitted", respondBy: null }, "2030-01-01")).toBe(false);
  });
});
