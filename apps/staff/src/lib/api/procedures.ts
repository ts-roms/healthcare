import "server-only";
import { ApiError } from "@healthcare/web-session";
import { api } from "./client";
import { can, getSession } from "./session";

const tolerate = <T>(call: () => Promise<T>): Promise<T | null> =>
  call().catch((error: unknown) => {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404 || error.status === 400)) return null;
    throw error;
  });

/** A signed consent form uploaded for the patient (`consent_form`, available), to link to a procedure's consent. */
export interface ConsentFormDocument {
  id: string;
  title: string;
}

/** The patient's available `consent_form` documents (title only); null without document.read. */
export async function loadConsentFormDocuments(patientId: string): Promise<ConsentFormDocument[] | null> {
  const session = await getSession();
  if (!can(session, "document.read")) return null;
  const docs = await tolerate(() => api<Array<{ id: string; title: string; status: string; category: string }>>("/documents", { query: { patientId } }));
  return docs ? docs.filter((d) => d.status === "available" && d.category === "consent_form").map((d) => ({ id: d.id, title: d.title })) : null;
}
