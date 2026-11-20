"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { AssistantSurface } from "@/lib/api/types";

/** The screen each surface's suggestions are shown on, refreshed after an answer. */
const SURFACE_PATH: Record<AssistantSurface, string> = { inventory: "/inventory" };

const answerSchema = z.object({
  surface: z.enum(["inventory"]),
  id: z.string().min(3).max(300),
  outcome: z.enum(["accepted", "dismissed", "not_useful"]),
});

/** Records what the person did with an assistant suggestion. The API checks the permission, facility and rule. */
export async function answerSuggestion(input: z.input<typeof answerSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { surface, id, outcome } = parsed.data;
  const result = await actionResult(() =>
    api<{ id: string }>(`/assistant/suggestions/${encodeURIComponent(id)}/feedback`, { method: "POST", body: { outcome } }),
  );
  if (result.ok) revalidatePath(SURFACE_PATH[surface]);
  return result;
}
