"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { StaffRoleDefinition, StaffUser } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call (and refuses to hand out
// permissions the administrator does not hold).

const reason = z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500);

const addSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter the person's work email."),
  displayName: z.string().trim().min(1, "Enter the name to show.").max(200),
  initialPassword: z.string().max(128).optional(),
});

export async function addStaffMember(input: z.input<typeof addSchema>): Promise<ActionResult<StaffUser>> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  const result = await actionResult(() =>
    api<StaffUser>("/users", { method: "POST", body: { ...parsed.data, initialPassword: parsed.data.initialPassword || undefined } }),
  );
  if (result.ok) revalidatePath("/admin/users");
  return result;
}

export async function setMembershipStatus(userId: string, status: "active" | "suspended", why: string): Promise<ActionResult<StaffUser>> {
  const parsed = reason.safeParse(why);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Give a reason." };
  const result = await actionResult(() => api<StaffUser>(`/users/${userId}/membership`, { method: "PATCH", body: { status, reason: parsed.data } }));
  if (result.ok) revalidatePath(`/admin/users/${userId}`);
  return result;
}

const resetPasswordSchema = z
  .object({
    temporaryPassword: z.string().min(12, "The temporary password needs at least 12 characters.").max(128),
    confirm: z.string(),
    reason,
  })
  .refine((v) => v.temporaryPassword === v.confirm, { message: "The passwords do not match.", path: ["confirm"] });

/** Gives a member a temporary password to replace at the next sign-in; their sessions end (user.manage, audited). */
export async function resetStaffPassword(userId: string, input: z.input<typeof resetPasswordSchema>): Promise<ActionResult<StaffUser>> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!z.uuid().safeParse(userId).success) return { ok: false, message: "Invalid request." };
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the password." };
  const { temporaryPassword, reason: why } = parsed.data;
  const result = await actionResult(() => api<StaffUser>(`/users/${userId}/password-reset`, { method: "POST", body: { temporaryPassword, reason: why } }));
  if (result.ok) revalidatePath(`/admin/users/${userId}`);
  return result;
}

/** Turns off a member's two-step verification (e.g. a lost phone); their sessions end (user.manage, audited). */
export async function resetStaffTwoStep(userId: string, why: string): Promise<ActionResult<StaffUser>> {
  const parsed = reason.safeParse(why);
  if (!z.uuid().safeParse(userId).success) return { ok: false, message: "Invalid request." };
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Give a reason." };
  const result = await actionResult(() => api<StaffUser>(`/users/${userId}/mfa-reset`, { method: "POST", body: { reason: parsed.data } }));
  if (result.ok) revalidatePath(`/admin/users/${userId}`);
  return result;
}

const grantSchema = z.object({
  roleId: z.string().uuid("Choose a role."),
  facilityId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});

export async function grantRole(userId: string, input: z.input<typeof grantSchema>): Promise<ActionResult<StaffUser>> {
  const parsed = grantSchema.safeParse({
    roleId: input.roleId,
    facilityId: input.facilityId || undefined,
    departmentId: input.departmentId || undefined,
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Choose a role." };
  const result = await actionResult(() => api<StaffUser>(`/users/${userId}/role-assignments`, { method: "POST", body: parsed.data }));
  if (result.ok) revalidatePath(`/admin/users/${userId}`);
  return result;
}

export async function revokeRole(userId: string, assignmentId: string, why: string): Promise<ActionResult<StaffUser>> {
  const parsed = reason.safeParse(why);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Give a reason." };
  const result = await actionResult(() =>
    api<StaffUser>(`/users/${userId}/role-assignments/${assignmentId}`, { method: "DELETE", query: { reason: parsed.data } }),
  );
  if (result.ok) revalidatePath(`/admin/users/${userId}`);
  return result;
}

const roleSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,48}$/, "Use 2–49 lower-case letters, digits or underscores, starting with a letter."),
  name: z.string().trim().min(1, "Name the role.").max(120),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.string()).min(1, "Choose at least one permission."),
});

export async function createRole(input: z.input<typeof roleSchema>): Promise<ActionResult<StaffRoleDefinition>> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the role." };
  const result = await actionResult(() =>
    api<StaffRoleDefinition>("/roles", { method: "POST", body: { ...parsed.data, description: parsed.data.description || undefined } }),
  );
  if (result.ok) revalidatePath("/admin/roles");
  return result;
}
