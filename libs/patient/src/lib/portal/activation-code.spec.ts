import { generateActivationCode, hashActivationCode, normalizeActivationCode } from "./activation-code";

describe("activation codes", () => {
  it("are 10 unambiguous characters in two groups", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateActivationCode();
      expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{5}-[A-HJ-KM-NP-Z2-9]{5}$/);
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it("are not repeated", () => {
    const codes = new Set(Array.from({ length: 1000 }, generateActivationCode));
    expect(codes.size).toBe(1000);
  });

  it("match however the patient types them", () => {
    expect(normalizeActivationCode(" k7m2p x9qrt ")).toBe("K7M2PX9QRT");
    expect(hashActivationCode("k7m2p-x9qrt")).toBe(hashActivationCode("K7M2PX9QRT"));
    expect(hashActivationCode("K7M2P-X9QRT")).not.toBe(hashActivationCode("K7M2P-X9QRA"));
  });
});
