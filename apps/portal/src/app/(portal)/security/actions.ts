"use server";

import { revalidatePath } from "next/cache";
import { portalApi } from "@/lib/api/client";
import { type Result, run } from "@/lib/api/result";
import type { PortalMfaSetup } from "@/lib/api/types";

type Sent = { sentTo: string; validMinutes: number };

const done = <T>(result: Result<T>): Result<T> => {
  if (result.ok) {
    revalidatePath("/security");
    revalidatePath("/profile");
    revalidatePath("/");
  }
  return result;
};

/** Sends a 6-digit code to the sign-in email. The API limits how often, and refuses an email that is already verified. */
export async function sendEmailCode(): Promise<Result<Sent>> {
  return done(await run(() => portalApi<Sent>("/portal/email/verification", { method: "POST" })));
}

/** Enters the code: verifies the email, or completes a change of it. */
export async function confirmEmailCode(code: string): Promise<Result<{ email: string; changed: boolean }>> {
  if (!/^\d{6}$/.test(code)) return { ok: false, message: "Enter the 6 digits from the email." };
  return done(await run(() => portalApi<{ email: string; changed: boolean }>("/portal/email/verification/confirm", { method: "POST", body: { code } })));
}

/** Starts switching the sign-in email: a code goes to the new address, and nothing changes until it is entered. */
export async function changeEmail(input: { newEmail: string; password: string; code?: string }): Promise<Result<Sent>> {
  const newEmail = input.newEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) return { ok: false, message: "Enter a valid email address." };
  if (!input.password) return { ok: false, message: "Enter your password." };
  return done(
    await run(() =>
      portalApi<Sent>("/portal/email/change", { method: "POST", body: { newEmail, password: input.password, code: input.code?.trim() || undefined } }),
    ),
  );
}

/** Asks for a new authenticator secret (needs the password and a verified email). */
export async function beginMfa(password: string): Promise<Result<PortalMfaSetup>> {
  if (!password) return { ok: false, message: "Enter your password." };
  return run(() => portalApi<PortalMfaSetup>("/portal/mfa/setup", { method: "POST", body: { password } }));
}

/** Turns two-step verification on with the code the app shows; the recovery codes come back once. */
export async function enableMfa(code: string): Promise<Result<{ recoveryCodes: string[] }>> {
  if (!/^\d{6}$/.test(code.replace(/\s+/g, ""))) return { ok: false, message: "Enter the 6 digits from your authenticator app." };
  return done(await run(() => portalApi<{ recoveryCodes: string[] }>("/portal/mfa/enable", { method: "POST", body: { code } })));
}

export async function disableMfa(input: { password: string; code: string }): Promise<Result<undefined>> {
  if (!input.password || !input.code.trim()) return { ok: false, message: "Enter your password and a code." };
  return done(await run(() => portalApi<undefined>("/portal/mfa/disable", { method: "POST", body: input })));
}

export async function renewRecoveryCodes(input: { password: string; code: string }): Promise<Result<{ recoveryCodes: string[] }>> {
  if (!input.password || !input.code.trim()) return { ok: false, message: "Enter your password and the code from your authenticator app." };
  return done(await run(() => portalApi<{ recoveryCodes: string[] }>("/portal/mfa/recovery-codes", { method: "POST", body: input })));
}
