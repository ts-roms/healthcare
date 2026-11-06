import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-path";

describe("safeNextPath", () => {
  it("allows same-origin relative paths", () => {
    expect(safeNextPath("/patients?q=cruz")).toBe("/patients?q=cruz");
  });
  it.each([["https://evil.example"], ["//evil.example"], ["/\\evil.example"], ["patients"], [undefined], ["/login"]])("rejects %s", (v) => {
    expect(safeNextPath(v)).toBe("/");
  });
  // Browsers strip tab and newlines and read a backslash as a slash: each of these would open another site.
  it.each([["/\t/evil.example"], ["/\n/evil.example"], ["/\r\n/evil.example"], ["/\\/evil.example"], ["/%09/x\u0000"], ["/ok\u007f"]])(
    "rejects a path a browser would turn into another site: %j",
    (v) => {
      expect(safeNextPath(v)).toBe("/");
    },
  );
  it("keeps encoded characters, which stay on this site", () => {
    expect(safeNextPath("/patients?q=dela%20cruz")).toBe("/patients?q=dela%20cruz");
    expect(safeNextPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
  });
});

describe("safeNextPath with custom auth paths", () => {
  it("never redirects back to any sign-in page", () => {
    expect(safeNextPath("/activate?x=1", "/", ["/login", "/activate"])).toBe("/");
    expect(safeNextPath("/activities", "/", ["/login", "/activate"])).toBe("/activities");
  });
});
