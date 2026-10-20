import { describe, expect, it } from "vitest";
import { storeLinks } from "./mobile-app";

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
});
