"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { OutreachCampaign, OutreachCampaignReach, OutreachSegment, OutreachSettings } from "@/lib/api/types";

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
  birthMonth: optionalNumber,
  myHealth: z.enum(["active", "not_active"]).optional(),
  registeredFacilityId: z.uuid().optional(),
  identifierOnFile: z.enum(["philhealth_pin", "hmo_member_id"]).optional(),
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
  includeBookingLink: z.boolean().optional(),
  deliveryMode: z.enum(["all", "first_available"]).optional(),
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

/** Who the campaign can reach on its channels, and what the organization's limits would do to it now (counts only; audited). */
export async function loadCampaignReach(campaignId: string): Promise<ActionResult<OutreachCampaignReach>> {
  if (!id.safeParse(campaignId).success) return { ok: false, message: "Unknown campaign." };
  return actionResult(() => api<OutreachCampaignReach>(`/outreach/campaigns/${campaignId}/reach`));
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 22:00.");
const settingsSchema = z.object({
  frequencyCap: z
    .object({
      maxCampaigns: z.number().int().min(1, "At least 1.").max(20, "At most 20."),
      windowDays: z.number().int().min(1, "At least 1 day.").max(365, "At most 365 days."),
    })
    .nullable(),
  quietHours: z.object({
    enabled: z.boolean(),
    start: hhmm.nullable(),
    end: hhmm.nullable(),
    channels: z.array(z.enum(["sms", "email", "push"])),
  }),
  version: z.number().int().min(0),
});
/** Saves how often and when outreach goes out (the people who approve campaigns; audited). */
export async function saveOutreachSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult<OutreachSettings>> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the limits." };
  const quiet = parsed.data.quietHours;
  if (quiet.enabled && (!quiet.start || !quiet.end)) return { ok: false, message: "Give the quiet hours a start and an end." };
  if (quiet.enabled && quiet.start === quiet.end) return { ok: false, message: "The quiet hours cannot start and end at the same time." };
  if (quiet.enabled && quiet.channels.length === 0) return { ok: false, message: "Choose which channels wait for quiet hours to end." };
  const result = await actionResult(() => api<OutreachSettings>("/outreach/settings", { method: "PUT", body: parsed.data }));
  if (result.ok) {
    revalidatePath("/outreach");
    revalidatePath("/outreach/settings");
  }
  return result;
}

/** Puts the campaign's wording, as a sample patient would get it, in the caller's own notifications and email (nothing goes to a patient). */
export async function testSendCampaign(
  campaignId: string,
): Promise<ActionResult<{ sent: Array<{ channel: "in_app" | "email"; status: string; reason: string | null }> }>> {
  if (!id.safeParse(campaignId).success) return { ok: false, message: "Unknown campaign." };
  return actionResult(() =>
    api<{ sent: Array<{ channel: "in_app" | "email"; status: string; reason: string | null }> }>(`/outreach/campaigns/${campaignId}/test-send`, {
      method: "POST",
    }),
  );
}
