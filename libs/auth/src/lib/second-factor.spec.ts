import { generateRecoveryCode, hashRecoveryCode, normalizeRecoveryCode, secondFactorKind } from "./second-factor";

describe("second factor", () => {
  it("makes readable recovery codes without look-alike characters", () => {
    for (let i = 0; i < 50; i++) expect(generateRecoveryCode()).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  });

  it("tells the app's code from a recovery code, whatever the case, spaces or dash", () => {
    expect(secondFactorKind("123456")).toBe("totp");
    expect(secondFactorKind("123 456")).toBe("totp");
    expect(secondFactorKind("k7m2p x9qrt")).toBe("recovery_code");
    expect(secondFactorKind("K7M2P-X9QRT")).toBe("recovery_code");
    expect(secondFactorKind("K7M2P-X9QR0")).toBeNull();
    expect(secondFactorKind("12345")).toBeNull();
  });

  it("hashes a code per account, ignoring how it was typed", () => {
    expect(normalizeRecoveryCode("k7m2p-x9qrt")).toBe("K7M2PX9QRT");
    expect(hashRecoveryCode("a", "k7m2p x9qrt")).toBe(hashRecoveryCode("a", "K7M2P-X9QRT"));
    expect(hashRecoveryCode("a", "K7M2P-X9QRT")).not.toBe(hashRecoveryCode("b", "K7M2P-X9QRT"));
  });
});
