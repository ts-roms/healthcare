import { extractPdfText, pdfDate, pdfDateTime, pdfMoney, pesoWords, renderPdf, winAnsi } from "../index";

describe("pdf toolkit", () => {
  it("renders a document with letterhead, fields, a multi-page table, totals and footers", async () => {
    const rows = Array.from({ length: 80 }, (_, i) => [`Line ${i + 1}`, pdfMoney((i + 1) * 100)]);
    const pdf = await renderPdf(
      {
        title: "Test document",
        letterhead: { organizationName: "Demo Health", facilityName: "Main Clinic", addressLines: ["Quezon City"], licenseNumber: "LTO-123" },
        watermark: "DRAFT",
        footerNote: "Not an official receipt.",
        printedAt: "Printed 28 Sep 2026, 14:05",
        uncompressed: true,
      },
      (w) => {
        w.fields([
          ["Patient", "DELA CRUZ, Juan Peñaranda"],
          ["Number", "P00000001"],
          ["Empty", null],
        ]);
        w.table(
          [
            { header: "Item", width: 3 },
            { header: "Amount", width: 1, align: "right" },
          ],
          rows,
        );
        w.totals([["Total", pdfMoney(324_000), true]]);
        w.signatures([{ name: "Dr. Reyes", role: "Pathologist" }]);
      },
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = extractPdfText(pdf);
    expect(text).toContain("Demo Health");
    expect(text).toContain("DELA CRUZ, Juan Peñaranda");
    expect(text).toContain("Line 80");
    expect(text).toContain("PHP 3,240.00");
    expect(text).toMatch(/Page 1 of [2-9]/);
    expect(text).toContain("DRAFT");
    expect(text).not.toContain("Empty");
  });

  it("keeps text within the standard fonts' character set", () => {
    expect(winAnsi("₱500 — ≥ 5 · Niño")).toBe("PHP 500 — >= 5 · Niño");
    expect(winAnsi("漢")).toBe("?");
  });

  it("formats money, dates and amounts in words", () => {
    expect(pdfMoney(123_450)).toBe("PHP 1,234.50");
    expect(pdfDate("2026-09-28")).toBe("28 Sep 2026");
    expect(pdfDateTime(new Date("2026-09-28T06:05:00Z"), "Asia/Manila")).toBe("28 Sep 2026, 14:05");
    expect(pesoWords(123_450)).toBe("One thousand two hundred thirty-four pesos and 50/100");
    expect(pesoWords(100)).toBe("One peso only");
    expect(pesoWords(2_000_000_00)).toBe("Two million pesos only");
  });
});
