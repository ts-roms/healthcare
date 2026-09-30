import { awaitingClinic, compareForQueue, shouldNotifyClinic, unreadByPatient } from "./patient-message.rules";

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
});
