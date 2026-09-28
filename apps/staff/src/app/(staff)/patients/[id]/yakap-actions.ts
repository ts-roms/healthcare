"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { ClaimExchange, YakapRegistration } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const recordSchema = z
  .object({
    patientId: z.uuid(),
    status: z.enum(["registered", "not_registered", "pending", "unknown"]),
    effectiveDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date.")
      .optional(),
    reference: z.string().trim().min(1).max(80).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status === "unknown" || !!v.reference, { message: "Enter the reference PhilHealth's channel gave." });

/** Records what PhilHealth's own channel answered about the patient's YAKAP registration. */
export async function recordYakapRegistration(input: z.input<typeof recordSchema>) {
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const result = await actionResult(() => api<YakapRegistration>("/philhealth/yakap/registrations", { method: "POST", body: parsed.data }));
  if (result.ok) revalidatePath(`/patients/${input.patientId}`);
  return result;
}

const submitSchema = z.object({ patientId: z.uuid(), encounterId: z.uuid(), idempotencyKey: z.string().min(8).max(100) });

/** Queues the encounter package for the YAKAP adapter; refused by the API while YAKAP is an integration dependency. */
export async function requestYakapSubmission(input: z.input<typeof submitSchema>) {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { patientId, encounterId, idempotencyKey } = parsed.data;
  const result = await actionResult(() =>
    api<ClaimExchange>(`/philhealth/yakap/encounters/${encounterId}/submissions`, { method: "POST", body: { idempotencyKey } }),
  );
  if (result.ok) revalidatePath(`/patients/${patientId}/yakap/${encounterId}`);
  return result;
}
