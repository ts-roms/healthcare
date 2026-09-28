"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { FhirImportDetail } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates, authorizes and audits every call.

const reason = z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500);
const matchSchema = z.object({ importId: z.uuid(), patientId: z.uuid(), version: z.number().int().positive() });
const registerSchema = z.object({
  importId: z.uuid(),
  version: z.number().int().positive(),
  duplicateOverride: z
    .object({ reviewedCandidateIds: z.array(z.uuid()).min(1), reason: z.string().trim().min(5, "Say why this is a different person.").max(500) })
    .optional(),
});
const entrySchema = z.object({ importId: z.uuid(), entryId: z.uuid() });
const rejectEntrySchema = entrySchema.extend({ reason });
const rejectImportSchema = z.object({ importId: z.uuid(), version: z.number().int().positive(), reason });

const invalid = (error: z.ZodError) => ({ ok: false as const, message: error.issues[0]?.message ?? "Invalid request." });

async function run(importId: string, call: () => Promise<FhirImportDetail>) {
  const result = await actionResult(call);
  if (result.ok) {
    revalidatePath(`/records/imports/${importId}`);
    revalidatePath("/records/imports");
  }
  return result;
}

export async function matchPatient(input: z.input<typeof matchSchema>) {
  const parsed = matchSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { importId, ...body } = parsed.data;
  return run(importId, () => api<FhirImportDetail>(`/fhir-imports/${importId}/match`, { method: "POST", body }));
}

export async function registerPatientFromImport(input: z.input<typeof registerSchema>) {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { importId, ...body } = parsed.data;
  return run(importId, () => api<FhirImportDetail>(`/fhir-imports/${importId}/register-patient`, { method: "POST", body }));
}

export async function acceptEntry(input: z.input<typeof entrySchema>) {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { importId, entryId } = parsed.data;
  return run(importId, () => api<FhirImportDetail>(`/fhir-imports/${importId}/entries/${entryId}/accept`, { method: "POST" }));
}

export async function rejectEntry(input: z.input<typeof rejectEntrySchema>) {
  const parsed = rejectEntrySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { importId, entryId, reason: why } = parsed.data;
  return run(importId, () => api<FhirImportDetail>(`/fhir-imports/${importId}/entries/${entryId}/reject`, { method: "POST", body: { reason: why } }));
}

export async function rejectImport(input: z.input<typeof rejectImportSchema>) {
  const parsed = rejectImportSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { importId, ...body } = parsed.data;
  return run(importId, () => api<FhirImportDetail>(`/fhir-imports/${importId}/reject`, { method: "POST", body }));
}
