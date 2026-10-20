import { describe, expect, it } from "vitest";
import { downloadLinks, isApk, mobileAppLinks } from "./mobile-app";

describe("mobile app links", () => {
  it("reads http(s) links from the environment and ignores the rest", () => {
    expect(
      mobileAppLinks({
        NODE_ENV: "production",
        MOBILE_APP_IOS_URL: "https://apps.apple.com/ph/app/id1",
        MOBILE_APP_ANDROID_URL: " ",
        PORTAL_BASE_URL: "javascript:alert(1)",
      }),
    ).toEqual({
      ios: "https://apps.apple.com/ph/app/id1",
      android: null,
      web: null,
    });
    expect(mobileAppLinks({ NODE_ENV: "production" })).toEqual({ ios: null, android: null, web: null });
    expect(mobileAppLinks({ NODE_ENV: "production", PORTAL_BASE_URL: "not a url" }).web).toBeNull();
    // Development: MyHealth on its local port unless told otherwise.
    expect(mobileAppLinks({ NODE_ENV: "development" }).web).toBe("http://localhost:3001");
    expect(mobileAppLinks({}).web).toBe("http://localhost:3001");
  });

  it("resolves an APK path under MyHealth's public folder to a full address and labels it as an APK", () => {
    const links = mobileAppLinks({ NODE_ENV: "production", PORTAL_BASE_URL: "https://myhealth.example.ph", MOBILE_APP_ANDROID_URL: "/downloads/myhealth.apk" });
    expect(links.android).toBe("https://myhealth.example.ph/downloads/myhealth.apk");
    expect(downloadLinks(links)).toEqual([{ key: "android", label: "Android app (APK)", href: "https://myhealth.example.ph/downloads/myhealth.apk" }]);
    expect(isApk("https://play.google.com/store/apps/details?id=x")).toBe(false);
    // A path with nothing to resolve it against is ignored.
    expect(mobileAppLinks({ NODE_ENV: "production", MOBILE_APP_ANDROID_URL: "/downloads/myhealth.apk" }).android).toBeNull();
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
