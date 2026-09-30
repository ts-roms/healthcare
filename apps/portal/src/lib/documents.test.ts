import { describe, expect, it } from "vitest";
import { issuedOn, referralState, requestOpen, requestState } from "./documents";

describe("records request wording", () => {
  it("tells the patient where a request stands", () => {
    expect(requestState("submitted")).toEqual({ tone: "waiting", text: "Sent — waiting for the records office" });
    expect(requestState("fulfilled").tone).toBe("done");
    expect(requestState("declined").tone).toBe("declined");
    expect(requestState("withdrawn").tone).toBe("closed");
  });
  it("lets the patient withdraw only open requests", () => {
    expect(requestOpen("submitted")).toBe(true);
    expect(requestOpen("in_review")).toBe(true);
    expect(requestOpen("fulfilled")).toBe(false);
  });
});

describe("referral wording", () => {
  it("tells the patient where a referral stands, without clinical detail", () => {
    expect(referralState("sent")).toEqual({ tone: "waiting", text: "Sent — bring the letter when you go" });
    expect(referralState("accepted").tone).toBe("waiting");
    expect(referralState("completed").tone).toBe("done");
    expect(referralState("declined").tone).toBe("declined");
    expect(referralState("cancelled")).toEqual({ tone: "closed", text: "Cancelled by your doctor" });
  });

  it("dates a referral in the clinic's time zone", () => {
    // 20:30 UTC on 30 September is already 1 October in Manila.
    expect(issuedOn("2026-09-30T20:30:00Z")).toBe("October 1, 2026");
  });
});
