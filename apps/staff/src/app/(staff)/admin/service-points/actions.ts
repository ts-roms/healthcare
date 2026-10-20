"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { ServicePoint } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call (clinic.configure).

const KINDS = ["consultation", "emergency", "imaging", "other"] as const;
const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Codes use 2–49 lower-case letters, digits or hyphens.");
const name = z.string().trim().min(1, "Name the service point.").max(120);

export async function createServicePoint(input: { facilityId: string; code: string; name: string; kind: string }): Promise<ActionResult<ServicePoint>> {
  const parsed = z.object({ facilityId: z.uuid(), code, name, kind: z.enum(KINDS) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the service point." };
  const result = await actionResult(() => api<ServicePoint>("/clinic/service-points", { method: "POST", body: parsed.data }));
  if (result.ok) revalidatePath("/admin/service-points");
  return result;
}

export async function updateServicePoint(
  servicePointId: string,
  input: { name?: string; kind?: string; status?: "active" | "inactive"; version: number },
): Promise<ActionResult<ServicePoint>> {
  const parsed = z
    .object({ name: name.optional(), kind: z.enum(KINDS).optional(), status: z.enum(["active", "inactive"]).optional(), version: z.number().int().positive() })
    .safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(servicePointId).success)
    return { ok: false, message: parsed.success ? "Invalid request." : (parsed.error.issues[0]?.message ?? "Check the service point.") };
  const result = await actionResult(() => api<ServicePoint>(`/clinic/service-points/${servicePointId}`, { method: "PATCH", body: parsed.data }));
  // A version conflict means someone else changed it first: the list is re-read either way.
  revalidatePath("/admin/service-points");
  return result;
}
