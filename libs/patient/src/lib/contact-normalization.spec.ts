import { BusinessRuleError } from "@healthcare/core";
import { normalizeContact } from "./contact-normalization";

describe("normalizeContact", () => {
  it("normalizes Philippine mobile numbers to E.164", () => {
    expect(normalizeContact("mobile", "0917 123 4567")).toBe("+639171234567");
  });

  it("accepts foreign mobile numbers already in E.164", () => {
    expect(normalizeContact("mobile", "+65 9123 4567")).toBe("+6591234567");
  });

  it("rejects unrecognizable mobile numbers", () => {
    expect(() => normalizeContact("mobile", "12345")).toThrow(BusinessRuleError);
  });

  it("keeps landline digits", () => {
    expect(normalizeContact("phone", "(02) 8123-4567")).toBe("0281234567");
  });

  it("lower-cases email", () => {
    expect(normalizeContact("email", " Juan@Example.PH ")).toBe("juan@example.ph");
    expect(() => normalizeContact("email", "not-an-email")).toThrow(BusinessRuleError);
  });
});
