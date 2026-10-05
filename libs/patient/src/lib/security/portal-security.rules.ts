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

/** Trusted devices (migration 0100): how long a browser is remembered, and how many per account. */
export const TRUSTED_DEVICE_DAYS = 30;
export const TRUSTED_DEVICE_LIMIT = 5;

/** Days' notice an organization must give before requiring two-step verification of patients. */
export const PATIENT_MFA_MIN_NOTICE_DAYS = 7;

/**
 * Whether a patient without two-step verification may only set it up now: the policy requires it and its start date
 * (a local date, compared as a calendar day) has arrived. `today` is the local date "YYYY-MM-DD".
 */
export function patientMfaEnrollmentRequired(policy: { required: boolean; requiredFrom: string | null } | null, mfaEnabled: boolean, today: string): boolean {
  if (!policy?.required || mfaEnabled) return false;
  return policy.requiredFrom === null || policy.requiredFrom <= today;
}

/** A short, non-identifying description of a browser for the trusted-devices list ("Chrome on Android"). */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  return os ? `${browser} on ${os}` : browser;
}
