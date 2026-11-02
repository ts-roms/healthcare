import { maskIdentifierValue, withIdentifierMasking } from "./identifier-masking";

describe("identifier masking", () => {
  it("keeps the last four digits and the separators", () => {
    expect(maskIdentifierValue("12-345678901-2")).toBe("••-••••••901-2");
    expect(maskIdentifierValue("123456789012")).toBe("••••••••9012");
  });

  it("hides letters and short values entirely", () => {
    expect(maskIdentifierValue("P1234567A")).toBe("••••4567•");
    expect(maskIdentifierValue("AB12")).toBe("••12");
    expect(maskIdentifierValue("12")).toBe("12");
  });

  it("masks only for callers who may not see the value", () => {
    const list = [{ id: "1", value: "12-345678901-2" }];
    expect(withIdentifierMasking(list, true)).toEqual(list);
    expect(withIdentifierMasking(list, false)).toEqual([{ id: "1", value: "••-••••••901-2" }]);
    expect(list[0]?.value).toBe("12-345678901-2");
  });
});
