import { canClose, hoursLeft, notificationOverdue, notificationPending, notifyBy } from "./privacy.rules";

describe("privacy incident rules", () => {
  const discovered = new Date("2026-10-20T01:00:00Z");
  const deadline = notifyBy(discovered, 72);

  it("counts the notification window from discovery in the organization's own hours", () => {
    expect(deadline.toISOString()).toBe("2026-10-23T01:00:00.000Z");
    expect(notifyBy(discovered, 24).toISOString()).toBe("2026-10-21T01:00:00.000Z");
  });

  it("keeps the clock running while open and not yet assessed, or notifiable without an NPC notification", () => {
    const pending = { status: "open" as const, assessment: "pending" as const, notifyBy: deadline, npcNotifiedAt: null };
    expect(notificationPending(pending)).toBe(true);
    expect(notificationPending({ ...pending, assessment: "notifiable" })).toBe(true);
    expect(notificationPending({ ...pending, assessment: "notifiable", npcNotifiedAt: new Date() })).toBe(false);
    expect(notificationPending({ ...pending, assessment: "not_notifiable" })).toBe(false);
    expect(notificationPending({ ...pending, status: "closed" })).toBe(false);
  });

  it("flags the window as passed, and counts the hours left", () => {
    const pending = { status: "open" as const, assessment: "pending" as const, notifyBy: deadline, npcNotifiedAt: null };
    expect(notificationOverdue(pending, new Date("2026-10-22T01:00:00Z"))).toBe(false);
    expect(notificationOverdue(pending, new Date("2026-10-23T01:00:01Z"))).toBe(true);
    expect(hoursLeft(pending, new Date("2026-10-22T01:00:00Z"))).toBe(24);
    expect(hoursLeft(pending, new Date("2026-10-23T13:00:00Z"))).toBe(-12);
    expect(hoursLeft({ ...pending, assessment: "not_notifiable" }, new Date())).toBeNull();
  });

  it("closes an incident only once it has been assessed", () => {
    expect(canClose({ status: "open", assessment: "pending" })).toBe(false);
    expect(canClose({ status: "open", assessment: "notifiable" })).toBe(true);
    expect(canClose({ status: "open", assessment: "not_notifiable" })).toBe(true);
    expect(canClose({ status: "closed", assessment: "notifiable" })).toBe(false);
  });
});
