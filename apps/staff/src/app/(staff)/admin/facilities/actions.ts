"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { Department, FacilityDetail } from "@/lib/api/types";
import { FACILITY_TYPES } from "./facility-types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

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

const detailsSchema = z.object({
  name: z.string().trim().min(1, "Name the facility.").max(200),
  facilityType: z.enum(FACILITY_TYPES.map((t) => t.value) as [string, ...string[]]),
  addressLine: optional(300),
  barangay: optional(120),
  cityMunicipality: optional(120),
  province: optional(120),
  region: optional(120),
  postalCode: z
    .string()
    .trim()
    .transform((v) => v || undefined)
    .refine((v) => v === undefined || /^\d{4}$/.test(v), "Philippine postal codes have 4 digits."),
  contactNumber: optional(40),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v || undefined)
    .refine((v) => v === undefined || z.email().safeParse(v).success, "Enter a valid email or leave it empty."),
  licenseNumber: optional(80),
});
export type FacilityDetailsInput = z.input<typeof detailsSchema>;

export async function createFacility(input: FacilityDetailsInput & { code: string }): Promise<ActionResult<FacilityDetail>> {
  const parsed = detailsSchema.extend({ code }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the facility." };
  const result = await actionResult(() => api<FacilityDetail>("/facilities", { method: "POST", body: parsed.data }));
  if (result.ok) revalidatePath("/admin/facilities");
  return result;
}

export async function updateFacility(
  facilityId: string,
  input: FacilityDetailsInput & { status: "active" | "inactive"; version: number },
): Promise<ActionResult<FacilityDetail>> {
  const parsed = detailsSchema.extend({ status: z.enum(["active", "inactive"]), version: z.number().int().positive() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the facility." };
  const result = await actionResult(() => api<FacilityDetail>(`/facilities/${facilityId}`, { method: "PATCH", body: parsed.data }));
  revalidatePath("/admin/facilities");
  return result;
}

export async function createDepartment(facilityId: string, input: { code: string; name: string }): Promise<ActionResult<Department>> {
  const parsed = z.object({ code, name: z.string().trim().min(1, "Name the department.").max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the department." };
  const result = await actionResult(() => api<Department>(`/facilities/${facilityId}/departments`, { method: "POST", body: parsed.data }));
  if (result.ok) revalidatePath("/admin/facilities");
  return result;
}
