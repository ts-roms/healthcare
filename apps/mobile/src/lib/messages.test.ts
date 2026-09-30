import { describe, expect, it } from "vitest";
import { signInMessage } from "./messages";

describe("sign-in messages", () => {
  it("explains what to do", () => {
    expect(signInMessage("invalid_credentials", "x")).toMatch(/not correct/);
    expect(signInMessage("account_locked", "x")).toMatch(/15 minutes/);
    expect(signInMessage("invalid_mfa_code", "x")).toMatch(/authenticator/);
  });
  it("falls back to the API's own words", () => {
    expect(signInMessage("something_new", "The API said this")).toBe("The API said this");
    expect(signInMessage(undefined, "fallback")).toBe("fallback");
  });
});
