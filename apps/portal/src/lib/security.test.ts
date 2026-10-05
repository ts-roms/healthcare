import { describe, expect, it } from "vitest";
import { mfaPolicyNotice, recoveryCodesLow, recoveryCodesText, securityMessage } from "./security";

describe("security messages", () => {
  it("puts the API's refusals in the patient's words", () => {
    expect(securityMessage("invalid_verification_code", "x")).toContain("not correct");
    expect(securityMessage("verification_too_soon", "x")).toContain("Wait a minute");
    expect(securityMessage("email_not_verified", "x")).toBe("Verify your email address first.");
    expect(securityMessage("something_else", "Fallback")).toBe("Fallback");
    expect(securityMessage(undefined, "Fallback")).toBe("Fallback");
  });

  it("lists recovery codes one per line and warns when few are left", () => {
    expect(recoveryCodesText(["AAAAA-BBBBB", "CCCCC-DDDDD"])).toBe("AAAAA-BBBBB\nCCCCC-DDDDD");
    expect(recoveryCodesLow(3)).toBe(false);
    expect(recoveryCodesLow(2)).toBe(true);
    expect(recoveryCodesLow(0)).toBe(true);
  });
});

describe("two-step verification requirement notice", () => {
  it("says nothing when it is not required or already on", () => {
    expect(mfaPolicyNotice({ required: false, requiredFrom: null, enrollmentRequired: false }, false)).toBeNull();
    expect(mfaPolicyNotice({ required: true, requiredFrom: "2026-11-01", enrollmentRequired: false }, true)).toBeNull();
    expect(mfaPolicyNotice({ required: true, requiredFrom: null, enrollmentRequired: true }, true)).toBeNull();
  });

  it("warns with the date before it, and says set-up is needed from it", () => {
    expect(mfaPolicyNotice({ required: true, requiredFrom: "2026-11-01", enrollmentRequired: false }, false)).toContain("From 2026-11-01");
    expect(mfaPolicyNotice({ required: true, requiredFrom: "2026-11-01", enrollmentRequired: true }, false)).toContain("now requires");
    expect(securityMessage("mfa_enrollment_required", "x")).toContain("Set it up");
  });
});
