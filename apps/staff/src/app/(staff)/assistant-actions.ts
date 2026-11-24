"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { AssistantSurface } from "@/lib/api/types";

/** The screen each surface's suggestions are shown on, refreshed after an answer. */
const SURFACE_PATH: Record<AssistantSurface, { path: string; type?: "layout" }> = {
  inventory: { path: "/inventory" },
  billing: { path: "/billing" },
  appointments: { path: "/appointments" },
  queue: { path: "/queue" },
  encounter: { path: "/clinic/encounters", type: "layout" },
  laboratory: { path: "/laboratory/worklist" },
  "laboratory-quality": { path: "/laboratory/qc" },
  security: { path: "/admin/audit" },
  settings: { path: "/admin" },
  outreach: { path: "/outreach" },
  // Checked in the prescribing dialog: the consultation refreshes.
  prescribing: { path: "/clinic/encounters", type: "layout" },
  // A patient's dental record.
  dental: { path: "/dental/patients", type: "layout" },
  // The pharmacy's home and a prescription being dispensed.
  pharmacy: { path: "/pharmacy", type: "layout" },
};

const answerSchema = z.object({
  surface: z.enum([
    "inventory",
    "billing",
    "appointments",
    "queue",
    "encounter",
    "laboratory",
    "laboratory-quality",
    "security",
    "settings",
    "outreach",
    "prescribing",
    "dental",
    "pharmacy",
  ]),
  id: z.string().min(3).max(300),
  outcome: z.enum(["accepted", "dismissed", "not_useful"]),
  /** The person's own words for "Not useful" (read by administrators when reviewing the rule). */
  reason: z.string().trim().min(1).max(500).optional(),
});

/** Records what the person did with an assistant suggestion. The API checks the permission, facility and rule. */
export async function answerSuggestion(input: z.input<typeof answerSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { surface, id, outcome, reason } = parsed.data;
  const result = await actionResult(() =>
    api<{ id: string }>(`/assistant/suggestions/${encodeURIComponent(id)}/feedback`, { method: "POST", body: { outcome, ...(reason ? { reason } : {}) } }),
  );
  if (result.ok) {
    revalidatePath(SURFACE_PATH[surface].path, SURFACE_PATH[surface].type);
    // The Assistant section shows the same suggestions, and hides an answered one too.
    revalidatePath("/assistant/suggestions", "layout");
  }
  return result;
}
