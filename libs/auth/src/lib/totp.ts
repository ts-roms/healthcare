import { authenticator } from "otplib";

// RFC 6238 defaults (SHA-1, 6 digits, 30 s) for authenticator-app compatibility;
// accept one step of clock drift either side.
authenticator.options = { window: 1 };

export const TOTP_ISSUER = "Healthcare Platform";

export function generateTotpSecret(): string {
  return authenticator.generateSecret(20);
}

export function totpUri(accountName: string, secret: string): string {
  return authenticator.keyuri(accountName, TOTP_ISSUER, secret);
}

export function verifyTotp(secret: string, code: string): boolean {
  return /^\d{6}$/.test(code) && authenticator.check(code, secret);
}

/** Test helper: the current code for a secret. */
export function currentTotp(secret: string): string {
  return authenticator.generate(secret);
}
