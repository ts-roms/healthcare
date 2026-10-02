"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { OutreachCampaign, OutreachSegment } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates the criteria, the wording and every transition.

const id = z.uuid();
const version = z.number().int().positive();
const optionalNumber = z.number().int().optional();
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const criteriaSchema = z.object({
  ageMin: optionalNumber,
  ageMax: optionalNumber,
  sex: z.enum(["male", "female"]).optional(),
  cityMunicipality: optionalText,
  province: optionalText,
  registeredFrom: optionalText,
  registeredTo: optionalText,
  lastVisitBefore: optionalText,
  noVisitForMonths: optionalNumber,
  carePlanActivityDueWithinDays: optionalNumber,
  optedInChannel: z.enum(["sms", "email", "push", "in_app"]).optional(),
});
const segmentSchema = z.object({
  name: z.string().trim().min(2, "Give the segment a name.").max(120),
  description: z.string().trim().max(500).optional(),
  criteria: criteriaSchema,
});

export async function saveSegment(
  input: z.input<typeof segmentSchema>,
  existing: { id: string; version: number } | null,
): Promise<ActionResult<OutreachSegment>> {
  const parsed = segmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the segment." };
  const body = { ...parsed.data, description: parsed.data.description || null };
  const result = await actionResult(() =>
    existing
      ? api<OutreachSegment>(`/outreach/segments/${existing.id}`, { method: "PUT", body: { ...body, version: existing.version } })
      : api<OutreachSegment>("/outreach/segments", { method: "POST", body }),
  );
  if (result.ok) revalidatePath("/outreach");
  return result;
}

export async function archiveSegment(segmentId: string, segmentVersion: number): Promise<ActionResult<OutreachSegment>> {
  const result = await actionResult(() =>
    api<OutreachSegment>(`/outreach/segments/${id.parse(segmentId)}/archive`, { method: "POST", body: { version: version.parse(segmentVersion) } }),
  );
  if (result.ok) revalidatePath("/outreach");
  return result;
}

const campaignSchema = z.object({
  segmentId: id,
  name: z.string().trim().min(2, "Give the campaign a name.").max(120),
  channels: z.array(z.enum(["sms", "email", "push", "in_app"])).min(1, "Choose at least one channel."),
  subject: z.string().trim().max(120).optional(),
  body: z.string().trim().min(10, "Write the message (at least 10 characters).").max(2000),
  sendAt: optionalText,
});

export async function saveCampaign(
  input: z.input<typeof campaignSchema>,
  existing: { id: string; version: number } | null,
): Promise<ActionResult<OutreachCampaign>> {
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the campaign." };
  const body = { ...parsed.data, subject: parsed.data.subject || null, sendAt: parsed.data.sendAt ? new Date(parsed.data.sendAt).toISOString() : null };
  const result = await actionResult(() =>
    existing
      ? api<OutreachCampaign>(`/outreach/campaigns/${existing.id}`, { method: "PUT", body: { ...body, version: existing.version } })
      : api<OutreachCampaign>("/outreach/campaigns", { method: "POST", body }),
  );
  if (result.ok) {
    revalidatePath("/outreach");
    revalidatePath(`/outreach/campaigns/${result.data.id}`);
  }
  return result;
}

export async function moveCampaign(
  campaignId: string,
  action: "submit" | "reopen" | "approve",
  campaignVersion: number,
): Promise<ActionResult<OutreachCampaign>> {
  const result = await actionResult(() =>
    api<OutreachCampaign>(`/outreach/campaigns/${id.parse(campaignId)}/${action}`, { method: "POST", body: { version: version.parse(campaignVersion) } }),
  );
  if (result.ok) {
    revalidatePath("/outreach");
    revalidatePath(`/outreach/campaigns/${campaignId}`);
  }
  return result;
}

export async function cancelCampaign(campaignId: string, campaignVersion: number, reason: string): Promise<ActionResult<OutreachCampaign>> {
  const text = reason.trim();
  if (text.length < 3) return { ok: false, message: "Say why the campaign is cancelled." };
  const result = await actionResult(() =>
    api<OutreachCampaign>(`/outreach/campaigns/${id.parse(campaignId)}/cancel`, {
      method: "POST",
      body: { version: version.parse(campaignVersion), reason: text },
    }),
  );
  if (result.ok) {
    revalidatePath("/outreach");
    revalidatePath(`/outreach/campaigns/${campaignId}`);
  }
  return result;
}
