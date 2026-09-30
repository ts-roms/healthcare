import "server-only";
import { ApiError } from "@healthcare/web-session";
import { api } from "./client";
import { can, getSession } from "./session";
import type { PatientHistory } from "./types";

export interface HistoryScreenData {
  /** The whole history (audited by the API); null without history.read. */
  history: PatientHistory | null;
  canRecord: boolean;
}

/** The patient's history and whether the user may record it; parts the user may not see are null. */
export async function loadPatientHistory(patientId: string): Promise<HistoryScreenData> {
  const session = await getSession();
  const canRecord = can(session, "history.record");
  if (!can(session, "history.read")) return { history: null, canRecord };
  const history = await api<PatientHistory>(`/patients/${patientId}/history`).catch((error: unknown) => {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
    throw error;
  });
  return { history, canRecord };
}
