"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import {
  conditionFormSchema,
  conditionPayload,
  type ConditionForm,
  familyFormSchema,
  familyPayload,
  type FamilyForm,
  procedureFormSchema,
  procedurePayload,
  type ProcedureForm,
  reviewFormSchema,
  reviewPayload,
  type ReviewForm,
} from "@/lib/history-form";

const uuid = z.uuid();

function refresh(patientId: string, encounterId?: string | null) {
  revalidatePath(`/patients/${patientId}`);
  revalidatePath(`/patients/${patientId}/history`);
  revalidatePath(`/patients/${patientId}/360`);
  if (encounterId) revalidatePath(`/clinic/encounters/${encounterId}`);
}

function invalid(message = "Invalid request."): ActionResult<never> {
  return { ok: false, message };
}

/** Records a past procedure (history.record); the API validates and audits it. */
export async function recordPastProcedure(patientId: string, form: ProcedureForm): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(patientId).success) return invalid();
  const parsed = procedureFormSchema.safeParse(form);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Check the procedure.");
  const result = await actionResult(() =>
    api<{ id: string }>(`/patients/${patientId}/history/procedures`, { method: "POST", body: procedurePayload(parsed.data) }),
  );
  if (result.ok) refresh(patientId, parsed.data.encounterId);
  return result;
}

/** Records a condition diagnosed elsewhere, as reported (never a diagnosis of the organization). */
export async function recordPastCondition(patientId: string, form: ConditionForm): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(patientId).success) return invalid();
  const parsed = conditionFormSchema.safeParse(form);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Check the condition.");
  const result = await actionResult(() =>
    api<{ id: string }>(`/patients/${patientId}/history/conditions`, { method: "POST", body: conditionPayload(parsed.data) }),
  );
  if (result.ok) refresh(patientId, parsed.data.encounterId);
  return result;
}

/** Records a relative's condition. */
export async function recordFamilyHistory(patientId: string, form: FamilyForm): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(patientId).success) return invalid();
  const parsed = familyFormSchema.safeParse(form);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Check the family history.");
  const result = await actionResult(() => api<{ id: string }>(`/patients/${patientId}/history/family`, { method: "POST", body: familyPayload(parsed.data) }));
  if (result.ok) refresh(patientId, parsed.data.encounterId);
  return result;
}

/** Records that the family history was asked about (complete as listed, none known, or not known). */
export async function reviewFamilyHistory(patientId: string, form: ReviewForm): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(patientId).success) return invalid();
  const parsed = reviewFormSchema.safeParse(form);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Check the review.");
  const result = await actionResult(() =>
    api<{ id: string }>(`/patients/${patientId}/history/family/review`, { method: "POST", body: reviewPayload(parsed.data) }),
  );
  if (result.ok) refresh(patientId, parsed.data.encounterId);
  return result;
}

const socialSchema = z.looseObject({ basedOn: z.uuid().nullable(), encounterId: z.uuid().optional() });

/** Records a new version of the social history (the body is built by `socialPayload`; the API validates every field). */
export async function recordSocialHistory(patientId: string, body: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(patientId).success) return invalid();
  const parsed = socialSchema.safeParse(body);
  if (!parsed.success) return invalid();
  const result = await actionResult(() => api<{ id: string }>(`/patients/${patientId}/history/social`, { method: "POST", body: parsed.data }));
  if (result.ok) refresh(patientId, parsed.data.encounterId);
  return result;
}

const correctionSchema = z.object({
  patientId: z.uuid(),
  entryId: z.uuid(),
  encounterId: z.uuid().optional(),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500),
});
/** Marks a history entry (or a social history version) entered in error with a reason; nothing is deleted. */
export async function markHistoryInError(input: z.input<typeof correctionSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message);
  const { patientId, entryId, encounterId, reason } = parsed.data;
  const result = await actionResult(() => api<{ id: string }>(`/history/${entryId}/entered-in-error`, { method: "POST", body: { reason } }));
  if (result.ok) refresh(patientId, encounterId);
  return result;
}
