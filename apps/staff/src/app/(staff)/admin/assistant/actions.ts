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
  revalidatePath("/admin/assistant");
  // The screens whose suggestions a rule may feed.
  for (const path of ["/inventory", "/billing", "/appointments", "/queue", "/laboratory/worklist", "/admin/audit", "/admin", "/outreach"]) revalidatePath(path);
  revalidatePath("/clinic/encounters", "layout");
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
