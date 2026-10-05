"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import QRCode from "qrcode";
import { portalApi } from "@/lib/api/client";
import { COOKIES } from "@/lib/api/config";
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

/**
 * Asks for a new authenticator secret (needs the password and a verified email). The QR code of the `otpauth://` link is
 * drawn here, on the server, so the secret never goes to a third party; it is shown once and not stored.
 */
export async function beginMfa(password: string): Promise<Result<PortalMfaSetup>> {
  if (!password) return { ok: false, message: "Enter your password." };
  const result = await run(() => portalApi<PortalMfaSetup>("/portal/mfa/setup", { method: "POST", body: { password } }));
  if (!result.ok) return result;
  const qrSvg = await QRCode.toString(result.data.otpauthUri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { ok: true, data: { ...result.data, qrSvg } };
}

/** Forgets one remembered browser; when it is this one, its cookie goes too, so the next sign-in asks for the code. */
export async function forgetDevice(deviceId: string, current: boolean): Promise<Result<undefined>> {
  const result = done(await run(() => portalApi<undefined>(`/portal/mfa/devices/${encodeURIComponent(deviceId)}/forget`, { method: "POST" })));
  if (result.ok && current) (await cookies()).delete(COOKIES.device);
  return result;
}

export async function forgetAllDevices(): Promise<Result<{ forgotten: number }>> {
  const result = done(await run(() => portalApi<{ forgotten: number }>("/portal/mfa/devices/forget-all", { method: "POST" })));
  if (result.ok) (await cookies()).delete(COOKIES.device);
  return result;
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
