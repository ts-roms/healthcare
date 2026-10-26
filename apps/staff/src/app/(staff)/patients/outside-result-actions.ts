"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import { uploadPatientDocument } from "@/lib/api/documents";
import type { OutsideResult } from "@/lib/api/types";
import { checkConsentFile, todayInManila } from "@/lib/consent-form";
import { outsideResultFormSchema, outsideResultPayload } from "@/lib/outside-result-form";

const uuid = z.uuid();

function refresh(patientId: string) {
  revalidatePath(`/patients/${patientId}`);
  revalidatePath(`/patients/${patientId}/outside-results`);
}

/**
 * Files a result from an outside laboratory or hospital (outside-result.record): the report is uploaded for the patient
 * (document.upload) and then filed with its source, day and tests. It is not one of this laboratory's results. If filing
 * is refused, the stored report stays a private document of the patient and the form can be sent again.
 */
export async function fileOutsideResult(patientId: string, data: FormData): Promise<ActionResult<OutsideResult>> {
  if (!uuid.safeParse(patientId).success) return { ok: false, message: "Invalid request." };
  const file = data.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Attach the report (a PDF or a photo)." };
  const problem = checkConsentFile(file);
  if (problem) return { ok: false, message: problem };
  const parsed = outsideResultFormSchema(todayInManila()).safeParse({
    sourceName: data.get("sourceName"),
    sourceKind: data.get("sourceKind"),
    performedOn: data.get("performedOn"),
    tests: data.get("tests"),
    receivedFrom: data.get("receivedFrom"),
    notes: data.get("notes") ?? "",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  const stored = await actionResult(() =>
    uploadPatientDocument({
      patientId,
      category: "outside_result",
      title: `Outside result: ${parsed.data.sourceName}`.slice(0, 200),
      file,
      idempotencyKey: String(data.get("idempotencyKey") ?? crypto.randomUUID()),
    }),
  );
  if (!stored.ok) return stored;
  const result = await actionResult(() =>
    api<OutsideResult>(`/patients/${patientId}/outside-results`, { method: "POST", body: outsideResultPayload(parsed.data, stored.data) }),
  );
  if (result.ok) refresh(patientId);
  return result;
}

const correctionSchema = z.object({
  patientId: z.uuid(),
  outsideResultId: z.uuid(),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500),
});
/** Marks a filing entered in error with a reason; the report and the history stay. */
export async function markOutsideResultInError(input: z.input<typeof correctionSchema>): Promise<ActionResult<OutsideResult>> {
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { patientId, outsideResultId, reason } = parsed.data;
  const result = await actionResult(() => api<OutsideResult>(`/outside-results/${outsideResultId}/entered-in-error`, { method: "POST", body: { reason } }));
  if (result.ok) refresh(patientId);
  return result;
}

/** A short-lived link to the filed report (the API audits each link). */
export async function outsideResultLink(outsideResultId: string): Promise<ActionResult<{ url: string }>> {
  if (!uuid.safeParse(outsideResultId).success) return { ok: false, message: "Unknown report." };
  return actionResult(async () => ({ url: (await api<{ url: string }>(`/outside-results/${outsideResultId}/download-url`)).url }));
}
