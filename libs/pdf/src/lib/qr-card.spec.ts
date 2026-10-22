import { CARD_STOCK, extractPdfText, qrMatrix, renderQrCards } from "../index";

describe("QR card", () => {
  it("builds a square matrix with the three finder patterns", () => {
    const m = qrMatrix("HPQ1:T:ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === m.length)).toBe(true);
    const n = m.length;
    for (const [r, c] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ] as const) {
      expect(m[r]?.slice(c, c + 7)).toEqual([true, true, true, true, true, true, true]);
      expect(m[r + 3]?.[c + 3]).toBe(true);
    }
  });

  it("renders one page per card with the text and not the encoded value", async () => {
    const pdf = await renderQrCards(
      CARD_STOCK,
      [{ qr: "HPQ1:N:P00000001", heading: "Demo Clinic", lines: [{ text: "Dela Cruz, Juan", bold: true }, { text: "P00000001" }] }],
      {
        title: "Patient card",
        uncompressed: true,
      },
    );
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const text = extractPdfText(pdf);
    expect(text).toContain("Dela Cruz, Juan");
    expect(text).toContain("P00000001");
    expect(text).not.toContain("HPQ1");
    expect(() => renderQrCards(CARD_STOCK, [], { title: "x" })).toThrow();
  });
});
