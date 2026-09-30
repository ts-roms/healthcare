import { describe, expect, it } from "vitest";
import { normalizeSecondFactor } from "./second-factor";

describe("normalizeSecondFactor", () => {
  it("accepts the app's six digits, with spaces", () => {
    expect(normalizeSecondFactor("123 456")).toBe("123456");
  });

  it("accepts a recovery code however it is typed", () => {
    expect(normalizeSecondFactor("k7m2p x9qrt")).toBe("K7M2P-X9QRT");
    expect(normalizeSecondFactor("K7M2PX9QRT")).toBe("K7M2P-X9QRT");
  });

  it("refuses anything else", () => {
    expect(normalizeSecondFactor("12345")).toBeNull();
    expect(normalizeSecondFactor("K7M2P-X9QR")).toBeNull();
    expect(normalizeSecondFactor("")).toBeNull();
  });
});
