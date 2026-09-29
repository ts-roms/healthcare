import { csvCell, percent, pesos } from "./management-dashboard.csv";

describe("management dashboard CSV", () => {
  it("prefixes text a spreadsheet would read as a formula", () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+639171234567")).toBe("'+639171234567");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-cmd")).toBe("'-cmd");
    // Plain numbers (also negative amounts as text) stay numbers; "<5" is not a formula.
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell("<5")).toBe("<5");
  });

  it("quotes commas, quotes and line breaks; leaves empty cells empty", () => {
    expect(csvCell("Reyes, Jose")).toBe('"Reyes, Jose"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell(null)).toBe("");
  });

  it("writes pesos and percentages plainly", () => {
    expect(pesos(123_456)).toBe("1234.56");
    expect(pesos(-1_005)).toBe("-10.05");
    expect(pesos(null)).toBeNull();
    expect(percent(0.1234)).toBe("12.3");
    expect(percent(1.25)).toBe("125.0");
    expect(percent(null)).toBeNull();
  });
});
