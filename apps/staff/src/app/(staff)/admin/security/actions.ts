"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { AuditArchive, MfaPolicy, PatientMfaPolicy } from "@/lib/api/types";

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

/** Patients: require it from a date (the API wants at least a week's notice), or stop requiring it. */
export async function setPatientMfaPolicy(input: {
  required: boolean;
  requiredFrom: string;
  version: number;
  reason: string;
}): Promise<ActionResult<PatientMfaPolicy>> {
  const parsed = reason.optional().safeParse(input.reason.trim() || undefined);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Give a reason." };
  const requiredFrom = input.requiredFrom.trim();
  if (input.required && !/^\d{4}-\d{2}-\d{2}$/.test(requiredFrom)) return { ok: false, message: "Choose the date from which it is required." };
  const result = await actionResult(() =>
    api<PatientMfaPolicy>("/security/patient-mfa-policy", {
      method: "PUT",
      body: { required: input.required, requiredFrom: input.required ? requiredFrom : null, version: input.version, reason: parsed.data },
    }),
  );
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

const PARTITION = /^audit_event_(history|\d{4}_\d{2})$/;

/** Platform administrators: archive a closed month of the audit trail (written and verified in the background). */
export async function archiveAuditMonth(partition: string): Promise<ActionResult<AuditArchive>> {
  if (!PARTITION.test(partition)) return { ok: false, message: "Not an audit month." };
  const result = await actionResult(() => api<AuditArchive>(`/audit/retention/partitions/${partition}/archive`, { method: "POST" }));
  if (result.ok) refresh();
  return result;
}

/** Platform administrators: remove an archived month past the retention period, with a reason. */
export async function removeAuditMonth(partition: string, why: string): Promise<ActionResult<{ removedEvents: number }>> {
  if (!PARTITION.test(partition)) return { ok: false, message: "Not an audit month." };
  const parsed = z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500).safeParse(why);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Give a reason." };
  const result = await actionResult(() =>
    api<{ removedEvents: number }>(`/audit/retention/partitions/${partition}/remove`, { method: "POST", body: { reason: parsed.data } }),
  );
  if (result.ok) refresh();
  return result;
}
