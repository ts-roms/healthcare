import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { api } from "./client";
import { ApiError } from "@healthcare/web-session";
import type { PatientDetail, Practitioner, VisitType } from "./types";

/** Active practitioners of the organization (for schedules, booking and assignment). */
export const getPractitioners = cache(async (): Promise<Practitioner[]> =>
  (await api<Practitioner[]>("/clinic/practitioners")).filter((p) => p.status === "active"),
);

/** Active visit types of the organization. */
export const getVisitTypes = cache(async (): Promise<VisitType[]> => (await api<VisitType[]>("/clinic/visit-types")).filter((v) => v.status === "active"));

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
