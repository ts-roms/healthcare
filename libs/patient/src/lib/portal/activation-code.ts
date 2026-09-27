import { randomInt } from "node:crypto";
import { sha256Hex } from "@healthcare/core";

/** No 0/O or 1/I/L: codes are read aloud and typed from paper. 31 symbols ≈ 4.95 bits each. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 10;

/** Activation codes expire after this many hours. */
export const ACTIVATION_TTL_HOURS = 72;
/** Wrong activation attempts before the code is destroyed and a new invitation is needed. */
export const MAX_ACTIVATION_ATTEMPTS = 5;

/**
 * One-time code handed to the patient at the front desk, e.g. "K7M2P-X9QRT".
 * ~49 bits, and only usable together with the patient number and birth date,
 * within 72 hours, for 5 attempts — brute force is not practical.
 */
export function generateActivationCode(): string {
  const chars = Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/** Tolerates lower case, spaces and dashes, as patients type them. */
export function normalizeActivationCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, "");
}

export function hashActivationCode(code: string): string {
  return sha256Hex(normalizeActivationCode(code));
}
