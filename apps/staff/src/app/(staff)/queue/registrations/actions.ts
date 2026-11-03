"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.
const id = z.uuid();
const reason = z.string().trim().min(5, "Give a reason of at least 5 characters").max(500);

export interface ApprovedRegistration {
  patientId: string;
  patientNumber: string;
  visitId: string | null;
}

const approveSchema = z.object({
  registrationId: id,
  visitTypeId: id.optional(),
  /** Possible duplicates were looked at and this is a different person (the front desk's own rule). */
  duplicateOverride: z.object({ reviewedCandidateIds: z.array(id).min(1), reason }).optional(),
});

/** Registers the person through the front desk's ordinary registration (its duplicate rules apply), then closes the submission. */
export async function approveRegistration(input: z.input<typeof approveSchema>): Promise<ActionResult<ApprovedRegistration>> {
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { registrationId, ...body } = parsed.data;
  return actionResult(() => api<ApprovedRegistration>(`/kiosk/admin/registrations/${registrationId}/approve`, { method: "POST", body }));
}

const linkSchema = z.object({ registrationId: id, patientId: id, visitTypeId: id.optional() });

/** The person is already a patient: close the submission against that record, without creating one. */
export async function linkRegistration(input: z.input<typeof linkSchema>): Promise<ActionResult<{ patientId: string; visitId: string | null }>> {
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { registrationId, ...body } = parsed.data;
  return actionResult(() => api<{ patientId: string; visitId: string | null }>(`/kiosk/admin/registrations/${registrationId}/link`, { method: "POST", body }));
}

const rejectSchema = z.object({ registrationId: id, reason });

/** Declines the submission; what the person typed is erased. */
export async function rejectRegistration(input: z.input<typeof rejectSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { registrationId, ...body } = parsed.data;
  return actionResult(() => api<{ id: string }>(`/kiosk/admin/registrations/${registrationId}/reject`, { method: "POST", body }));
}
