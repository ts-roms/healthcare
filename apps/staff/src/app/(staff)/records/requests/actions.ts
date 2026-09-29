"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { RecordsRequest } from "@/lib/api/types";

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
