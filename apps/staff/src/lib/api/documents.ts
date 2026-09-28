import "server-only";
import { ApiError } from "@healthcare/web-session";
import { api } from "./client";

interface CreatedDocument {
  document: { id: string };
  upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string };
}

export interface PatientDocumentUpload {
  patientId: string;
  category: "consent_form" | "imaging";
  title: string;
  file: File;
  /** Makes a retried registration return the same document instead of a new one. */
  idempotencyKey: string;
}

/**
 * Uploads a file for a patient through the API's two-step flow:
 * register the document (presigned PUT), send the bytes from this server to
 * object storage, then ask the API to verify the stored object. The browser
 * never talks to storage directly, so the bucket needs no CORS rules.
 * Returns the document id once it is available.
 */
export async function uploadPatientDocument({ patientId, category, title, file, idempotencyKey }: PatientDocumentUpload): Promise<string> {
  const { document, upload } = await api<CreatedDocument>("/documents", {
    method: "POST",
    body: { category, title, fileName: file.name, contentType: file.type, sizeBytes: file.size, patientId },
    idempotencyKey,
  });
  const stored = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: await file.arrayBuffer(), cache: "no-store" }).catch(
    () => undefined,
  );
  if (!stored?.ok) throw new ApiError(502, "storage_upload_failed", "The file could not be stored. Try again.");
  await api(`/documents/${document.id}/complete`, { method: "POST" });
  return document.id;
}

/** A short-lived download link (the API audits each one). */
export function documentDownloadUrl(documentId: string): Promise<{ url: string; expiresAt: string }> {
  return api(`/documents/${documentId}/download-url`);
}
