"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { TenantDetail } from "@/lib/api/types";
import { FACILITY_TYPES } from "../admin/facilities/facility-types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call (platform administrators only).

const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Codes use 2–49 lower-case letters, digits or hyphens.");
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || undefined);

const createSchema = z.object({
  code,
  name: z.string().trim().min(1, "Name the organization.").max(200),
  facility: z.object({
    code,
    name: z.string().trim().min(1, "Name the first facility.").max(200),
    facilityType: z.enum(FACILITY_TYPES.map((t) => t.value) as [string, ...string[]]),
    cityMunicipality: optional(120),
    province: optional(120),
  }),
  administrator: z.object({
    email: z.string().trim().toLowerCase().email("Enter the administrator's email."),
    displayName: z.string().trim().min(1, "Enter the administrator's name.").max(200),
    temporaryPassword: z
      .string()
      .transform((v) => v || undefined)
      .refine((v) => v === undefined || v.length >= 12, "A temporary password needs at least 12 characters."),
  }),
});

/** Creates a tenant with its first facility and administrator (one transaction in the API, audited in the new organization). */
export async function createTenant(input: z.input<typeof createSchema>): Promise<ActionResult<TenantDetail>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const result = await actionResult(() => api<TenantDetail>("/platform/tenants", { method: "POST", body: parsed.data }));
  revalidatePath("/platform");
  return result;
}

const statusSchema = z.object({
  organizationId: z.uuid(),
  status: z.enum(["active", "suspended"]),
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(1000),
  version: z.number().int().positive(),
});

/** Suspends (every staff and MyHealth session ends) or reactivates an organization, with a reason kept in its history. */
export async function changeTenantStatus(input: z.input<typeof statusSchema>): Promise<ActionResult<TenantDetail>> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const { organizationId, ...body } = parsed.data;
  const result = await actionResult(() => api<TenantDetail>(`/platform/tenants/${organizationId}/status`, { method: "POST", body }));
  revalidatePath("/platform");
  revalidatePath(`/platform/${organizationId}`);
  return result;
}
