import { randomInt } from "node:crypto";
import { sha256Hex } from "@healthcare/core";
import { generateActivationCode, normalizeActivationCode } from "../portal/activation-code";

/** How long an emailed verification code works, how many wrong tries burn it, and how often one may be sent. */
export const VERIFICATION_VALID_MINUTES = 15;
export const VERIFICATION_MAX_FAILED_ATTEMPTS = 5;
export const VERIFICATION_RESEND_SECONDS = 60;
export const VERIFICATION_SENDS_PER_HOUR = 5;

/** Recovery codes made when two-step verification is turned on (or renewed). */
export const RECOVERY_CODE_COUNT = 10;

/** Six digits, from a secure random source. */
export function generateVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Bound to the verification's id, so a code copied from one attempt means nothing for another. */
export function hashVerificationCode(verificationId: string, code: string): string {
  return sha256Hex(`${verificationId}:${code.trim()}`);
}

/** A recovery code looks like "K7M2P-X9QRT" (10 letters and digits; case, spaces and the dash do not matter). */
export function generateRecoveryCode(): string {
  return generateActivationCode();
}

export function looksLikeRecoveryCode(input: string): boolean {
  return /^[A-Z2-9]{10}$/.test(normalizeActivationCode(input));
}

export function hashRecoveryCode(accountId: string, code: string): string {
  return sha256Hex(`${accountId}:${normalizeActivationCode(code)}`);
}

export type SecondFactorKind = "totp" | "recovery_code";

/** What the patient typed as their second step: the six digits of the app, or a recovery code; anything else is neither. */
export function secondFactorKind(input: string): SecondFactorKind | null {
  const trimmed = input.trim();
  if (/^\d{6}$/.test(trimmed.replace(/\s+/g, ""))) return "totp";
  return looksLikeRecoveryCode(trimmed) ? "recovery_code" : null;
}

/** The setup key in groups of four, as authenticator apps show it. */
export function groupSetupKey(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}
