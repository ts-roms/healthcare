import { cleanText, normalizeIdentifier, normalizeName } from "./normalize";

describe("normalizeName", () => {
  it("removes diacritics common in Filipino names", () => {
    expect(normalizeName("Peña")).toBe("pena");
    expect(normalizeName("NUÑEZ")).toBe("nunez");
  });

  it("collapses punctuation and whitespace", () => {
    expect(normalizeName("  dela  Cruz-O'Brien ")).toBe("dela cruz o brien");
  });
});

describe("cleanText", () => {
  it("trims and collapses whitespace but keeps case and accents", () => {
    expect(cleanText("  Ma.   Teresa  Peña ")).toBe("Ma. Teresa Peña");
  });
});

describe("normalizeIdentifier", () => {
  it("strips separators and upper-cases", () => {
    expect(normalizeIdentifier("12-345678901-2")).toBe("123456789012");
    expect(normalizeIdentifier("p1234 567a")).toBe("P1234567A");
  });
});
