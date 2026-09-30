import { calendarEventEditableBy, calendarEventVisibleTo } from "./calendar.rules";

describe("calendar rules", () => {
  const facilityEvent = { visibility: "facility" as const, organizerUserId: "u1" };
  const privateEvent = { visibility: "invitees" as const, organizerUserId: "u1" };

  it("shows facility events to everyone", () => {
    expect(calendarEventVisibleTo(facilityEvent, [], "u9")).toBe(true);
  });
  it("shows invitee events only to the organizer and attendees", () => {
    expect(calendarEventVisibleTo(privateEvent, ["u2"], "u1")).toBe(true);
    expect(calendarEventVisibleTo(privateEvent, ["u2"], "u2")).toBe(true);
    expect(calendarEventVisibleTo(privateEvent, ["u2"], "u3")).toBe(false);
  });
  it("lets the organizer or a clinic configurer change a scheduled event only", () => {
    expect(calendarEventEditableBy({ organizerUserId: "u1", status: "scheduled" }, "u1", false)).toBe(true);
    expect(calendarEventEditableBy({ organizerUserId: "u1", status: "scheduled" }, "u2", false)).toBe(false);
    expect(calendarEventEditableBy({ organizerUserId: "u1", status: "scheduled" }, "u2", true)).toBe(true);
    expect(calendarEventEditableBy({ organizerUserId: "u1", status: "cancelled" }, "u1", true)).toBe(false);
  });
});
