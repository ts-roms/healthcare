"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { YakapParticipation } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.");
const participationSchema = z.object({
  facilityId: z.uuid(),
  participationReference: z.string().trim().min(1, "Enter the YAKAP reference PhilHealth issued.").max(60),
  validFrom: isoDate.optional(),
  validUntil: isoDate.optional(),
  version: z.number().int().positive().optional(),
});

/** Records the facility's YAKAP participation reference as issued by PhilHealth (not verified). */
export async function recordYakapParticipation(input: z.input<typeof participationSchema>) {
  const parsed = participationSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { facilityId, ...body } = parsed.data;
  const result = await actionResult(() => api<YakapParticipation>(`/philhealth/facilities/${facilityId}/yakap-participation`, { method: "PUT", body }));
  if (result.ok) revalidatePath("/billing/settings");
  return result;
}
