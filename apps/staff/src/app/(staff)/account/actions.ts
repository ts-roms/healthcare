"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import { normalizeSecondFactor, SECOND_FACTOR_HINT } from "@/lib/second-factor";

// The signed-in person's own credentials. Shapes are checked here only to fail fast; the API checks the current
// password or code, audits each attempt and throttles repeated ones.

const code = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app.");

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z.string().min(12, "The new password needs at least 12 characters.").max(128),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "The new passwords do not match.", path: ["confirmPassword"] })
  .refine((v) => v.newPassword !== v.currentPassword, { message: "Choose a password different from the current one.", path: ["newPassword"] });

export async function changeOwnPassword(input: z.input<typeof passwordSchema>): Promise<ActionResult> {
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the passwords." };
  const { currentPassword, newPassword } = parsed.data;
  const result = await actionResult(() => api<void>("/auth/password", { method: "POST", body: { currentPassword, newPassword } }));
  // A temporary password no longer blocks the other pages (the layout reads the flag from the session).
  if (result.ok) revalidatePath("/", "layout");
  return result.ok ? { ok: true, data: null } : result;
}

export async function beginTwoStep(): Promise<ActionResult<{ secret: string; otpauthUri: string }>> {
  return actionResult(() => api<{ secret: string; otpauthUri: string }>("/auth/mfa/setup", { method: "POST" }));
}

/**
 * Turns it on and returns the recovery codes, shown once. Nothing is revalidated here: the form shows the codes first
 * and refreshes the page when the person has saved them (the set-up gate would otherwise disappear with them).
 */
export async function confirmTwoStep(input: string): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  const parsed = code.safeParse(input.replace(/\s/g, ""));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Enter the code." };
  return actionResult(() => api<{ recoveryCodes: string[] }>("/auth/mfa/confirm", { method: "POST", body: { code: parsed.data } }));
}

/** New recovery codes (the old ones stop working): the password and the app's current code. */
export async function renewRecoveryCodes(password: string, input: string): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  const parsed = code.safeParse(input.replace(/\s/g, ""));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Enter the code." };
  if (!password) return { ok: false, message: "Enter your password." };
  return actionResult(() => api<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", { method: "POST", body: { password, code: parsed.data } }));
}

export async function turnOffTwoStep(password: string, input: string): Promise<ActionResult> {
  const secondFactor = normalizeSecondFactor(input);
  if (!secondFactor) return { ok: false, message: SECOND_FACTOR_HINT };
  if (!password) return { ok: false, message: "Enter your password." };
  const result = await actionResult(() => api<void>("/auth/mfa/disable", { method: "POST", body: { password, code: secondFactor } }));
  if (result.ok) revalidatePath("/", "layout");
  return result.ok ? { ok: true, data: null } : result;
}
