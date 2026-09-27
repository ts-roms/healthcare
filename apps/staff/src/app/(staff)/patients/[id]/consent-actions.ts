"use server";

import { revalidatePath } from "next/cache";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import { documentDownloadUrl, uploadPatientDocument } from "@/lib/api/documents";
import type { PatientConsent } from "@/lib/api/types";
import { checkConsentFile, type ConsentForm, consentDocumentTitle, parseConsentForm } from "@/lib/consent-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FieldErrors = Partial<Record<keyof ConsentForm | "file", string>>;

export type RecordConsentResult =
  | { ok: true; data: null }
  | {
      ok: false;
      message: string;
      fieldErrors?: FieldErrors;
      /** The signed form was stored but the consent was not recorded: send this id on retry instead of uploading again. */
      documentId?: string;
    };

/**
 * Records a consent decision, optionally with the signed form. The form is
 * uploaded first (as a consent_form document for this patient) and linked by
 * id; the API checks that it is this patient's uploaded consent form, and
 * checks permissions and audits both steps.
 */
export async function recordConsent(patientId: string, data: FormData): Promise<RecordConsentResult> {
  if (!UUID.test(patientId)) return { ok: false, message: "Unknown patient." };
  const form: ConsentForm = {
    consentType: String(data.get("consentType") ?? ""),
    decision: String(data.get("decision") ?? ""),
    capturedVia: String(data.get("capturedVia") ?? ""),
    expiresOn: String(data.get("expiresOn") ?? ""),
    notes: String(data.get("notes") ?? ""),
  };
  const parsed = parseConsentForm(form);
  const file = data.get("file");
  const hasFile = file instanceof File && file.size > 0;
  const fileError = hasFile ? checkConsentFile(file) : null;
  if (!parsed.ok || fileError) {
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: { ...(parsed.ok ? {} : parsed.errors), ...(fileError ? { file: fileError } : {}) },
    };
  }

  let documentId = String(data.get("documentId") ?? "") || undefined;
  if (documentId && !UUID.test(documentId)) documentId = undefined;
  if (hasFile && !documentId) {
    const uploaded = await actionResult(() =>
      uploadPatientDocument({
        patientId,
        category: "consent_form",
        title: consentDocumentTitle(parsed.payload.consentType),
        file,
        idempotencyKey: String(data.get("idempotencyKey") ?? crypto.randomUUID()),
      }),
    );
    if (!uploaded.ok)
      return { ok: false, message: `The signed form was not uploaded: ${uploaded.message}`, fieldErrors: { file: "Upload failed. Try again." } };
    documentId = uploaded.data;
  }

  const result = await actionResult(() => api(`/patients/${patientId}/consents`, { method: "POST", body: { ...parsed.payload, documentId } }));
  if (!result.ok) {
    return documentId
      ? { ok: false, message: `The signed form was saved, but the consent was not recorded: ${result.message}`, documentId }
      : { ok: false, message: result.message };
  }
  revalidatePath(`/patients/${patientId}`);
  return { ok: true, data: null };
}

/** Full consent history, newest first. Loaded on request only: every read is audited by the API. */
export async function loadConsentHistory(patientId: string): Promise<ActionResult<PatientConsent[]>> {
  if (!UUID.test(patientId)) return { ok: false, message: "Unknown patient." };
  return actionResult(() => api<PatientConsent[]>(`/patients/${patientId}/consents`));
}

/** A short-lived link to a signed consent form (each link is audited). */
export async function consentDocumentLink(documentId: string): Promise<ActionResult<{ url: string }>> {
  if (!UUID.test(documentId)) return { ok: false, message: "Unknown document." };
  return actionResult(async () => ({ url: (await documentDownloadUrl(documentId)).url }));
}
