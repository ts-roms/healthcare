"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { AssistantReplay } from "@/lib/api/types";

// The API validates the parameters against the rule's own schema, authorizes (assistant.configure) and audits the change.
const schema = z.object({
  ruleId: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,80}$/),
  facilityId: z.uuid().nullable(),
  enabled: z.boolean(),
  parameters: z.record(z.string(), z.number().int()),
  expectedVersion: z.number().int().min(0),
});

export async function saveAssistantRule(input: z.input<typeof schema>): Promise<ActionResult<{ version: number }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the settings." };
  const { ruleId, ...body } = parsed.data;
  const result = await actionResult(() => api<{ version: number }>(`/assistant/rules/${encodeURIComponent(ruleId)}/settings`, { method: "PUT", body }));
  revalidateAssistantScreens();
  return result;
}

/** The settings and insights pages, and the screens whose suggestions a rule may feed. */
function revalidateAssistantScreens() {
  revalidatePath("/admin/assistant", "layout");
  for (const path of ["/inventory", "/billing", "/appointments", "/queue", "/laboratory/worklist", "/laboratory/qc", "/admin/audit", "/admin", "/outreach"])
    revalidatePath(path);
  revalidatePath("/clinic/encounters", "layout");
  revalidatePath("/dental/patients", "layout");
  revalidatePath("/pharmacy", "layout");
}

const reviewSchema = z.object({
  ruleId: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,80}$/),
  outcome: z.enum(["keep", "adjust", "retire"]),
  note: z.string().trim().min(3, "Say what you decided and why (at least 3 characters).").max(1000),
  falsePositives: z.string().trim().max(1000),
  reviewedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the review date."),
});

/**
 * Records the organization's review of a rule (the API authorizes with assistant.configure, audits it and, for "retire",
 * turns the rule off wherever it is on in the organization).
 */
export async function recordRuleReview(input: z.input<typeof reviewSchema>): Promise<ActionResult<{ id: string; turnedOff: number }>> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the review." };
  const { ruleId, falsePositives, ...body } = parsed.data;
  const result = await actionResult(() =>
    api<{ id: string; turnedOff: number }>(`/assistant/rules/${encodeURIComponent(ruleId)}/reviews`, {
      method: "POST",
      body: { ...body, ...(falsePositives.length >= 3 ? { falsePositives } : {}) },
    }),
  );
  if (result.ok) revalidateAssistantScreens();
  return result;
}

const replaySchema = z.object({
  ruleId: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,80}$/),
  facilityId: z.uuid(),
  parameters: z.record(z.string(), z.number().int()),
  days: z.number().int().min(1).max(31),
});

/** How often the rule would have spoken on each past day at a facility with these values (counts only; the API audits it). */
export async function replayAssistantRule(input: z.input<typeof replaySchema>): Promise<ActionResult<AssistantReplay>> {
  const parsed = replaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the settings." };
  const { ruleId, ...body } = parsed.data;
  return actionResult(() => api<AssistantReplay>(`/assistant/rules/${encodeURIComponent(ruleId)}/replay`, { method: "POST", body }));
}
