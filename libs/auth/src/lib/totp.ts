import { authenticator } from "otplib";

// RFC 6238 defaults (SHA-1, 6 digits, 30 s) for authenticator-app compatibility;
// accept one step of clock drift either side.
authenticator.options = { window: 1 };

export const TOTP_ISSUER = "Healthcare Platform";

export function generateTotpSecret(): string {
  return authenticator.generateSecret(20);
}

export function totpUri(accountName: string, secret: string, issuer: string = TOTP_ISSUER): string {
  return authenticator.keyuri(accountName, issuer, secret);
}

export function verifyTotp(secret: string, code: string): boolean {
  return /^\d{6}$/.test(code) && authenticator.check(code, secret);
}

/** Test helper: the current code for a secret, or the one `stepOffset` 30-second steps away (codes work once). */
export function currentTotp(secret: string, stepOffset = 0): string {
  return stepOffset === 0 ? authenticator.generate(secret) : authenticator.clone({ epoch: Date.now() + stepOffset * 30_000 }).generate(secret);
}

const TOTP_STEP_SECONDS = 30;

/**
 * The time step a code was generated for (within the accepted clock drift), or null when it is wrong. Callers that keep
 * the last accepted step refuse a code whose step is not newer, so a code works once.
 */
export function verifyTotpStep(secret: string, code: string): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = authenticator.checkDelta(code, secret);
  return delta === null ? null : Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + delta;
}
