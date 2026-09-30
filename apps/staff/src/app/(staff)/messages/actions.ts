"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { PatientThreadDetail } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.
const id = z.uuid();
const body = z.string().trim().min(1, "Write a message.").max(2000, "At most 2,000 characters.");

async function post(threadId: string, path: string, payload: object = {}): Promise<ActionResult<PatientThreadDetail>> {
  if (!id.safeParse(threadId).success) return { ok: false, message: "Unknown conversation." };
  const result = await actionResult(() => api<PatientThreadDetail>(`/patient-messages/${threadId}/${path}`, { method: "POST", body: payload }));
  revalidatePath("/messages");
  revalidatePath(`/messages/${threadId}`);
  return result;
}

export async function replyToPatient(threadId: string, text: string) {
  const parsed = body.safeParse(text);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Write a message." };
  return post(threadId, "messages", { body: parsed.data });
}

export async function assignThread(threadId: string, assignToMe: boolean) {
  return post(threadId, "assignment", { assignToMe });
}

export async function setThreadOpen(threadId: string, open: boolean) {
  return post(threadId, open ? "reopen" : "close");
}

const startSchema = z.object({
  patientId: id,
  topic: z.enum(["general", "appointment", "results", "medication", "billing", "other"]),
  subject: z.string().trim().min(1, "Give the message a subject.").max(100, "At most 100 characters."),
  body,
});

/** Starts a conversation with a patient who uses MyHealth (so the patient can answer). */
export async function startConversation(input: z.input<typeof startSchema>): Promise<ActionResult<PatientThreadDetail>> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the message." };
  const result = await actionResult(() => api<PatientThreadDetail>("/patient-messages", { method: "POST", body: parsed.data }));
  revalidatePath("/messages");
  revalidatePath(`/patients/${parsed.data.patientId}`);
  return result;
}
