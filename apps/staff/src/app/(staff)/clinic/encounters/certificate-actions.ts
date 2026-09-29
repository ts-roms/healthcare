"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { MedicalCertificate } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const date = z.iso.date();
const issueSchema = z.object({
  encounterId: z.uuid(),
  purpose: z.string().trim().min(3, "Say what the certificate is for.").max(200),
  findings: z.string().trim().min(3, "Write the findings or diagnosis.").max(2000),
  recommendations: z.string().trim().max(2000).optional(),
  rest: z.object({ from: date, to: date }).optional(),
});
export async function issueCertificate(input: z.input<typeof issueSchema>): Promise<ActionResult<MedicalCertificate>> {
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { encounterId, recommendations, ...body } = parsed.data;
  return actionResult(() =>
    api<MedicalCertificate>(`/encounters/${encounterId}/certificates`, { method: "POST", body: { ...body, recommendations: recommendations || undefined } }),
  );
}

const voidSchema = z.object({ certificateId: z.uuid(), reason: z.string().trim().min(5, "Say why the certificate is void.").max(500) });
export async function voidCertificate(input: z.input<typeof voidSchema>): Promise<ActionResult<MedicalCertificate>> {
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  return actionResult(() =>
    api<MedicalCertificate>(`/medical-certificates/${parsed.data.certificateId}/void`, { method: "POST", body: { reason: parsed.data.reason } }),
  );
}
