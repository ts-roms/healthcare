import { daysWaiting, recordsRequestOpen } from "./records-request.rules";

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
});
