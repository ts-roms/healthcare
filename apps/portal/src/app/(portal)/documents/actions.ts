"use server";

import { revalidatePath } from "next/cache";
import { portalApi } from "@/lib/api/client";
import { type Result, run, UUID } from "@/lib/api/result";
import type { PortalRecordsRequest, PortalRecordsScope } from "@/lib/api/types";

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
