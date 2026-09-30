"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { Referral, ReferralSettings } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const id = z.uuid();
const version = z.number().int().positive();
const optional = (min: number, max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length >= min ? v : undefined));

const createSchema = z.object({
  encounterId: id,
  kind: z.enum(["internal", "external"]),
  toPractitionerId: id.optional(),
  specialty: optional(2, 120),
  externalProvider: optional(2, 200),
  externalFacility: optional(2, 200),
  externalContact: optional(3, 200),
  urgency: z.enum(["routine", "urgent", "emergency"]),
  reason: z.string().trim().min(3, "Say why you are referring.").max(1000),
  clinicalSummary: optional(1, 4000),
  diagnosisIds: z.array(id).max(20),
});

export async function createReferral(input: z.input<typeof createSchema>): Promise<ActionResult<Referral>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid referral." };
  const { encounterId, ...body } = parsed.data;
  const result = await actionResult(() => api<Referral>(`/encounters/${encounterId}/referrals`, { method: "POST", body }));
  if (result.ok) revalidatePath(`/clinic/encounters/${encounterId}`);
  return result;
}

async function change(referralId: string, path: string, body: object): Promise<ActionResult<Referral>> {
  if (!id.safeParse(referralId).success) return { ok: false, message: "Unknown referral." };
  const result = await actionResult(() => api<Referral>(`/referrals/${referralId}/${path}`, { method: "POST", body }));
  if (result.ok) {
    revalidatePath(`/clinic/referrals/${referralId}`);
    revalidatePath("/clinic/referrals");
  }
  return result;
}

const answerSchema = z
  .object({ decision: z.enum(["accept", "decline"]), note: optional(3, 1000), version })
  .refine((v) => v.decision === "accept" || Boolean(v.note), { message: "Say why you are declining (at least 3 characters).", path: ["note"] });
export async function answerReferral(referralId: string, input: z.input<typeof answerSchema>) {
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid answer." };
  return change(referralId, "answer", parsed.data);
}

const appointmentSchema = z.object({ appointmentId: id, version });
export async function linkReferralAppointment(referralId: string, input: z.input<typeof appointmentSchema>) {
  const parsed = appointmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Choose an appointment." };
  return change(referralId, "appointment", parsed.data);
}

const completeSchema = z.object({
  outcomeNote: z.string().trim().min(3, "Write what came of the referral.").max(2000),
  replyDocumentId: id.optional(),
  version,
});
export async function completeReferral(referralId: string, input: z.input<typeof completeSchema>) {
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid outcome." };
  return change(referralId, "complete", parsed.data);
}

const cancelSchema = z.object({ reason: z.string().trim().min(5, "Say why the referral is cancelled (at least 5 characters).").max(500), version });
export async function cancelReferral(referralId: string, input: z.input<typeof cancelSchema>) {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid reason." };
  return change(referralId, "cancel", parsed.data);
}

/** Sets or clears the organization's overdue threshold in days (needs clinic.configure; audited with before and after). */
export async function saveReferralSettings(overdueAfterDays: number | null, settingsVersion: number): Promise<ActionResult<ReferralSettings>> {
  const parsed = z
    .object({ overdueAfterDays: z.number().int().min(1).max(365).nullable(), version: z.number().int().min(0) })
    .safeParse({ overdueAfterDays, version: settingsVersion });
  if (!parsed.success) return { ok: false, message: "Use a whole number of days from 1 to 365, or turn the flag off." };
  const result = await actionResult(() => api<ReferralSettings>("/referrals/settings", { method: "PUT", body: parsed.data }));
  if (result.ok) revalidatePath("/clinic/referrals");
  return result;
}
