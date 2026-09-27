import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-path";

describe("safeNextPath", () => {
  it("allows same-origin relative paths", () => {
    expect(safeNextPath("/patients?q=cruz")).toBe("/patients?q=cruz");
  });
  it.each([["https://evil.example"], ["//evil.example"], ["/\\evil.example"], ["patients"], [undefined], ["/login"]])("rejects %s", (v) => {
    expect(safeNextPath(v)).toBe("/");
  });
});
