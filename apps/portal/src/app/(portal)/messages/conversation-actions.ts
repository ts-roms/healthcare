"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalApi } from "@/lib/api/client";
import { type Result, run, UUID } from "@/lib/api/result";
import type { MessageTopic, PortalThreadDetail } from "@/lib/api/types";
import { attachmentProblem, BODY_MAX, SUBJECT_MAX, TOPICS } from "@/lib/conversations";

interface PreparedUpload {
  document: { id: string };
  upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };
}

/**
 * Sends the patient's files to the clinic's storage through the API's two-step flow (prepare, PUT from this server,
 * confirm), so the browser never talks to storage. Returns the document ids to attach, or the first refusal.
 */
async function uploadFiles(form: FormData | undefined): Promise<Result<string[]>> {
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File && f.size > 0);
  const problem = attachmentProblem(files);
  if (problem) return { ok: false, message: problem };
  const ids: string[] = [];
  for (const file of files) {
    const prepared = await run(() =>
      portalApi<PreparedUpload>("/portal/message-threads/uploads", {
        method: "POST",
        body: { title: file.name.slice(0, 200), fileName: file.name.slice(0, 200), contentType: file.type, sizeBytes: file.size },
      }),
    );
    if (!prepared.ok) return prepared;
    const stored = await fetch(prepared.data.upload.url, {
      method: prepared.data.upload.method,
      headers: prepared.data.upload.headers,
      body: await file.arrayBuffer(),
      cache: "no-store",
    }).catch(() => undefined);
    if (!stored?.ok) return { ok: false, message: "A file could not be uploaded. Check your connection and try again.", code: "storage_upload_failed" };
    const completed = await run(() => portalApi<unknown>(`/portal/message-threads/uploads/${prepared.data.document.id}/complete`, { method: "POST" }));
    if (!completed.ok) return completed;
    ids.push(prepared.data.document.id);
  }
  return { ok: true, data: ids };
}

/** Starts a conversation with the clinic, then opens it. The API limits open conversations and writing speed. */
export async function startConversation(input: { topic: string; subject: string; body: string }, form?: FormData): Promise<Result<never>> {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!TOPICS.some((t) => t.value === input.topic)) return { ok: false, message: "Choose what your message is about." };
  if (!subject || subject.length > SUBJECT_MAX) return { ok: false, message: `Give your message a subject of up to ${SUBJECT_MAX} characters.` };
  if (!body || body.length > BODY_MAX) return { ok: false, message: `Write a message of up to ${BODY_MAX.toLocaleString("en")} characters.` };
  const uploaded = await uploadFiles(form);
  if (!uploaded.ok) return uploaded;
  const result = await run(() =>
    portalApi<PortalThreadDetail>("/portal/message-threads", {
      method: "POST",
      body: { topic: input.topic as MessageTopic, subject, body, documentIds: uploaded.data },
    }),
  );
  if (!result.ok) return result;
  revalidatePath("/messages");
  redirect(`/messages/${result.data.id}`);
}

/** Writes in an open conversation. */
export async function replyInConversation(threadId: string, body: string, form?: FormData): Promise<Result<PortalThreadDetail>> {
  const text = body.trim();
  if (!UUID.test(threadId)) return { ok: false, message: "Unknown conversation." };
  if (!text || text.length > BODY_MAX) return { ok: false, message: `Write a message of up to ${BODY_MAX.toLocaleString("en")} characters.` };
  const uploaded = await uploadFiles(form);
  if (!uploaded.ok) return uploaded;
  const result = await run(() =>
    portalApi<PortalThreadDetail>(`/portal/message-threads/${threadId}/messages`, { method: "POST", body: { body: text, documentIds: uploaded.data } }),
  );
  if (result.ok) revalidatePath(`/messages/${threadId}`);
  return result;
}

/** A short-lived link to a file in one of the patient's conversations (the clinic records each opening). */
export async function openAttachment(threadId: string, documentId: string): Promise<Result<{ url: string }>> {
  if (!UUID.test(threadId) || !UUID.test(documentId)) return { ok: false, message: "Unknown file." };
  return run(() => portalApi<{ url: string; expiresAt: string }>(`/portal/message-threads/${threadId}/attachments/${documentId}/link`));
}
