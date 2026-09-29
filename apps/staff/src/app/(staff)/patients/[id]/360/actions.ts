"use server";

import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { documentDownloadUrl } from "@/lib/api/documents";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A short-lived link to open one of the patient's documents (the API checks access and audits each link). */
export async function workspaceDocumentLink(documentId: string): Promise<ActionResult<{ url: string }>> {
  if (!UUID.test(documentId)) return { ok: false, message: "Unknown document." };
  return actionResult(async () => ({ url: (await documentDownloadUrl(documentId)).url }));
}
