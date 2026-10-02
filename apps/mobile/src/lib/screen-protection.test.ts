import { describe, expect, it } from "vitest";
import { shouldCover } from "./screen-protection";

describe("shouldCover", () => {
  it("shows the cover whenever the app is not plainly active", () => {
    expect(shouldCover("active")).toBe(false);
    expect(shouldCover("inactive")).toBe(true);
    expect(shouldCover("background")).toBe(true);
    expect(shouldCover("extension")).toBe(true);
    expect(shouldCover("unknown")).toBe(true);
    expect(shouldCover(null)).toBe(true);
    expect(shouldCover(undefined)).toBe(true);
  });
});
