"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { PatientSummary } from "@/lib/api/types";

/**
 * Resolves what a scanner delivered. The API checks the QR code against the organization's active codes, audits the scan
 * (never the payload) and returns the minimal patient summary; opening the record is a separate, audited request.
 */
export async function scanPatientQr(payload: string): Promise<ActionResult<{ patient: PatientSummary }>> {
  const parsed = z.string().trim().min(1).max(200).safeParse(payload);
  if (!parsed.success) return { ok: false, message: "Scan a patient QR code." };
  return actionResult(() => api<{ patient: PatientSummary }>("/patient-qr/scan", { method: "POST", body: { payload: parsed.data } }));
}
