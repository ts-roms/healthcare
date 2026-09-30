import { randomInt } from "node:crypto";
import { sha256Hex } from "@healthcare/core";

/** Recovery codes made when two-step verification is turned on (or renewed). */
export const RECOVERY_CODE_COUNT = 10;

/** No 0/O or 1/I/L: codes are typed from paper. 10 of 31 symbols ≈ 49 bits, single use, behind the password. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A recovery code looks like "K7M2P-X9QRT"; case, spaces and the dash do not matter when typed. */
export function generateRecoveryCode(): string {
  const chars = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, "");
}

/** Bound to the user, so the same code means nothing for another account. */
export function hashRecoveryCode(userId: string, code: string): string {
  return sha256Hex(`${userId}:${normalizeRecoveryCode(code)}`);
}

export type SecondFactorKind = "totp" | "recovery_code";

/** What was typed as the second step: the six digits of the app, a recovery code, or neither. */
export function secondFactorKind(input: string): SecondFactorKind | null {
  if (/^\d{6}$/.test(input.replace(/\s+/g, ""))) return "totp";
  return /^[A-HJ-KM-NP-Z2-9]{10}$/.test(normalizeRecoveryCode(input)) ? "recovery_code" : null;
}
