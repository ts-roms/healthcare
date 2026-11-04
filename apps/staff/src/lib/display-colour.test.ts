import { describe, expect, it } from "vitest";
import { contrastWithWhite, MIN_ACCENT_CONTRAST, readableAccent } from "./display-colour";

describe("display colour", () => {
  it("measures the contrast of white text on a colour", () => {
    expect(contrastWithWhite("#000000")).toBeCloseTo(21, 0);
    expect(contrastWithWhite("#FFFFFF")).toBeCloseTo(1, 1);
    expect(contrastWithWhite("#0f5c57")).toBeGreaterThan(MIN_ACCENT_CONTRAST);
    expect(contrastWithWhite("not a colour")).toBe(0);
    expect(contrastWithWhite("#12345")).toBe(0);
  });

  it("uses the clinic's colour only when the white text on it stays readable", () => {
    expect(readableAccent("#1A7F8E")).toBe("#1A7F8E");
    expect(readableAccent("#0F5C57")).toBe("#0F5C57");
    // Too light: white on it would be hard to read from across a room.
    expect(readableAccent("#FFEE00")).toBeUndefined();
    expect(readableAccent("#CCCCCC")).toBeUndefined();
    expect(readableAccent(null)).toBeUndefined();
    expect(readableAccent("teal")).toBeUndefined();
  });
});
