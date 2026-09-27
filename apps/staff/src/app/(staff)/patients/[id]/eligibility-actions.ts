"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { EligibilityCheck } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date of service.");

const recordSchema = z.object({
  patientId: z.uuid(),
  serviceDate: date,
  answer: z.enum(["eligible", "not_eligible", "undetermined"]),
  reference: z.string().trim().min(1, "Enter the reference PhilHealth's channel gave.").max(80),
  note: z.string().trim().max(500).optional(),
});

/** Records the answer PhilHealth's own channel gave. */
export async function recordEligibility(input: z.input<typeof recordSchema>) {
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const result = await actionResult(() => api<EligibilityCheck>("/philhealth/eligibility/records", { method: "POST", body: parsed.data }));
  if (result.ok) revalidatePath(`/patients/${input.patientId}`);
  return result;
}

const checkSchema = z.object({ patientId: z.uuid(), serviceDate: date, idempotencyKey: z.string().min(8).max(100) });

/** Asks through the adapter; refused by the API while the eligibility integration is a dependency. */
export async function requestEligibility(input: z.input<typeof checkSchema>) {
  const parsed = checkSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const result = await actionResult(() => api<EligibilityCheck>("/philhealth/eligibility/checks", { method: "POST", body: parsed.data }));
  if (result.ok) revalidatePath(`/patients/${input.patientId}`);
  return result;
}
