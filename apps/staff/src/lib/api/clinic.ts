import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { api } from "./client";
import { ApiError } from "@healthcare/web-session";
import type { PatientDetail, Practitioner, RouteTemplate, ServicePoint, VisitType } from "./types";

/** Active practitioners of the organization (for schedules, booking and assignment). */
export const getPractitioners = cache(async (): Promise<Practitioner[]> =>
  (await api<Practitioner[]>("/clinic/practitioners")).filter((p) => p.status === "active"),
);

/** Active visit types of the organization. */
export const getVisitTypes = cache(async (): Promise<VisitType[]> => (await api<VisitType[]>("/clinic/visit-types")).filter((v) => v.status === "active"));

/** A facility's active service points (migration 0113), for the triage picker and the queue switcher. */
export const getServicePoints = cache(async (facilityId: string): Promise<ServicePoint[]> =>
  api<ServicePoint[]>("/clinic/service-points", { query: { facilityId } }),
);

/** A facility's route templates (migration 0116); inactive ones only on request. */
export const getRouteTemplates = cache(async (facilityId: string, includeInactive = false): Promise<RouteTemplate[]> =>
  api<RouteTemplate[]>("/clinic/route-templates", { query: { facilityId, ...(includeInactive ? { includeInactive: "true" } : {}) } }),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The patient a check-in or booking is for; a missing, malformed or inaccessible id is a 404. */
export async function getPatientForAction(id: string | undefined): Promise<PatientDetail> {
  if (!id || !UUID.test(id)) notFound();
  try {
    return await api<PatientDetail>(`/patients/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
}
