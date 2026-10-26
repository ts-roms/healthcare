import "server-only";
import { ApiError } from "@healthcare/web-session";
import { api } from "./client";
import { can, getSession } from "./session";
import type { OutsideResult, OutsideResultSubmission, UnreviewedOutsideResult } from "./types";

/** The patient's filed outside results (audited by the API); null without outside-result.read. */
export async function loadOutsideResults(patientId: string): Promise<OutsideResult[] | null> {
  const session = await getSession();
  if (!can(session, "outside-result.read")) return null;
  try {
    return await api<OutsideResult[]>(`/patients/${patientId}/outside-results`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  }
}

/** Filings awaiting a clinician's review (each listed patient is audited by the API); null without outside-result.review. */
export async function loadUnreviewedOutsideResults(): Promise<UnreviewedOutsideResult[] | null> {
  const session = await getSession();
  if (!can(session, "outside-result.review")) return null;
  try {
    return await api<UnreviewedOutsideResult[]>("/outside-results/unreviewed");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  }
}

/** Results patients sent that wait for the records office (each listed patient is audited by the API); null without outside-result.submission.manage. */
export async function loadOutsideResultSubmissions(): Promise<OutsideResultSubmission[] | null> {
  const session = await getSession();
  if (!can(session, "outside-result.submission.manage")) return null;
  try {
    return await api<OutsideResultSubmission[]>("/outside-result-submissions");
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  }
}
