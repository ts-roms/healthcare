import { describe, expect, it } from "vitest";
import { hrefFromPushData, portalLink } from "./links";

describe("links from a push notice", () => {
  it("opens plain paths of the web MyHealth", () => {
    expect(portalLink("https://myhealth.example.ph", "/messages/3f0c")).toBe("https://myhealth.example.ph/messages/3f0c");
    expect(portalLink("https://myhealth.example.ph/", "/results")).toBe("https://myhealth.example.ph/results");
  });

  it("never follows another site or anything unusual", () => {
    for (const href of ["//evil.example", "https://evil.example", "javascript:alert(1)", "/a?b=c", "/a b", "/../x%2f", "", undefined, null]) {
      expect(portalLink("https://myhealth.example.ph", href)).toBeNull();
    }
    expect(portalLink(null, "/results")).toBeNull();
  });

  it("reads the address from the message data", () => {
    expect(hrefFromPushData({ url: "/messages" })).toBe("/messages");
    expect(hrefFromPushData({ url: 5 })).toBeNull();
    expect(hrefFromPushData(null)).toBeNull();
    expect(hrefFromPushData("x")).toBeNull();
  });
});
