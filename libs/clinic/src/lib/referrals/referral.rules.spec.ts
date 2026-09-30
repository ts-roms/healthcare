import { referralAllows, referralNumber } from "./referral.rules";

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
