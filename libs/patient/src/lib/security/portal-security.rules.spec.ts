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
  PASSKEY_LIMIT,
  passkeyCounterRolledBack,
  passkeyRelyingParty,
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

  it("takes the passkey relying party from MyHealth's address, and offers none without one", () => {
    expect(passkeyRelyingParty("https://myhealth.example.ph")).toEqual({ rpID: "myhealth.example.ph", origin: "https://myhealth.example.ph" });
    expect(passkeyRelyingParty("https://myhealth.example.ph:8443/app")).toEqual({ rpID: "myhealth.example.ph", origin: "https://myhealth.example.ph:8443" });
    expect(passkeyRelyingParty("http://localhost:3001")).toEqual({ rpID: "localhost", origin: "http://localhost:3001" });
    expect(passkeyRelyingParty("http://myhealth.example.ph")).toBeNull();
    expect(passkeyRelyingParty(undefined)).toBeNull();
    expect(passkeyRelyingParty("not a url")).toBeNull();
    expect(PASSKEY_LIMIT).toBe(5);
  });

  it("refuses a passkey counter that went backwards or stood still, unless the authenticator keeps none", () => {
    expect(passkeyCounterRolledBack(0, 0)).toBe(false);
    expect(passkeyCounterRolledBack(0, 1)).toBe(false);
    expect(passkeyCounterRolledBack(5, 6)).toBe(false);
    expect(passkeyCounterRolledBack(5, 5)).toBe(true);
    expect(passkeyCounterRolledBack(5, 2)).toBe(true);
    expect(passkeyCounterRolledBack(5, 0)).toBe(true);
  });
});
