import {
  awaitingClinic,
  compareForQueue,
  initialAssignee,
  isOverdue,
  overdueReminderDue,
  responseDueAt,
  shouldNotifyClinic,
  unreadByPatient,
} from "./patient-message.rules";

const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h));

describe("patient message rules", () => {
  it("knows when the patient has unread clinic messages", () => {
    expect(unreadByPatient({ lastMessageFrom: "staff", lastMessageAt: at(2), patientReadThrough: null })).toBe(true);
    expect(unreadByPatient({ lastMessageFrom: "staff", lastMessageAt: at(2), patientReadThrough: at(1) })).toBe(true);
    expect(unreadByPatient({ lastMessageFrom: "staff", lastMessageAt: at(2), patientReadThrough: at(2) })).toBe(false);
    expect(unreadByPatient({ lastMessageFrom: "patient", lastMessageAt: at(2), patientReadThrough: null })).toBe(false);
  });

  it("knows when a conversation waits for the clinic", () => {
    expect(awaitingClinic({ status: "open", lastMessageFrom: "patient" })).toBe(true);
    expect(awaitingClinic({ status: "open", lastMessageFrom: "staff" })).toBe(false);
    expect(awaitingClinic({ status: "closed", lastMessageFrom: "patient" })).toBe(false);
  });

  it("tells the clinic once for a run of patient messages", () => {
    expect(shouldNotifyClinic(null)).toBe(true);
    expect(shouldNotifyClinic("staff")).toBe(true);
    expect(shouldNotifyClinic("patient")).toBe(false);
  });

  it("puts the longest wait first, then the rest newest first", () => {
    const rows = [
      { id: "replied-new", status: "open" as const, lastMessageFrom: "staff" as const, lastMessageAt: at(9) },
      { id: "waiting-new", status: "open" as const, lastMessageFrom: "patient" as const, lastMessageAt: at(8) },
      { id: "waiting-old", status: "open" as const, lastMessageFrom: "patient" as const, lastMessageAt: at(3) },
      { id: "replied-old", status: "open" as const, lastMessageFrom: "staff" as const, lastMessageAt: at(4) },
    ];
    expect([...rows].sort(compareForQueue).map((r) => r.id)).toEqual(["waiting-old", "waiting-new", "replied-new", "replied-old"]);
  });

  it("assigns on arrival only when the topic is routed to a person who takes them", () => {
    expect(initialAssignee(null)).toBeNull();
    expect(initialAssignee({ routeUserId: "u1", autoAssign: false })).toBeNull();
    expect(initialAssignee({ routeUserId: null, autoAssign: true })).toBeNull();
    expect(initialAssignee({ routeUserId: "u1", autoAssign: true })).toBe("u1");
  });

  it("sets the response target in calendar hours from the patient's message, or none", () => {
    expect(responseDueAt(null, at(1))).toBeNull();
    expect(responseDueAt({ responseTargetHours: null }, at(1))).toBeNull();
    expect(responseDueAt({ responseTargetHours: 24 }, at(1))).toEqual(new Date(Date.UTC(2026, 0, 2, 1)));
  });

  it("marks a conversation overdue only while it waits for the clinic past its target", () => {
    expect(isOverdue({ status: "open", lastMessageFrom: "patient", responseDueAt: at(2) }, at(3))).toBe(true);
    expect(isOverdue({ status: "open", lastMessageFrom: "patient", responseDueAt: at(4) }, at(3))).toBe(false);
    expect(isOverdue({ status: "open", lastMessageFrom: "staff", responseDueAt: at(2) }, at(3))).toBe(false);
    expect(isOverdue({ status: "closed", lastMessageFrom: "patient", responseDueAt: at(2) }, at(3))).toBe(false);
    expect(isOverdue({ status: "open", lastMessageFrom: "patient", responseDueAt: null }, at(3))).toBe(false);
  });

  it("reminds of a breach once, and again only for a later target", () => {
    expect(overdueReminderDue({ responseDueAt: null, overdueNotifiedAt: null }, at(5))).toBe(false);
    expect(overdueReminderDue({ responseDueAt: at(6), overdueNotifiedAt: null }, at(5))).toBe(false);
    expect(overdueReminderDue({ responseDueAt: at(2), overdueNotifiedAt: null }, at(5))).toBe(true);
    expect(overdueReminderDue({ responseDueAt: at(2), overdueNotifiedAt: at(3) }, at(5))).toBe(false);
    expect(overdueReminderDue({ responseDueAt: at(4), overdueNotifiedAt: at(3) }, at(5))).toBe(true);
  });
});
