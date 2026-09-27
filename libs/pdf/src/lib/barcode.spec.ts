import { CODE128_PATTERNS, code128Modules, code128Values, extractPdfText, renderLabels, SPECIMEN_LABEL_STOCK } from "../index";

/** Reads modules back to symbol values by their bar/space widths, as a scanner does. */
function decode(modules: boolean[]): number[] {
  const bits = modules.map((m) => (m ? "1" : "0")).join("");
  const values: number[] = [];
  for (let i = 0; i < bits.length;) {
    const width = bits.length - i === 13 ? 13 : 11;
    const value = CODE128_PATTERNS.indexOf(bits.slice(i, i + width));
    if (value < 0) throw new Error(`Unknown symbol at module ${i}`);
    values.push(value);
    i += width;
  }
  return values;
}

describe("Code 128", () => {
  it("has 107 distinct symbols of 3 bars and 3 spaces with an even bar width (stop: 4 bars)", () => {
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    CODE128_PATTERNS.forEach((pattern, value) => {
      const runs = pattern.match(/1+|0+/g) ?? [];
      const bars = runs.filter((r) => r.startsWith("1"));
      expect(pattern.startsWith("1")).toBe(true);
      expect(pattern).toHaveLength(value === 106 ? 13 : 11);
      expect(bars).toHaveLength(value === 106 ? 4 : 3);
      if (value !== 106) expect(bars.join("").length % 2).toBe(0);
      expect(runs.every((r) => r.length <= 4)).toBe(true);
    });
  });

  it("uses the standard start and stop patterns", () => {
    expect(CODE128_PATTERNS[104]).toBe("11010010000"); // Start B
    expect(CODE128_PATTERNS[105]).toBe("11010011100"); // Start C
    expect(CODE128_PATTERNS[106]).toBe("1100011101011"); // Stop
  });

  it("encodes an accession number in code set C, two digits per symbol, with the mod-103 check", () => {
    const values = code128Values("2609270001");
    // Start C, 26 09 27 00 01, check, stop.
    const check = (105 + 26 * 1 + 9 * 2 + 27 * 3 + 0 * 4 + 1 * 5) % 103;
    expect(values).toEqual([105, 26, 9, 27, 0, 1, check, 106]);
    expect(decode(code128Modules("2609270001"))).toEqual(values);
  });

  it("falls back to code set B for other text", () => {
    const values = code128Values("LAB-7");
    const data = [..."LAB-7"].map((c) => c.charCodeAt(0) - 32);
    const check = data.reduce((sum, v, i) => sum + v * (i + 1), 104) % 103;
    expect(values).toEqual([104, ...data, check, 106]);
    expect(code128Values("123")[0]).toBe(104);
    expect(() => code128Values("Peña")).toThrow();
    expect(() => code128Values("")).toThrow();
  });
});

describe("labels", () => {
  it("renders one label per page at the label stock size, with the barcode text", async () => {
    const pdf = await renderLabels(
      SPECIMEN_LABEL_STOCK,
      [1, 2].map((copy) => ({
        top: [{ text: "DELA CRUZ, Juan Peñaranda", bold: true }],
        barcode: "2609270001",
        bottom: [{ text: `Copy ${copy}` }],
      })),
      { title: "Specimen label", uncompressed: true },
    );
    const source = pdf.toString("latin1");
    expect(source.match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(source).toContain("/MediaBox [0 0 162 90]");
    const text = extractPdfText(pdf);
    expect(text).toContain("2609270001");
    expect(text).toContain("DELA CRUZ, Juan Peñaranda");
    expect(text).toContain("Copy 2");
  });
});
