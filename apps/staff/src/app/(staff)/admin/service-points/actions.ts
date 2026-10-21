"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { RouteTemplate, ServicePoint, ServicePointSettings } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call (clinic.configure).

const KINDS = ["consultation", "emergency", "imaging", "other"] as const;
const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Codes use 2–49 lower-case letters, digits or hyphens.");
const name = z.string().trim().min(1, "Name the service point.").max(120);
/** What the display says when a route sends a patient here; empty = the name. */
const location = z
  .string()
  .trim()
  .max(60, "Keep the location to 60 characters; it is shown in large type and read out.")
  .transform((v) => v || null);

export async function createServicePoint(input: {
  facilityId: string;
  code: string;
  name: string;
  kind: string;
  location?: string;
}): Promise<ActionResult<ServicePoint>> {
  const parsed = z.object({ facilityId: z.uuid(), code, name, kind: z.enum(KINDS), location: location.optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the service point." };
  const result = await actionResult(() => api<ServicePoint>("/clinic/service-points", { method: "POST", body: parsed.data }));
  if (result.ok) revalidatePath("/admin/service-points");
  return result;
}

export async function updateServicePoint(
  servicePointId: string,
  input: { name?: string; kind?: string; status?: "active" | "inactive"; location?: string; version: number },
): Promise<ActionResult<ServicePoint>> {
  const parsed = z
    .object({
      name: name.optional(),
      kind: z.enum(KINDS).optional(),
      status: z.enum(["active", "inactive"]).optional(),
      location: location.optional(),
      version: z.number().int().positive(),
    })
    .safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(servicePointId).success)
    return { ok: false, message: parsed.success ? "Invalid request." : (parsed.error.issues[0]?.message ?? "Check the service point.") };
  const result = await actionResult(() => api<ServicePoint>(`/clinic/service-points/${servicePointId}`, { method: "PATCH", body: parsed.data }));
  // A version conflict means someone else changed it first: the list is re-read either way.
  revalidatePath("/admin/service-points");
  return result;
}

/** The facility's routing settings (migration 0115): call the patient automatically when a route sends them on. */
export async function saveServicePointSettings(input: {
  facilityId: string;
  autoCallOnRoute: boolean;
  version?: number;
}): Promise<ActionResult<ServicePointSettings>> {
  const parsed = z.object({ facilityId: z.uuid(), autoCallOnRoute: z.boolean(), version: z.number().int().positive().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const result = await actionResult(() => api<ServicePointSettings>("/clinic/service-point-settings", { method: "PUT", body: parsed.data }));
  revalidatePath("/admin/service-points");
  return result;
}

const templateStops = z.array(z.uuid()).min(1, "Add at least one stop.").max(10, "A route has at most 10 stops.");
const templateVisitTypes = z.array(z.uuid()).max(100);

/** A route template (migration 0116): a named list of the facility's service points. */
export async function createRouteTemplate(input: {
  facilityId: string;
  code: string;
  name: string;
  servicePointIds: string[];
  defaultForVisitTypeIds?: string[];
}): Promise<ActionResult<RouteTemplate>> {
  const parsed = z
    .object({
      facilityId: z.uuid(),
      code,
      name: z.string().trim().min(1, "Name the route template.").max(120),
      servicePointIds: templateStops,
      defaultForVisitTypeIds: templateVisitTypes.optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the route template." };
  const result = await actionResult(() => api<RouteTemplate>("/clinic/route-templates", { method: "POST", body: parsed.data }));
  if (result.ok) revalidatePath("/admin/service-points");
  return result;
}

export async function updateRouteTemplate(
  routeTemplateId: string,
  input: { name?: string; status?: "active" | "inactive"; servicePointIds?: string[]; defaultForVisitTypeIds?: string[]; version: number },
): Promise<ActionResult<RouteTemplate>> {
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Name the route template.").max(120).optional(),
      status: z.enum(["active", "inactive"]).optional(),
      servicePointIds: templateStops.optional(),
      defaultForVisitTypeIds: templateVisitTypes.optional(),
      version: z.number().int().positive(),
    })
    .safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(routeTemplateId).success)
    return { ok: false, message: parsed.success ? "Invalid request." : (parsed.error.issues[0]?.message ?? "Check the route template.") };
  const result = await actionResult(() => api<RouteTemplate>(`/clinic/route-templates/${routeTemplateId}`, { method: "PATCH", body: parsed.data }));
  revalidatePath("/admin/service-points");
  return result;
}
