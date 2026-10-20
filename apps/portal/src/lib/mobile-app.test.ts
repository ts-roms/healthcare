import { describe, expect, it } from "vitest";
import { isApk, storeLinks } from "./mobile-app";

describe("store links", () => {
  it("lists the configured store listings and ignores anything that is not an http(s) link", () => {
    expect(
      storeLinks({ MOBILE_APP_IOS_URL: "https://apps.apple.com/ph/app/id1", MOBILE_APP_ANDROID_URL: "https://play.google.com/store/apps/details?id=ph.x" }),
    ).toEqual([
      { key: "ios", label: "App Store", href: "https://apps.apple.com/ph/app/id1" },
      { key: "android", label: "Google Play", href: "https://play.google.com/store/apps/details?id=ph.x" },
    ]);
    expect(storeLinks({ MOBILE_APP_IOS_URL: "ftp://x", MOBILE_APP_ANDROID_URL: "" })).toEqual([]);
    expect(storeLinks({})).toEqual([]);
  });

  it("turns an APK path in the public folder into a full link to this site, labelled as an APK", () => {
    expect(storeLinks({ MOBILE_APP_ANDROID_URL: "/downloads/myhealth.apk" }, "https://myhealth.example.ph")).toEqual([
      { key: "android", label: "Android app (APK)", href: "https://myhealth.example.ph/downloads/myhealth.apk" },
    ]);
    expect(storeLinks({ MOBILE_APP_ANDROID_URL: "/downloads/myhealth.apk" })).toEqual([]);
    expect(isApk("https://myhealth.example.ph/downloads/myhealth.apk")).toBe(true);
  });
});
