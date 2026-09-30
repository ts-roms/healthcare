import { describe, expect, it } from "vitest";
import { readSettings, validateApiBaseUrl } from "./config";

describe("app settings", () => {
  it("accepts https, and http only in development", () => {
    expect(validateApiBaseUrl("https://api.example.ph/api/v1/", false)).toBe("https://api.example.ph/api/v1");
    expect(() => validateApiBaseUrl("http://192.168.1.5:3333/api/v1", false)).toThrow(/https/);
    expect(validateApiBaseUrl("http://192.168.1.5:3333/api/v1", true)).toBe("http://192.168.1.5:3333/api/v1");
    expect(() => validateApiBaseUrl("ftp://x.example.ph", true)).toThrow(/https/);
    expect(() => validateApiBaseUrl("not a url", true)).toThrow(/web address/);
    expect(() => validateApiBaseUrl(undefined, true)).toThrow(/not set/);
  });

  it("needs the organization and lower-cases its code", () => {
    const env = {
      EXPO_PUBLIC_API_BASE_URL: "https://api.example.ph/api/v1",
      EXPO_PUBLIC_ORGANIZATION_CODE: " Demo ",
      EXPO_PUBLIC_PORTAL_URL: "https://myhealth.example.ph/",
    };
    expect(readSettings(env, false)).toEqual({
      apiBaseUrl: "https://api.example.ph/api/v1",
      organizationCode: "demo",
      portalUrl: "https://myhealth.example.ph",
    });
    expect(readSettings({ ...env, EXPO_PUBLIC_PORTAL_URL: undefined }, false).portalUrl).toBeNull();
    expect(() => readSettings({ ...env, EXPO_PUBLIC_ORGANIZATION_CODE: "" }, false)).toThrow(/ORGANIZATION_CODE/);
  });
});
