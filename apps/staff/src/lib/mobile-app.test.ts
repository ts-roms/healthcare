import { describe, expect, it } from "vitest";
import { downloadLinks, mobileAppLinks } from "./mobile-app";

describe("mobile app links", () => {
  it("reads http(s) links from the environment and ignores the rest", () => {
    expect(
      mobileAppLinks({ MOBILE_APP_IOS_URL: "https://apps.apple.com/ph/app/id1", MOBILE_APP_ANDROID_URL: " ", PORTAL_BASE_URL: "javascript:alert(1)" }),
    ).toEqual({
      ios: "https://apps.apple.com/ph/app/id1",
      android: null,
      web: null,
    });
    expect(mobileAppLinks({})).toEqual({ ios: null, android: null, web: null });
    expect(mobileAppLinks({ PORTAL_BASE_URL: "not a url" }).web).toBeNull();
  });

  it("shows the store codes when set, else MyHealth on the web, else nothing", () => {
    expect(
      downloadLinks({ ios: "https://apps.apple.com/x", android: "https://play.google.com/y", web: "https://myhealth.example.ph/" }).map((l) => l.key),
    ).toEqual(["ios", "android"]);
    expect(downloadLinks({ ios: null, android: "https://play.google.com/y", web: null })).toEqual([
      { key: "android", label: "Google Play", href: "https://play.google.com/y" },
    ]);
    expect(downloadLinks({ ios: null, android: null, web: "https://myhealth.example.ph/" })).toEqual([
      { key: "web", label: "MyHealth on the web", href: "https://myhealth.example.ph/" },
    ]);
    expect(downloadLinks({ ios: null, android: null, web: null })).toEqual([]);
  });
});
