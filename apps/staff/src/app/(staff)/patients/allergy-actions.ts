"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { AllergyRecord } from "@/lib/api/types";
import { allergyFormSchema, type AllergyForm } from "@/lib/allergy-form";

/** Records an allergy (allergy.manage). A duplicate of an active allergy is refused by the API (409 allergy_exists). */
export async function addAllergy(patientId: string, form: AllergyForm): Promise<ActionResult<AllergyRecord>> {
  const id = z.uuid().safeParse(patientId);
  const parsed = allergyFormSchema.safeParse(form);
  if (!id.success) return { ok: false, message: "Invalid request." };
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the allergy details." };
  return actionResult(() => api<AllergyRecord>(`/patients/${id.data}/allergies`, { method: "POST", body: parsed.data }));
}

const statusSchema = z.object({
  patientId: z.uuid(),
  allergyId: z.uuid(),
  status: z.enum(["resolved", "inactive", "entered_in_error"]),
  reason: z.string().trim().min(3, "Give a reason").max(500),
  version: z.number().int().positive(),
});
/** Allergies are not deleted: they are resolved, made inactive or marked entered in error, with a reason. */
export async function changeAllergyStatus(input: z.input<typeof statusSchema>): Promise<ActionResult<AllergyRecord>> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { patientId, allergyId, ...body } = parsed.data;
  return actionResult(() => api<AllergyRecord>(`/patients/${patientId}/allergies/${allergyId}`, { method: "PATCH", body }));
}

const reviewSchema = z.object({ patientId: z.uuid(), noKnownAllergies: z.boolean() });
/** Records that allergies were reviewed with the patient; `noKnownAllergies` asserts there are none. */
export async function reviewAllergies(input: z.input<typeof reviewSchema>): Promise<ActionResult<unknown>> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { patientId, noKnownAllergies } = parsed.data;
  return actionResult(() => api(`/patients/${patientId}/allergy-reviews`, { method: "POST", body: { noKnownAllergies } }));
}
