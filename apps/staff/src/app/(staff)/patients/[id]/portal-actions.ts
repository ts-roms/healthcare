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
