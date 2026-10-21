"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { PatientQrCode } from "@/lib/api/types";

// The API checks permission, the organization's setting and state; shapes are checked here only to fail fast.

const patientId = z.uuid();

export async function issuePatientQr(id: string): Promise<ActionResult<PatientQrCode>> {
  if (!patientId.safeParse(id).success) return { ok: false, message: "Unknown patient." };
  const result = await actionResult(() => api<PatientQrCode>(`/patient-qr/patients/${id}`, { method: "POST" }));
  revalidatePath(`/patients/${id}`);
  return result;
}

export async function revokePatientQr(id: string, reason: string): Promise<ActionResult<PatientQrCode>> {
  if (!patientId.safeParse(id).success) return { ok: false, message: "Unknown patient." };
  const trimmed = reason.trim();
  if (trimmed.length < 5) return { ok: false, message: "Give a reason of at least 5 characters." };
  const result = await actionResult(() => api<PatientQrCode>(`/patient-qr/patients/${id}/revoke`, { method: "POST", body: { reason: trimmed } }));
  revalidatePath(`/patients/${id}`);
  return result;
}
