"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { portalApi } from "@/lib/api/client";
import { type Result, run, UUID } from "@/lib/api/result";
import type { MessageTopic, PortalThreadDetail } from "@/lib/api/types";
import { BODY_MAX, SUBJECT_MAX, TOPICS } from "@/lib/conversations";

/** Starts a conversation with the clinic, then opens it. The API limits open conversations and writing speed. */
export async function startConversation(input: { topic: string; subject: string; body: string }): Promise<Result<never>> {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!TOPICS.some((t) => t.value === input.topic)) return { ok: false, message: "Choose what your message is about." };
  if (!subject || subject.length > SUBJECT_MAX) return { ok: false, message: `Give your message a subject of up to ${SUBJECT_MAX} characters.` };
  if (!body || body.length > BODY_MAX) return { ok: false, message: `Write a message of up to ${BODY_MAX.toLocaleString("en")} characters.` };
  const result = await run(() =>
    portalApi<PortalThreadDetail>("/portal/message-threads", { method: "POST", body: { topic: input.topic as MessageTopic, subject, body } }),
  );
  if (!result.ok) return result;
  revalidatePath("/messages");
  redirect(`/messages/${result.data.id}`);
}

/** Writes in an open conversation. */
export async function replyInConversation(threadId: string, body: string): Promise<Result<PortalThreadDetail>> {
  const text = body.trim();
  if (!UUID.test(threadId)) return { ok: false, message: "Unknown conversation." };
  if (!text || text.length > BODY_MAX) return { ok: false, message: `Write a message of up to ${BODY_MAX.toLocaleString("en")} characters.` };
  const result = await run(() => portalApi<PortalThreadDetail>(`/portal/message-threads/${threadId}/messages`, { method: "POST", body: { body: text } }));
  if (result.ok) revalidatePath(`/messages/${threadId}`);
  return result;
}
