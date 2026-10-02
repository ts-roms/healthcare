import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

/**
 * Password policy: length over complexity (NIST SP 800-63B style).
 * Rejects obviously weak values; new passwords are also screened against breached ones (breached-passwords.ts).
 */
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password must be at most 128 characters")
  .refine((value) => new Set(value).size >= 5, "Password is too repetitive");

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations).
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * Verifying against a real hash when the user does not exist keeps response
 * timing similar, so login does not reveal which emails are registered.
 */
let dummyHash: Promise<string> | undefined;
export async function burnPasswordVerification(password: string): Promise<void> {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(await dummyHash, password);
}
