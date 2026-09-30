/**
 * The second sign-in step as typed: the 6 digits from the authenticator app, or a recovery code ("K7M2P-X9QRT"; case,
 * spaces and the dash do not matter). Only a shape check to fail fast; the API decides whether the code is right.
 */
export function normalizeSecondFactor(input: string): string | null {
  const digits = input.replace(/\s+/g, "");
  if (/^\d{6}$/.test(digits)) return digits;
  const recovery = input.toUpperCase().replace(/[\s-]+/g, "");
  return /^[A-Z2-9]{10}$/.test(recovery) ? `${recovery.slice(0, 5)}-${recovery.slice(5)}` : null;
}

export const SECOND_FACTOR_HINT = "Enter the 6-digit code from your authenticator app, or one of your recovery codes.";
