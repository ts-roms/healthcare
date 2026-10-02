"use server";

import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { Visit } from "@/lib/api/types";
import { type TriageInput, triageInputSchema } from "@/lib/triage-form";

/**
 * Records triage for a visit: chief complaint, priority, pain score, risk
 * flags and optional vital signs, in one API transaction that also moves the
 * patient to "ready for provider" (or keeps them in triage). The idempotency key, when given, makes a replay of the
 * same triage (the offline outbox) safe.
 */
export async function recordTriage(input: TriageInput, idempotencyKey?: string): Promise<ActionResult<{ visit: Visit }>> {
  const parsed = triageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { visitId, notes, vitals, ...body } = parsed.data;
  return actionResult(() =>
    api<{ visit: Visit }>(`/queue/visits/${visitId}/triage`, {
      method: "POST",
      body: { ...body, notes: notes || undefined, vitals: vitals && Object.keys(vitals).length > 0 ? vitals : undefined },
      idempotencyKey,
    }),
  );
}
