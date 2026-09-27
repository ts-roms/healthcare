"use server";

import { revalidatePath } from "next/cache";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { PatientConsent } from "@/lib/api/types";
import { type ConsentForm, parseConsentForm } from "@/lib/consent-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RecordConsentResult = ActionResult<null> | { ok: false; message: string; fieldErrors: Partial<Record<keyof ConsentForm, string>> };

/** Records a consent decision (append-only; the API checks permission and audits it). */
export async function recordConsent(patientId: string, form: ConsentForm): Promise<RecordConsentResult> {
  if (!UUID.test(patientId)) return { ok: false, message: "Unknown patient." };
  const parsed = parseConsentForm(form);
  if (!parsed.ok) return { ok: false, message: "Check the highlighted fields.", fieldErrors: parsed.errors };
  const result = await actionResult(() => api(`/patients/${patientId}/consents`, { method: "POST", body: parsed.payload }));
  if (!result.ok) return result;
  revalidatePath(`/patients/${patientId}`);
  return { ok: true, data: null };
}

/** Full consent history, newest first. Loaded on request only: every read is audited by the API. */
export async function loadConsentHistory(patientId: string): Promise<ActionResult<PatientConsent[]>> {
  if (!UUID.test(patientId)) return { ok: false, message: "Unknown patient." };
  return actionResult(() => api<PatientConsent[]>(`/patients/${patientId}/consents`));
}
