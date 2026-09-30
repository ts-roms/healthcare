"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import { documentDownloadUrl } from "@/lib/api/documents";
import type { RecordCopy, RecordsRequest } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const id = z.uuid();
const version = z.number().int().positive();

async function post(requestId: string, path: string, body: object): Promise<ActionResult<RecordsRequest>> {
  const result = await actionResult(() => api<RecordsRequest>(`/records-requests/${requestId}/${path}`, { method: "POST", body }));
  revalidatePath("/records/requests");
  return result;
}

export async function startReview(requestId: string, requestVersion: number) {
  if (!id.safeParse(requestId).success || !version.safeParse(requestVersion).success) return { ok: false as const, message: "Invalid request." };
  return post(requestId, "review", { version: requestVersion });
}

const fulfilSchema = z.object({
  requestId: id,
  documentIds: z.array(id).min(1, "Choose the documents to share.").max(50),
  note: z.string().trim().max(1000).optional(),
  identityCheckMethod: z.string().trim().min(3, "Say how the identity was confirmed.").max(200).optional(),
  version,
});
export async function fulfilRequest(input: z.input<typeof fulfilSchema>) {
  const parsed = fulfilSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { requestId, note, ...body } = parsed.data;
  return post(requestId, "fulfil", { ...body, note: note && note.length >= 3 ? note : undefined });
}

const declineSchema = z.object({ requestId: id, reason: z.string().trim().min(3, "Say why, in words the patient will read.").max(1000), version });
export async function declineRequest(input: z.input<typeof declineSchema>) {
  const parsed = declineSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { requestId, ...body } = parsed.data;
  return post(requestId, "decline", body);
}

const SECTIONS = ["allergies", "consultations", "laboratory", "prescriptions", "care_plans", "dental", "certificates", "documents"] as const;
const date = z.iso.date();
const copySchema = z.object({
  requestId: id,
  sections: z.array(z.enum(SECTIONS)).min(1, "Choose what the copy contains."),
  periodFrom: date.optional(),
  periodTo: date.optional(),
});
/** Compiles the chosen sections of the patient's record into one PDF, stored in the record for sharing. */
export async function prepareCopy(input: z.input<typeof copySchema>): Promise<ActionResult<RecordCopy>> {
  const parsed = copySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { requestId, ...body } = parsed.data;
  const result = await actionResult(() => api<RecordCopy>(`/records-requests/${requestId}/copies`, { method: "POST", body }));
  revalidatePath(`/records/requests/${requestId}`);
  return result;
}

/** A short-lived link to check a document before sharing it (the API checks access and audits each link). */
export async function documentLink(documentId: string): Promise<ActionResult<{ url: string }>> {
  if (!id.safeParse(documentId).success) return { ok: false, message: "Unknown document." };
  return actionResult(async () => ({ url: (await documentDownloadUrl(documentId)).url }));
}
