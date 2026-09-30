import {
  generateRecoveryCode,
  generateVerificationCode,
  groupSetupKey,
  hashRecoveryCode,
  hashVerificationCode,
  looksLikeRecoveryCode,
  secondFactorKind,
} from "./portal-security.rules";

describe("portal security rules", () => {
  it("makes six-digit verification codes, keeping leading zeros", () => {
    for (let i = 0; i < 200; i++) expect(generateVerificationCode()).toMatch(/^\d{6}$/);
  });

  it("binds a verification code's hash to its attempt", () => {
    expect(hashVerificationCode("a", "123456")).toBe(hashVerificationCode("a", " 123456 "));
    expect(hashVerificationCode("a", "123456")).not.toBe(hashVerificationCode("b", "123456"));
  });

  it("recognises recovery codes however they are typed, and binds them to the account", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(looksLikeRecoveryCode(code.toLowerCase().replace("-", " "))).toBe(true);
    expect(hashRecoveryCode("acct", code)).toBe(hashRecoveryCode("acct", code.toLowerCase()));
    expect(hashRecoveryCode("acct", code)).not.toBe(hashRecoveryCode("other", code));
  });

  it("tells the app's code from a recovery code", () => {
    expect(secondFactorKind("123456")).toBe("totp");
    expect(secondFactorKind("123 456")).toBe("totp");
    expect(secondFactorKind("K7M2P-X9QRT")).toBe("recovery_code");
    expect(secondFactorKind("k7m2p x9qrt")).toBe("recovery_code");
    expect(secondFactorKind("12345")).toBeNull();
    expect(secondFactorKind("")).toBeNull();
  });

  it("groups the setup key", () => {
    expect(groupSetupKey("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
  });
});
