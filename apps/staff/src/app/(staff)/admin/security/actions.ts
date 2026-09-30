"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { MfaPolicy } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API authorizes (user.mfa.manage), audits and refuses what the policy
// does not allow (requiring it before your own is on, exempting or resetting yourself).

const reason = z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500);

function refresh(userId?: string) {
  revalidatePath("/admin/security");
  if (userId) revalidatePath(`/admin/users/${userId}`);
}

export async function setMfaRequired(required: boolean, version: number, why: string): Promise<ActionResult<MfaPolicy>> {
  const parsed = reason.optional().safeParse(why.trim() || undefined);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Give a reason." };
  const result = await actionResult(() => api<MfaPolicy>("/security/mfa-policy", { method: "PUT", body: { required, version, reason: parsed.data } }));
  if (result.ok) refresh();
  return result;
}

export async function exemptFromMfa(userId: string, why: string): Promise<ActionResult<MfaPolicy>> {
  const parsed = reason.safeParse(why);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Give a reason." };
  const result = await actionResult(() => api<MfaPolicy>(`/users/${userId}/mfa-exemption`, { method: "PUT", body: { reason: parsed.data } }));
  if (result.ok) refresh(userId);
  return result;
}

export async function removeMfaExemption(userId: string): Promise<ActionResult<MfaPolicy>> {
  const result = await actionResult(() => api<MfaPolicy>(`/users/${userId}/mfa-exemption`, { method: "DELETE" }));
  if (result.ok) refresh(userId);
  return result;
}

export async function resetMemberMfa(userId: string, why: string): Promise<ActionResult> {
  const parsed = reason.safeParse(why);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Give a reason." };
  const result = await actionResult(() => api<void>(`/users/${userId}/mfa-reset`, { method: "POST", body: { reason: parsed.data } }));
  if (result.ok) refresh(userId);
  return result.ok ? { ok: true, data: null } : result;
}
