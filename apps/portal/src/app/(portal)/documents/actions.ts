"use server";

import { revalidatePath } from "next/cache";
import { portalApi } from "@/lib/api/client";
import { type Result, run, UUID } from "@/lib/api/result";
import type { PortalOutsideResult, PortalRecordsKind, PortalRecordsRequest, PortalRecordsScope } from "@/lib/api/types";
import { outsideResultFileProblem } from "@/lib/documents";

/** A short-lived link to the letter of one of the patient's referrals (not a cancelled one; the API audits it). */
export async function openReferralLetter(referralId: string): Promise<Result<{ url: string }>> {
  if (!UUID.test(referralId)) return { ok: false, message: "Unknown referral." };
  return run(() => portalApi<{ url: string; expiresAt: string }>(`/portal/referrals/${referralId}/link`));
}

/** A short-lived link to one of the patient's medical certificates (the API checks it is theirs and audits it). */
export async function openCertificate(certificateId: string): Promise<Result<{ url: string }>> {
  if (!UUID.test(certificateId)) return { ok: false, message: "Unknown certificate." };
  return run(() => portalApi<{ url: string; expiresAt: string }>(`/portal/certificates/${certificateId}/link`));
}

/** A short-lived link to a document the records office shared in answer to one of the patient's requests. */
export async function openSharedDocument(documentId: string): Promise<Result<{ url: string }>> {
  if (!UUID.test(documentId)) return { ok: false, message: "Unknown document." };
  return run(() => portalApi<{ url: string; expiresAt: string }>(`/portal/records-requests/documents/${documentId}/link`));
}

export async function submitRecordsRequest(input: {
  kind?: PortalRecordsKind;
  scope: PortalRecordsScope[];
  periodFrom?: string;
  periodTo?: string;
  details?: string;
  purpose?: string;
}): Promise<Result<PortalRecordsRequest>> {
  const result = await run(() => portalApi<PortalRecordsRequest>("/portal/records-requests", { method: "POST", body: input }));
  revalidatePath("/documents");
  return result;
}

export async function withdrawRecordsRequest(requestId: string): Promise<Result<PortalRecordsRequest>> {
  if (!UUID.test(requestId)) return { ok: false, message: "Unknown request." };
  const result = await run(() => portalApi<PortalRecordsRequest>(`/portal/records-requests/${requestId}/withdraw`, { method: "POST", body: {} }));
  revalidatePath("/documents");
  return result;
}

/** A short-lived link to the report the patient sent (the API checks it is theirs and audits it). */
export async function openSentResult(submissionId: string): Promise<Result<{ url: string }>> {
  if (!UUID.test(submissionId)) return { ok: false, message: "Unknown result." };
  return run(() => portalApi<{ url: string; expiresAt: string }>(`/portal/outside-results/${submissionId}/link`));
}

interface PreparedUpload {
  document: { id: string };
  upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };
}

/**
 * Sends a result from another laboratory or hospital to the records office: the file goes to the clinic's storage
 * through the API's two-step flow (prepare, PUT from this server, confirm) so the browser never talks to storage,
 * then it is sent with what the patient wrote. Nothing is added to their record until the records office files it.
 */
export async function sendOutsideResult(form: FormData): Promise<Result<PortalOutsideResult>> {
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, message: "Choose the report to send." };
  const problem = outsideResultFileProblem(file);
  if (problem) return { ok: false, message: problem };
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const sourceName = text("sourceName");
  const tests = text("tests");
  if (sourceName.length < 2) return { ok: false, message: "Say which laboratory or hospital it is from." };
  if (tests.length < 2) return { ok: false, message: "Say what the test was." };
  const prepared = await run(() =>
    portalApi<PreparedUpload>("/portal/outside-results/uploads", {
      method: "POST",
      body: { fileName: file.name.slice(0, 200), contentType: file.type, sizeBytes: file.size },
    }),
  );
  if (!prepared.ok) return prepared;
  const stored = await fetch(prepared.data.upload.url, {
    method: prepared.data.upload.method,
    headers: prepared.data.upload.headers,
    body: await file.arrayBuffer(),
    cache: "no-store",
  }).catch(() => undefined);
  if (!stored?.ok) return { ok: false, message: "The file could not be uploaded. Check your connection and try again.", code: "storage_upload_failed" };
  const completed = await run(() => portalApi<unknown>(`/portal/outside-results/uploads/${prepared.data.document.id}/complete`, { method: "POST" }));
  if (!completed.ok) return completed;
  const performedOn = text("performedOn");
  const notes = text("notes");
  const result = await run(() =>
    portalApi<PortalOutsideResult>("/portal/outside-results", {
      method: "POST",
      body: { documentId: prepared.data.document.id, sourceName, tests, ...(performedOn ? { performedOn } : {}), ...(notes ? { notes } : {}) },
    }),
  );
  revalidatePath("/documents");
  return result;
}

export async function withdrawOutsideResult(submissionId: string): Promise<Result<PortalOutsideResult>> {
  if (!UUID.test(submissionId)) return { ok: false, message: "Unknown result." };
  const result = await run(() => portalApi<PortalOutsideResult>(`/portal/outside-results/${submissionId}/withdraw`, { method: "POST", body: {} }));
  revalidatePath("/documents");
  return result;
}
