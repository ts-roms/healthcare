"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { OutsideResultSubmission } from "@/lib/api/types";
import { todayInManila } from "@/lib/consent-form";
import { type OutsideResultForm, outsideResultFormSchema, outsideResultPayload } from "@/lib/outside-result-form";

const uuid = z.uuid();

function refresh(patientId: string) {
  revalidatePath("/records/outside-results");
  revalidatePath(`/patients/${patientId}`);
  revalidatePath(`/patients/${patientId}/outside-results`);
  revalidatePath("/clinic/outside-results");
}

/** A short-lived link to the report the patient sent (the API audits each link). */
export async function submissionReportLink(submissionId: string): Promise<ActionResult<{ url: string }>> {
  if (!uuid.safeParse(submissionId).success) return { ok: false, message: "Unknown submission." };
  return actionResult(() => api<{ url: string }>(`/outside-result-submissions/${submissionId}/link`));
}

const fileSchema = z.object({ patientId: z.uuid(), submissionId: z.uuid() });
/**
 * Files the patient's report on their record as an outside result, with the records office's own reading of it
 * (outside-result.submission.manage). A clinician then reviews it; the patient is told it was answered.
 */
export async function fileSubmission(input: z.input<typeof fileSchema> & { form: OutsideResultForm }): Promise<ActionResult<OutsideResultSubmission>> {
  const ids = fileSchema.safeParse(input);
  if (!ids.success) return { ok: false, message: "Invalid request." };
  const form = outsideResultFormSchema(todayInManila()).safeParse(input.form);
  if (!form.success) return { ok: false, message: form.error.issues[0]?.message ?? "Check the details." };
  const { documentId: _documentId, receivedFrom: _receivedFrom, ...body } = outsideResultPayload(form.data, "");
  const result = await actionResult(() => api<OutsideResultSubmission>(`/outside-result-submissions/${ids.data.submissionId}/file`, { method: "POST", body }));
  if (result.ok) refresh(ids.data.patientId);
  return result;
}

const declineSchema = z.object({
  patientId: z.uuid(),
  submissionId: z.uuid(),
  reason: z.string().trim().min(5, "Give a reason the patient can read (at least 5 characters).").max(500),
});
/** Declines the submission with a reason the patient reads in MyHealth; nothing is filed. */
export async function declineSubmission(input: z.input<typeof declineSchema>): Promise<ActionResult<OutsideResultSubmission>> {
  const parsed = declineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { patientId, submissionId, reason } = parsed.data;
  const result = await actionResult(() =>
    api<OutsideResultSubmission>(`/outside-result-submissions/${submissionId}/decline`, { method: "POST", body: { reason } }),
  );
  if (result.ok) refresh(patientId);
  return result;
}
