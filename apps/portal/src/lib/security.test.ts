import { describe, expect, it } from "vitest";
import { recoveryCodesLow, recoveryCodesText, securityMessage } from "./security";

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
