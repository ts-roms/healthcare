import "server-only";
import { ApiError } from "@healthcare/web-session";
import { api } from "./client";
import { can, getSession } from "./session";
import type { OutsideResult } from "./types";

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
