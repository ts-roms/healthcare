import { describe, expect, it } from "vitest";
import { cardKeyFromScan } from "./card-link";

const KEY = `HPQ1:T:${"A2".repeat(13)}`;

describe("cardKeyFromScan", () => {
  it("takes the key from a card's MyHealth link", () => {
    expect(cardKeyFromScan(`https://myhealth.example.ph/activate#${KEY}`)).toBe(KEY);
    expect(cardKeyFromScan(` http://localhost:3001/activate#${KEY}\n`)).toBe(KEY);
  });

  it("ignores everything else a camera may read", () => {
    for (const other of [
      "",
      "P00000001",
      KEY,
      `HPQ1:N:P00000001`,
      `https://x.example/other#${KEY}`,
      `https://x.example/activate?k=${KEY}`,
      `https://x.example/activate#HPQ1:T:short`,
    ]) {
      expect(cardKeyFromScan(other)).toBeNull();
    }
  });
});
