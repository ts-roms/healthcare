"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { Prescription } from "@/lib/api/types";

// Lines are validated in `lib/prescription-form.ts` before they get here, and again (authoritatively) by the API.
const line = z.record(z.string(), z.unknown());
const override = z.string().trim().min(10, "Document why the warning is overridden (at least 10 characters)").max(1000).optional();

const issueSchema = z.object({
  encounterId: z.uuid(),
  items: z.array(line).min(1).max(20),
  notes: z.string().trim().max(2000).optional(),
  allergyOverrideReason: override,
});
/**
 * Issues a prescription in an open encounter. A `409 allergy_warning` is
 * decision support: the caller shows the warnings and may resubmit with an
 * override reason. The idempotency key makes a double submit issue one prescription.
 */
export async function issuePrescription(input: z.input<typeof issueSchema>, idempotencyKey: string): Promise<ActionResult<Prescription>> {
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const body = { ...parsed.data, notes: parsed.data.notes || undefined };
  return actionResult(() => api<Prescription>("/prescriptions", { method: "POST", body, idempotencyKey }));
}

const replaceSchema = z.object({
  prescriptionId: z.uuid(),
  items: z.array(line).min(1).max(20),
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(500),
  notes: z.string().trim().max(2000).optional(),
  allergyOverrideReason: override,
});
/** Corrects a prescription: the old one becomes "superseded" and points to the new one. */
export async function replacePrescription(input: z.input<typeof replaceSchema>): Promise<ActionResult<Prescription>> {
  const parsed = replaceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { prescriptionId, ...body } = parsed.data;
  return actionResult(() =>
    api<Prescription>(`/prescriptions/${prescriptionId}/replace`, { method: "POST", body: { ...body, notes: body.notes || undefined } }),
  );
}

const cancelSchema = z.object({ prescriptionId: z.uuid(), reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(500) });
export async function cancelPrescription(input: z.input<typeof cancelSchema>): Promise<ActionResult<Prescription>> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { prescriptionId, reason } = parsed.data;
  return actionResult(() => api<Prescription>(`/prescriptions/${prescriptionId}/cancel`, { method: "POST", body: { reason } }));
}
