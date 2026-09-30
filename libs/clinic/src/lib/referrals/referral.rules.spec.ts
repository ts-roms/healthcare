import { overdueBefore, referralAllows, referralNumber, referralOverdue } from "./referral.rules";

describe("referral rules", () => {
  it("lets the practitioner referred to answer an internal referral once, then complete it after accepting", () => {
    expect(referralAllows({ kind: "internal", status: "sent" }, "answer")).toBe(true);
    expect(referralAllows({ kind: "internal", status: "accepted" }, "answer")).toBe(false);
    expect(referralAllows({ kind: "internal", status: "sent" }, "complete")).toBe(false);
    expect(referralAllows({ kind: "internal", status: "accepted" }, "complete")).toBe(true);
    expect(referralAllows({ kind: "internal", status: "accepted" }, "link_appointment")).toBe(true);
  });

  it("completes an external referral when the reply is recorded, and never answers or books it", () => {
    expect(referralAllows({ kind: "external", status: "sent" }, "answer")).toBe(false);
    expect(referralAllows({ kind: "external", status: "sent" }, "link_appointment")).toBe(false);
    expect(referralAllows({ kind: "external", status: "sent" }, "complete")).toBe(true);
  });

  it("cancels only an open referral; final states allow nothing", () => {
    expect(referralAllows({ kind: "external", status: "sent" }, "cancel")).toBe(true);
    expect(referralAllows({ kind: "internal", status: "accepted" }, "cancel")).toBe(true);
    for (const status of ["declined", "completed", "cancelled"] as const) {
      for (const action of ["answer", "link_appointment", "complete", "cancel"] as const) {
        expect(referralAllows({ kind: "internal", status }, action)).toBe(false);
      }
    }
  });

  it("numbers referrals per organization", () => {
    expect(referralNumber(42)).toBe("RF00000042");
  });
});

describe("referral overdue flag", () => {
  const now = new Date("2026-10-10T00:00:00Z");
  const sent = (daysAgo: number, status: "sent" | "accepted" | "declined" | "completed" | "cancelled" = "sent") => ({
    status,
    issuedAt: new Date(now.getTime() - daysAgo * 86_400_000),
  });

  it("is off while the organization has not chosen a number of days", () => {
    expect(referralOverdue(sent(400), null, now)).toBe(false);
    expect(overdueBefore(null, now)).toBeNull();
  });

  it("flags only referrals still awaiting the recipient, from the chosen day on", () => {
    expect(referralOverdue(sent(6), 7, now)).toBe(false);
    expect(referralOverdue(sent(7), 7, now)).toBe(true);
    expect(referralOverdue({ status: "sent", issuedAt: sent(8).issuedAt.toISOString() }, 7, now)).toBe(true);
    for (const status of ["accepted", "declined", "completed", "cancelled"] as const) expect(referralOverdue(sent(30, status), 7, now)).toBe(false);
    expect(overdueBefore(7, now)?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
  });
});
