"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { AskAnswerView } from "@healthcare/ui/healthcare";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { AskAnswer, AskCompare, AskHistory, AskInterpretation, AskQuestion } from "@/lib/api/types";
import { askAnswerView, type AskParams, type AskReading, hrefForInterpretation } from "@/lib/assistant-ask";

/** What the question box shows when a question could not be answered from its words (they stay in the box). */
export type AskFormState = { unrecognised?: boolean; message?: string };

const askSchema = z.object({
  text: z.string().trim().min(1).max(200),
  allFacilities: z.boolean(),
});

/**
 * Reads a typed question and opens its answer. The words go to the API in the request body, where they are matched
 * against the catalogue and dropped; the answer's address names the question and its period only.
 */
export async function askQuestion(_previous: AskFormState, formData: FormData): Promise<AskFormState> {
  const parsed = askSchema.safeParse({ text: formData.get("text") ?? "", allFacilities: formData.get("allFacilities") === "1" });
  if (!parsed.success) return { message: "Type a question of up to 200 characters." };
  const result = await actionResult(() => api<AskInterpretation>("/assistant/ask/interpret", { method: "POST", body: parsed.data }));
  if (!result.ok) return { message: result.message };
  const href = hrefForInterpretation(result.data);
  if (!href) return { unrecognised: true };
  redirect(href);
}

// ---- The Ask chat (components/ask-chat.tsx: the button at the bottom-right of every page) ----------------------------

/** One example offered in an empty chat: a question the person may ask, as its first example reads. */
export type AskChatExample = { questionId: string; title: string; text: string; period?: string; compare?: AskCompare };

/** What the chat shows in reply: an answer, a choice between questions, or why there is none. */
export type AskChatReply =
  | { kind: "answer"; answer: AskAnswerView }
  | { kind: "choose"; candidates: Array<{ id: string; title: string }>; reading: AskReading }
  | { kind: "unrecognised" }
  | { kind: "error"; message: string };

/** The examples an empty chat offers: one per question whose figures the person may open. */
export async function loadAskExamples(): Promise<ActionResult<AskChatExample[]>> {
  return actionResult(async () => {
    const questions = await api<AskQuestion[]>("/assistant/ask/questions");
    return questions.flatMap((q) => {
      const example = q.allowed ? q.examples[0] : undefined;
      return example ? [{ questionId: q.id, title: q.title, text: example.text, period: example.period, compare: example.compare }] : [];
    });
  });
}

/**
 * Reads a question typed in the chat and answers it. As on the Ask page, the words go only to the reading
 * (`/assistant/ask/interpret`, which keeps nothing); the answer is asked by question id and period, never by the words.
 */
export async function askInChat(text: string): Promise<AskChatReply> {
  const parsed = askSchema.shape.text.safeParse(text);
  if (!parsed.success) return { kind: "error", message: "Type a question of up to 200 characters." };
  const read = await actionResult(() =>
    api<AskInterpretation>("/assistant/ask/interpret", { method: "POST", body: { text: parsed.data, allFacilities: false } }),
  );
  if (!read.ok) return { kind: "error", message: read.message };
  const r = read.data;
  if (r.kind === "unrecognised") return { kind: "unrecognised" };
  if (r.kind === "ambiguous") {
    return { kind: "choose", candidates: r.candidates.slice(0, 5), reading: { period: r.period, compare: r.compare, scope: r.scope } };
  }
  return answerFor({ questionId: r.questionId, period: r.period, compare: r.compare, scope: r.scope, notes: r.notes });
}

const answerSchema = z.object({
  questionId: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,80}$/),
  period: z
    .string()
    .regex(/^[a-z0-9.-]{1,40}$/)
    .optional(),
  compare: z.enum(["previous", "last-year"]).optional(),
  scope: z.enum(["facility", "organization"]).optional(),
  notes: z
    .array(z.enum(["period-not-applicable", "day-only", "not-comparable"]))
    .max(3)
    .optional(),
});

/** Answers an example or a question chosen in the chat (the API checks every value again). */
export async function answerInChat(params: AskParams): Promise<AskChatReply> {
  const parsed = answerSchema.safeParse(params);
  if (!parsed.success) return { kind: "error", message: "Ask does not answer that question." };
  return answerFor(parsed.data);
}

/** Asks one question of the catalogue: audited and kept among the person's questions by the API, like the Ask page. */
async function answerFor(params: AskParams): Promise<AskChatReply> {
  const result = await actionResult(() => api<AskAnswer>("/assistant/ask/answer", { method: "POST", body: params }));
  if (!result.ok) return { kind: "error", message: result.code === "not_found" ? "Ask does not answer that question." : result.message };
  return { kind: "answer", answer: askAnswerView(result.data) };
}

const changeSchema = z.object({ id: z.string().uuid(), change: z.enum(["save", "unsave", "remove"]) });

/**
 * Saves, unsaves or removes one of the person's own questions and answers their list as it is now. The page is not
 * refreshed: that would ask the question on screen again (and audit it again).
 */
export async function changeAskedQuestion(input: z.input<typeof changeSchema>): Promise<ActionResult<AskHistory>> {
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  return actionResult(async () => {
    await api(`/assistant/ask/history/${parsed.data.id}/${parsed.data.change}`, { method: "POST" });
    return api<AskHistory>("/assistant/ask/history");
  });
}

/** Forgets the person's recent questions (saved ones stay). */
export async function clearAskedQuestions(): Promise<ActionResult<AskHistory>> {
  return actionResult(async () => {
    await api("/assistant/ask/history/clear", { method: "POST" });
    return api<AskHistory>("/assistant/ask/history");
  });
}
