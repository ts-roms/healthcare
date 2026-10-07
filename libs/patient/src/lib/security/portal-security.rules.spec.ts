import {
  generateRecoveryCode,
  generateVerificationCode,
  groupSetupKey,
  hashRecoveryCode,
  hashVerificationCode,
  looksLikeRecoveryCode,
  secondFactorKind,
  deviceLabel,
  patientMfaEnrollmentRequired,
  TRUSTED_DEVICE_DAYS,
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

describe("patient two-step verification policy and trusted devices (migration 0100)", () => {
  it("requires enrollment only once the policy is on and its start date has arrived, never for an account that has it", () => {
    expect(patientMfaEnrollmentRequired(null, false, "2026-10-05")).toBe(false);
    expect(patientMfaEnrollmentRequired({ required: false, requiredFrom: null }, false, "2026-10-05")).toBe(false);
    expect(patientMfaEnrollmentRequired({ required: true, requiredFrom: null }, false, "2026-10-05")).toBe(true);
    expect(patientMfaEnrollmentRequired({ required: true, requiredFrom: "2026-10-06" }, false, "2026-10-05")).toBe(false);
    // An account the clinic exempted is never held at the set-up (migration 0107).
    expect(patientMfaEnrollmentRequired({ required: true, requiredFrom: null }, false, "2026-10-05", true)).toBe(false);
    expect(patientMfaEnrollmentRequired({ required: true, requiredFrom: "2026-10-01" }, false, "2026-10-05", false)).toBe(true);
    expect(patientMfaEnrollmentRequired({ required: true, requiredFrom: "2026-10-05" }, false, "2026-10-05")).toBe(true);
    expect(patientMfaEnrollmentRequired({ required: true, requiredFrom: "2026-09-01" }, false, "2026-10-05")).toBe(true);
    expect(patientMfaEnrollmentRequired({ required: true, requiredFrom: null }, true, "2026-10-05")).toBe(false);
  });

  it("labels a browser without keeping the user agent", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36")).toBe(
      "Chrome on Android",
    );
    expect(
      deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"),
    ).toBe("Safari on iOS");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0")).toBe("Firefox on Windows");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0")).toBe(
      "Edge on Windows",
    );
    expect(deviceLabel("curl/8.0")).toBe("Browser");
    expect(deviceLabel(null)).toBe("Browser");
    expect(TRUSTED_DEVICE_DAYS).toBe(30);
  });
});
