"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";

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
  // The screens whose suggestions this rule feeds.
  revalidatePath("/inventory");
  return result;
}
