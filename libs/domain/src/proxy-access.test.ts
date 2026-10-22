import { describe, expect, it } from "vitest";
import { actingForHeader, isOwnAccountApiPath, RELATIONSHIP_LABEL } from "./proxy-access";

const ID = "3f0c1d52-7a44-4c1e-9d6e-0b1f2a3c4d5e";

describe("acting for another person (shared by MyHealth on the web and in the app)", () => {
  it("sends the header only for a real patient id", () => {
    expect(actingForHeader("/portal/forms", ID)).toEqual({ "x-acting-for": ID });
    expect(actingForHeader("/portal/forms", null)).toEqual({});
    expect(actingForHeader("/portal/forms", undefined)).toEqual({});
    expect(actingForHeader("/portal/forms", "not-an-id")).toEqual({});
  });

  it("never sends it for the account holder's own account", () => {
    for (const path of ["/portal/auth/refresh", "/portal/mfa", "/portal/push/devices", "/portal/proxy/dependents", "/portal/consents?x=1"]) {
      expect(isOwnAccountApiPath(path)).toBe(true);
      expect(actingForHeader(path, ID)).toEqual({});
    }
    expect(isOwnAccountApiPath("/portal/results")).toBe(false);
    expect(isOwnAccountApiPath("/portal/forms/count")).toBe(false);
  });

  it("names the relationships", () => {
    expect(RELATIONSHIP_LABEL["parent"]).toBe("Parent");
  });
});
