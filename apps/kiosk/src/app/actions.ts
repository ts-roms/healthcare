"use server";

import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { ApiError } from "@healthcare/web-session";
import { COOKIES, SECURE_COOKIES } from "@/lib/config";
import { kioskApi } from "@/lib/api";
import type { KioskAppointment, KioskTicket } from "@/lib/flow";
import type { PrintState } from "@/lib/print-status";
import type { RegistrationPayload } from "@/lib/registration";

/** What every action returns: the screen shows `message` as it is, so it must be fit for a patient to read. */
export type Result<T> = { ok: true; data: T } | { ok: false; message: string; code?: string };

const FALLBACK = "Something went wrong. Please try again, or see the front desk.";

/** Errors after which the person's session is over and the screen must start again. */
const SESSION_OVER = new Set(["kiosk_session_expired", "kiosk_session_locked", "kiosk_cooling_down"]);

async function run<T>(call: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await call() };
  } catch (error) {
    // The device was signed out (a redirect) or another Next control-flow signal.
    unstable_rethrow(error);
    if (error instanceof ApiError) {
      if (SESSION_OVER.has(error.code)) (await cookies()).delete(COOKIES.session);
      return { ok: false, code: error.code, message: error.message || FALLBACK };
    }
    return { ok: false, message: FALLBACK };
  }
}

const sessionCookie = { httpOnly: true, secure: SECURE_COOKIES, sameSite: "strict", path: "/" } as const;

/** Starts a session for the person who touched the screen; the token goes to an httpOnly cookie, not to the page. */
export async function beginSession(): Promise<Result<{ idleSeconds: number }>> {
  return run(async () => {
    const opened = await kioskApi<{ token: string; expiresAt: string; idleSeconds: number }>("/kiosk/sessions", { method: "POST" });
    (await cookies()).set(COOKIES.session, opened.token, { ...sessionCookie, maxAge: 15 * 60 });
    return { idleSeconds: opened.idleSeconds };
  });
}

export async function identifyPatient(input: {
  key: string;
  birthDate: string;
  givenName: string;
}): Promise<Result<{ patient: { maskedName: string; birthYear: number }; appointments: KioskAppointment[] }>> {
  return run(async () => {
    const patient = await kioskApi<{ maskedName: string; birthYear: number }>("/kiosk/identify", { method: "POST", body: input, withSession: true });
    const { items } = await kioskApi<{ items: KioskAppointment[] }>("/kiosk/appointments", { withSession: true });
    return { patient, appointments: items };
  });
}

/** `key` makes a retry (a second tap, a dropped connection) return the same ticket instead of a second one. */
export async function checkIn(input: { appointmentId?: string; visitTypeId?: string }, key: string): Promise<Result<KioskTicket>> {
  return run(() => kioskApi<KioskTicket>("/kiosk/check-in", { method: "POST", body: input, idempotencyKey: key, withSession: true }));
}

export async function submitRegistration(payload: RegistrationPayload, key: string): Promise<Result<{ reference: string }>> {
  return run(() => kioskApi<{ reference: string }>("/kiosk/registrations", { method: "POST", body: payload, idempotencyKey: key, withSession: true }));
}

/** Ends the person's session on the server and forgets the token. Safe to call when there is none. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const had = jar.get(COOKIES.session)?.value;
  jar.delete(COOKIES.session);
  if (!had) return;
  try {
    await kioskApi<void>("/kiosk/sessions", { method: "DELETE" });
  } catch (error) {
    unstable_rethrow(error);
    // The server ends it after two idle minutes anyway.
  }
}

/** How printing is going for a ticket this kiosk queued: status only. */
export async function printStatus(jobId: string): Promise<Result<{ status: PrintState; attempts: number; error: string | null }>> {
  return run(() => kioskApi<{ status: PrintState; attempts: number; error: string | null }>(`/kiosk/print-jobs/${encodeURIComponent(jobId)}`));
}

/**
 * The kiosk reports itself and its version. The printer's state is the print agent's to report (it sees the printer; the
 * screen does not), so the screen never claims one.
 */
export async function sendHeartbeat(input: { appVersion: string }): Promise<Result<{ status: "active" | "maintenance" | "disabled" }>> {
  return run(() => kioskApi<{ status: "active" | "maintenance" | "disabled" }>("/kiosk/heartbeat", { method: "POST", body: input }));
}
