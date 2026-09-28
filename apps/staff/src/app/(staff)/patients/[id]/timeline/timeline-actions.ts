"use server";

import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { PatientTimelinePage } from "@/lib/api/types";
import { timelineApiQuery, type TimelineFilters } from "@/lib/timeline-mapping";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The next page of the patient's timeline (the API checks access per kind and audits the view). */
export async function loadMoreTimeline(patientId: string, filters: TimelineFilters, cursor: string): Promise<ActionResult<PatientTimelinePage>> {
  if (!UUID.test(patientId)) return { ok: false, message: "Unknown patient." };
  return actionResult(() => api<PatientTimelinePage>(`/patients/${patientId}/timeline`, { query: { ...timelineApiQuery(filters), cursor } }));
}
