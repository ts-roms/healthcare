"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { ExternalHistoryEntry } from "@/lib/api/types";

const schema = z.object({
  patientId: z.uuid(),
  entryId: z.uuid(),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500),
});

/** Marks an accepted external history entry entered in error (the API checks interop.fhir.import.review and audits it). */
export async function markExternalHistoryInError(input: z.input<typeof schema>) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { patientId, entryId, reason } = parsed.data;
  const result = await actionResult(() =>
    api<ExternalHistoryEntry>(`/patients/${patientId}/external-history/${entryId}/entered-in-error`, { method: "POST", body: { reason } }),
  );
  if (result.ok) revalidatePath(`/patients/${patientId}`);
  return result;
}
