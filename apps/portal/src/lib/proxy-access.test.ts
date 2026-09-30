import { describe, expect, it } from "vitest";
import { actingForHeader, isOwnAccountApiPath, isOwnAccountScreen, proxyMessage } from "./proxy-access";

const ID = "3f0c1d52-7a44-4c1e-9d6e-0b1f2a3c4d5e";

describe("acting for another person", () => {
  it("sends the header only for a real patient id", () => {
    expect(actingForHeader("/portal/appointments", ID)).toEqual({ "x-acting-for": ID });
    expect(actingForHeader("/portal/appointments", undefined)).toEqual({});
    expect(actingForHeader("/portal/appointments", "not-an-id")).toEqual({});
  });

  it("never sends it for the account holder's own account", () => {
    for (const path of [
      "/portal/mfa",
      "/portal/email/change",
      "/portal/consents",
      "/portal/communication-preferences",
      "/portal/push/devices",
      "/portal/proxy/dependents",
    ]) {
      expect(actingForHeader(path, ID)).toEqual({});
      expect(isOwnAccountApiPath(path)).toBe(true);
    }
    expect(isOwnAccountApiPath("/portal/message-threads")).toBe(false);
    expect(isOwnAccountApiPath("/portal/messages/unread-count")).toBe(false);
  });

  it("knows which screens are the holder's own", () => {
    expect(isOwnAccountScreen("/security")).toBe(true);
    expect(isOwnAccountScreen("/privacy/telemedicine")).toBe(true);
    expect(isOwnAccountScreen("/results")).toBe(false);
  });

  it("explains refusals in plain words", () => {
    expect(proxyMessage("proxy_view_only", "x")).toMatch(/not make changes/);
    expect(proxyMessage("other", "fallback")).toBe("fallback");
  });
});
