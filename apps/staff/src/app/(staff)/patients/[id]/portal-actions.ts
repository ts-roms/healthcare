"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { ApiError, userMessage } from "@healthcare/web-session";
import { api } from "@/lib/api/client";
import type { PortalInvitation } from "@/lib/api/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PortalActionResult<T = undefined> = { ok: true; value: T } | { ok: false; message: string };

function failure(error: unknown): { ok: false; message: string } {
  unstable_rethrow(error);
  return { ok: false, message: error instanceof ApiError ? userMessage(error) : "The server could not be reached. Try again." };
}

/** Issues a one-time activation code (replacing any earlier unused code). The API checks permission and portal consent. */
export async function invitePortal(patientId: string): Promise<PortalActionResult<PortalInvitation>> {
  if (!UUID.test(patientId)) return { ok: false, message: "Unknown patient." };
  try {
    const invitation = await api<PortalInvitation>(`/patients/${patientId}/portal-account/invitations`, { method: "POST" });
    revalidatePath(`/patients/${patientId}`);
    return { ok: true, value: invitation };
  } catch (error) {
    return failure(error);
  }
}

/** Disables portal access and ends the patient's portal sessions. */
export async function disablePortal(patientId: string, reason: string): Promise<PortalActionResult> {
  if (!UUID.test(patientId)) return { ok: false, message: "Unknown patient." };
  const trimmed = reason.trim();
  if (trimmed.length < 5) return { ok: false, message: "Give a reason of at least 5 characters." };
  try {
    await api(`/patients/${patientId}/portal-account/disable`, { method: "POST", body: { reason: trimmed } });
    revalidatePath(`/patients/${patientId}`);
    return { ok: true, value: undefined };
  } catch (error) {
    return failure(error);
  }
}

/** Turns off the patient's two-step verification (lost phone and recovery codes) and ends their sessions; the reason is audited. */
export async function resetPortalMfa(patientId: string, reason: string): Promise<PortalActionResult> {
  if (!UUID.test(patientId)) return { ok: false, message: "Unknown patient." };
  const trimmed = reason.trim();
  if (trimmed.length < 5) return { ok: false, message: "Give a reason of at least 5 characters." };
  try {
    await api(`/patients/${patientId}/portal-account/mfa-reset`, { method: "POST", body: { reason: trimmed } });
    revalidatePath(`/patients/${patientId}`);
    return { ok: true, value: undefined };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Sends a message to the patient's MyHealth inbox (in-app only: free text never goes out by SMS or email).
 * The API checks `notification.send`, the portal account and consent; `attemptId` makes a retried submit a no-op.
 */
export async function sendPortalMessage(patientId: string, input: { title: string; body: string; attemptId: string }): Promise<PortalActionResult> {
  if (!UUID.test(patientId) || !UUID.test(input.attemptId)) return { ok: false, message: "Unknown patient." };
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || title.length > 80) return { ok: false, message: "Give a subject of up to 80 characters." };
  if (!body || body.length > 2000) return { ok: false, message: "Write a message of up to 2,000 characters." };
  try {
    const sent = await api<{ status: string; suppressionReason: string | null }>("/notifications", {
      method: "POST",
      body: {
        recipient: { type: "patient", patientId },
        channel: "in_app",
        templateKey: "clinic.message",
        variables: { title, body },
        idempotencyKey: `staff-message:${input.attemptId}`,
      },
    });
    if (sent.status === "suppressed") {
      return { ok: false, message: "Not delivered: the patient has no active MyHealth account or has turned off in-app messages." };
    }
    return { ok: true, value: undefined };
  } catch (error) {
    return failure(error);
  }
}
