"use server";

import { revalidatePath } from "next/cache";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { MergeWorkItem } from "@/lib/api/types";
import { checkMergeForm, type MergeFormErrors } from "@/lib/patient-merge";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MergeResult =
  { ok: true; data: { survivorPatientId: string } } | { ok: false; message: string; code?: string; fieldErrors?: MergeFormErrors; blockers?: MergeWorkItem[] };

export interface MergeRequest {
  retiredPatientId: string;
  retiredNumber: string;
  survivorPatientId: string;
  retiredVersion: number;
  survivorVersion: number;
  /** Every flagged difference, and those the person ticked. */
  differences: string[];
  acknowledged: string[];
  reason: string;
  confirmation: string;
}

/**
 * Merges the duplicate into the surviving record. The API checks the permission, both versions, every flagged
 * difference, the blockers again and audits the merge; nothing filed under the duplicate is rewritten.
 */
export async function mergePatient(request: MergeRequest): Promise<MergeResult> {
  if (!UUID.test(request.retiredPatientId) || !UUID.test(request.survivorPatientId)) return { ok: false, message: "Unknown patient." };
  const fieldErrors = checkMergeForm(
    { reason: request.reason, confirmation: request.confirmation, acknowledged: request.acknowledged },
    request.retiredNumber,
    request.differences.map((code) => ({ code })),
  );
  if (Object.keys(fieldErrors).length) return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  const result = await actionResult(() =>
    api<{ survivorPatientId: string }>(`/patients/${request.retiredPatientId}/merge`, {
      method: "POST",
      body: {
        survivorPatientId: request.survivorPatientId,
        reason: request.reason.trim(),
        retiredVersion: request.retiredVersion,
        survivorVersion: request.survivorVersion,
        acknowledgedDifferences: request.acknowledged,
      },
    }),
  );
  if (!result.ok) {
    const blockers = result.code === "merge_blocked" ? ((result.details as { blockers?: MergeWorkItem[] } | undefined)?.blockers ?? []) : undefined;
    return { ok: false, message: result.message, code: result.code, blockers };
  }
  revalidatePath(`/patients/${request.retiredPatientId}`);
  revalidatePath(`/patients/${request.survivorPatientId}`);
  return { ok: true, data: { survivorPatientId: result.data.survivorPatientId } };
}

/** Undoes the merge of a retired record (its previous status comes back; later records stay on the survivor). */
export async function unmergePatient(retiredPatientId: string, survivorPatientId: string, reason: string): Promise<ActionResult> {
  if (!UUID.test(retiredPatientId) || !UUID.test(survivorPatientId)) return { ok: false, message: "Unknown patient." };
  if (reason.trim().length < 5) return { ok: false, message: "Give a reason of at least 5 characters." };
  const result = await actionResult(() => api(`/patients/${retiredPatientId}/unmerge`, { method: "POST", body: { reason: reason.trim() } }));
  if (!result.ok) return result;
  revalidatePath(`/patients/${retiredPatientId}`);
  revalidatePath(`/patients/${survivorPatientId}`);
  return { ok: true, data: null };
}
