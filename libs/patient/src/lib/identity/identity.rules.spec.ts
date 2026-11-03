import { givenNameKey, maskedName, selfServiceKey } from "./identity.rules";

describe("self-service identification rules", () => {
  it("reads a patient number in any case or without leading zeros", () => {
    expect(selfServiceKey("p123")).toEqual({ kind: "patient_number", value: "P00000123" });
    expect(selfServiceKey(" P00000123 ")).toEqual({ kind: "patient_number", value: "P00000123" });
  });

  it("reads a Philippine mobile number in the usual spellings", () => {
    const a = selfServiceKey("0917 123 4567");
    const b = selfServiceKey("+63 917 123 4567");
    expect(a).toMatchObject({ kind: "mobile" });
    expect(a).toEqual(b);
  });

  it("accepts nothing else (names, short digit strings) as a key", () => {
    expect(selfServiceKey("Juan Dela Cruz")).toBeNull();
    expect(selfServiceKey("12345")).toBeNull();
    expect(selfServiceKey("")).toBeNull();
  });

  it("compares given names without case, accents or spacing", () => {
    expect(givenNameKey("  JOSÉ  ")).toBe(givenNameKey("jose"));
  });

  it("masks a name to initials", () => {
    expect(maskedName("Juan", "Dela Cruz")).toBe("J*** D*** C***");
    expect(maskedName("ana", "reyes")).toBe("A*** R***");
    expect(maskedName("Juan", "Dela Cruz")).not.toMatch(/uan|ela|ruz/);
  });
});
