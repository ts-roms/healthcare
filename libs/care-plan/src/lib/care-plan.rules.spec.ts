import { canChangeActivityStatus, canChangePlanStatus, nextDueDate, recallReminderKind, withinSendingHours } from "./care-plan.rules";

describe("care plan rules", () => {
  it("follows the plan lifecycle", () => {
    expect(canChangePlanStatus("draft", "active")).toBe(true);
    expect(canChangePlanStatus("active", "on_hold")).toBe(true);
    expect(canChangePlanStatus("completed", "active")).toBe(false);
    expect(canChangePlanStatus("cancelled", "active")).toBe(false);
  });

  it("follows the activity lifecycle", () => {
    expect(canChangeActivityStatus("planned", "scheduled")).toBe(true);
    expect(canChangeActivityStatus("scheduled", "planned")).toBe(true);
    expect(canChangeActivityStatus("completed", "planned")).toBe(false);
  });

  it("schedules the next occurrence of recurring monitoring", () => {
    expect(nextDueDate("2026-01-15", 90)).toBe("2026-04-15");
    expect(nextDueDate("2026-12-20", 30)).toBe("2027-01-19");
  });

  it("reminds a week before a follow-up is due, once more a week after, then leaves it to the care team", () => {
    expect(recallReminderKind("2026-10-10", "2026-10-02")).toBeNull();
    expect(recallReminderKind("2026-10-10", "2026-10-03")).toBe("due");
    expect(recallReminderKind("2026-10-10", "2026-10-16")).toBe("due");
    expect(recallReminderKind("2026-10-10", "2026-10-17")).toBe("overdue");
    expect(recallReminderKind("2026-10-10", "2026-11-09")).toBe("overdue");
    expect(recallReminderKind("2026-10-10", "2026-11-10")).toBeNull();
  });

  it("sends reminders only in the daytime", () => {
    expect(withinSendingHours(7)).toBe(false);
    expect(withinSendingHours(8)).toBe(true);
    expect(withinSendingHours(19)).toBe(true);
    expect(withinSendingHours(20)).toBe(false);
  });
});
