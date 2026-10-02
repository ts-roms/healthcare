"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import { uploadPatientDocument } from "@/lib/api/documents";
import type { PatientMessageSetting, PatientThreadDetail } from "@/lib/api/types";
import { attachmentProblem, MESSAGE_ATTACHMENTS_MAX } from "@/lib/messaging-mapping";

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

/**
 * Replies, carrying up to three files of the patient's record: files chosen here are first stored as
 * `clinical_attachment` documents of the patient (the two-step upload, from this server), then sent with the message.
 * The API checks each document belongs to the patient and is available.
 */
export async function replyToPatient(threadId: string, text: string, form?: FormData): Promise<ActionResult<PatientThreadDetail>> {
  const parsed = body.safeParse(text);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Write a message." };
  if (!id.safeParse(threadId).success) return { ok: false, message: "Unknown conversation." };
  const patientId = form?.get("patientId");
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File && f.size > 0);
  const documentIds = (form?.getAll("documentIds") ?? []).filter((d): d is string => typeof d === "string" && id.safeParse(d).success);
  if (files.length + documentIds.length > MESSAGE_ATTACHMENTS_MAX) return { ok: false, message: `At most ${MESSAGE_ATTACHMENTS_MAX} files with one message.` };
  const problem = attachmentProblem(files);
  if (problem) return { ok: false, message: problem };
  if (files.length && (typeof patientId !== "string" || !id.safeParse(patientId).success)) return { ok: false, message: "Unknown patient." };
  const uploaded: string[] = [];
  for (const file of files) {
    const stored = await actionResult(() =>
      uploadPatientDocument({ patientId: patientId as string, category: "clinical_attachment", title: file.name, file, idempotencyKey: crypto.randomUUID() }),
    );
    if (!stored.ok) return stored;
    uploaded.push(stored.data);
  }
  return post(threadId, "messages", { body: parsed.data, documentIds: [...documentIds, ...uploaded] });
}

/** A staff-only note on the conversation; the patient never sees it. */
export async function addThreadNote(threadId: string, text: string) {
  const parsed = body.safeParse(text);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Write a note." };
  return post(threadId, "notes", { body: parsed.data });
}

/** A short-lived link to an attachment of the conversation (the API audits each one). */
export async function attachmentLink(threadId: string, documentId: string): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  if (!id.safeParse(threadId).success || !id.safeParse(documentId).success) return { ok: false, message: "Unknown file." };
  return actionResult(() => api<{ url: string; expiresAt: string }>(`/patient-messages/${threadId}/attachments/${documentId}/link`));
}

const settingSchema = z.object({
  facilityId: id,
  topic: z.enum(["general", "appointment", "results", "medication", "billing", "other"]),
  routeRoleKey: z.string().trim().max(60).optional(),
  routeUserId: z.string().trim().optional(),
  autoAssign: z.boolean(),
  responseTargetHours: z.number().int().min(1).max(168).nullable(),
  version: z.number().int().positive().optional(),
});

/** Where a topic's conversations go at a facility and how soon the clinic means to answer (`clinic.configure`). */
export async function saveMessageSetting(input: z.input<typeof settingSchema>): Promise<ActionResult<PatientMessageSetting>> {
  const parsed = settingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the setting." };
  const { routeRoleKey, routeUserId, ...rest } = parsed.data;
  const result = await actionResult(() =>
    api<PatientMessageSetting>("/patient-messages/settings", {
      method: "PUT",
      body: { ...rest, routeRoleKey: routeRoleKey || null, routeUserId: routeUserId && id.safeParse(routeUserId).success ? routeUserId : null },
    }),
  );
  revalidatePath("/messages/settings");
  return result;
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
