import { consentInEffect, patientMayWithdraw } from "./portal-consent.rules";

describe("MyHealth consent rules", () => {
  it("lets the patient withdraw only the consents MyHealth offers", () => {
    for (const type of ["telemedicine", "data_sharing_hmo", "data_sharing_philhealth", "research", "portal_access"] as const) {
      expect(patientMayWithdraw(type)).toBe(true);
    }
    expect(patientMayWithdraw("data_processing")).toBe(false);
    expect(patientMayWithdraw("treatment_general")).toBe(false);
  });

  it("treats a consent as in effect only when granted, effective and not expired", () => {
    const now = new Date("2026-09-29T02:00:00Z");
    const past = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2027-01-01T00:00:00Z");
    expect(consentInEffect({ decision: "granted", effectiveAt: past, expiresAt: null }, now)).toBe(true);
    expect(consentInEffect({ decision: "granted", effectiveAt: past, expiresAt: future }, now)).toBe(true);
    expect(consentInEffect({ decision: "granted", effectiveAt: future, expiresAt: null }, now)).toBe(false);
    expect(consentInEffect({ decision: "granted", effectiveAt: past, expiresAt: now }, now)).toBe(false);
    expect(consentInEffect({ decision: "withdrawn", effectiveAt: past, expiresAt: null }, now)).toBe(false);
    expect(consentInEffect({ decision: "refused", effectiveAt: past, expiresAt: null }, now)).toBe(false);
  });
});
