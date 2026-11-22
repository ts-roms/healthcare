"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { AskHistory, AskInterpretation } from "@/lib/api/types";
import { hrefForInterpretation } from "@/lib/assistant-ask";

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
