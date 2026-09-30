"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { ApiError, userMessage } from "@healthcare/web-session";
import { api } from "@/lib/api/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProxyActionResult = { ok: true } | { ok: false; message: string };

function failure(error: unknown): { ok: false; message: string } {
  unstable_rethrow(error);
  return { ok: false, message: error instanceof ApiError ? userMessage(error) : "The server could not be reached. Try again." };
}

export interface GrantProxyInput {
  guardianPatientNumber: string;
  relationship: string;
  basis: string;
  canAct: boolean;
  verificationNote: string;
  expiresOn: string;
}

/** Gives another patient access to this patient's MyHealth, after the clinic has checked who they are and their right to act. */
export async function grantProxy(patientId: string, input: GrantProxyInput): Promise<ProxyActionResult> {
  if (!UUID.test(patientId)) return { ok: false, message: "Unknown patient." };
  try {
    await api(`/patients/${patientId}/portal-proxies`, {
      method: "POST",
      body: {
        guardianPatientNumber: input.guardianPatientNumber.trim(),
        relationship: input.relationship,
        basis: input.basis,
        scopes: input.canAct ? ["view", "act"] : ["view"],
        verificationNote: input.verificationNote.trim(),
        ...(input.expiresOn ? { expiresOn: input.expiresOn } : {}),
      },
    });
    revalidatePath(`/patients/${patientId}`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function revokeProxy(patientId: string, grantId: string, reason: string): Promise<ProxyActionResult> {
  if (!UUID.test(patientId) || !UUID.test(grantId)) return { ok: false, message: "Unknown access." };
  const trimmed = reason.trim();
  if (trimmed.length < 3) return { ok: false, message: "Say why access is ending." };
  try {
    await api(`/patients/${patientId}/portal-proxies/${grantId}/revoke`, { method: "POST", body: { reason: trimmed } });
    revalidatePath(`/patients/${patientId}`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
