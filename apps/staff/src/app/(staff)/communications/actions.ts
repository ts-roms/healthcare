"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { PatientNotification } from "@/lib/api/types";

const id = z.uuid();
const reason = z.string().trim().min(3, "Give a reason of at least 3 characters.").max(500, "At most 500 characters.");

async function act(kind: "cancel" | "resend", notificationId: string, why: string, patientId: string | null): Promise<ActionResult<PatientNotification>> {
  if (!id.safeParse(notificationId).success) return { ok: false, message: "Unknown message." };
  const parsed = reason.safeParse(why);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Give a reason." };
  const result = await actionResult(() =>
    api<PatientNotification>(`/communications/${notificationId}/${kind}`, { method: "POST", body: { reason: parsed.data } }),
  );
  revalidatePath("/communications");
  if (patientId) revalidatePath(`/patients/${patientId}/communications`);
  return result;
}

/** Cancels a message not yet sent (`notification.manage`; the API refuses anything already sending or sent). */
export async function cancelMessage(notificationId: string, why: string, patientId: string | null = null) {
  return act("cancel", notificationId, why, patientId);
}

/** Sends a message that was not sent again, as a new message with consent and preferences re-checked. */
export async function resendMessage(notificationId: string, why: string, patientId: string | null = null) {
  return act("resend", notificationId, why, patientId);
}
