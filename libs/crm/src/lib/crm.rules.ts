import { z } from "zod";

/**
 * Outreach rules (docs/domains/crm.md). Segment criteria are non-clinical by design: who a patient is, where they
 * live, when they registered or last visited, whether a care-plan activity is due, and which channel they opted in
 * to. Selecting people by diagnosis, result or medication for outreach is a compliance decision first and is not a
 * criterion here.
 */
export const segmentCriteriaSchema = z
  .object({
    ageMin: z.number().int().min(0).max(120).optional(),
    ageMax: z.number().int().min(0).max(120).optional(),
    sex: z.enum(["male", "female"]).optional(),
    /** As recorded on the patient's primary address; matched case-insensitively, whole value. */
    cityMunicipality: z.string().trim().min(2).max(120).optional(),
    province: z.string().trim().min(2).max(120).optional(),
    registeredFrom: z.iso.date().optional(),
    registeredTo: z.iso.date().optional(),
    /** Last completed consultation on or before this day (patients never seen are left out). */
    lastVisitBefore: z.iso.date().optional(),
    /** No completed consultation in this many months, including patients never seen. */
    noVisitForMonths: z.number().int().min(1).max(120).optional(),
    /** An open care-plan activity due within this many days from today (overdue ones included). */
    carePlanActivityDueWithinDays: z.number().int().min(0).max(365).optional(),
    /** Only patients who opted in to outreach on this channel (the send still re-checks every channel). */
    optedInChannel: z.enum(["sms", "email", "push", "in_app"]).optional(),
  })
  .strict()
  .refine((c) => c.ageMin === undefined || c.ageMax === undefined || c.ageMin <= c.ageMax, { message: "ageMin must not exceed ageMax", path: ["ageMax"] })
  .refine((c) => c.registeredFrom === undefined || c.registeredTo === undefined || c.registeredFrom <= c.registeredTo, {
    message: "registeredFrom must not be after registeredTo",
    path: ["registeredTo"],
  })
  .refine((c) => c.lastVisitBefore === undefined || c.noVisitForMonths === undefined, {
    message: "Use lastVisitBefore or noVisitForMonths, not both",
    path: ["noVisitForMonths"],
  })
  .refine((c) => Object.values(c).some((v) => v !== undefined), { message: "At least one criterion is needed" });

export type SegmentCriteria = z.infer<typeof segmentCriteriaSchema>;

/** Plain-text limits per channel: what fits a text message, a push notification, an email or the MyHealth inbox. */
export const BODY_LIMITS: Record<"sms" | "email" | "push" | "in_app", number> = { sms: 320, push: 160, email: 2000, in_app: 2000 };

export interface WordingProblem {
  channel: keyof typeof BODY_LIMITS | "subject";
  message: string;
}

/** Why a campaign's wording cannot go out on its channels, if anything. */
export function wordingProblems(input: { channels: ReadonlyArray<keyof typeof BODY_LIMITS>; subject: string | null; body: string }): WordingProblem[] {
  const problems: WordingProblem[] = [];
  const body = input.body.trim();
  for (const channel of input.channels) {
    if (body.length > BODY_LIMITS[channel])
      problems.push({ channel, message: `The message is longer than ${BODY_LIMITS[channel]} characters allowed for ${channel}` });
  }
  if ((input.channels.includes("email") || input.channels.includes("in_app")) && !input.subject?.trim()) {
    problems.push({ channel: "subject", message: "Email and MyHealth messages need a subject" });
  }
  if (/https?:\/\/\S+/i.test(body) === false && /\bwww\./i.test(body)) problems.push({ channel: "subject", message: "Write links in full (https://...)" });
  return problems;
}

export const CAMPAIGN_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "draft", "cancelled"],
  approved: ["sending", "cancelled"],
  sending: ["completed"],
  completed: [],
  cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
  return CAMPAIGN_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Two people: the approver may be neither the author nor the one who submitted. */
export function canApprove(campaign: { createdBy: string; submittedBy: string | null }, approverId: string): boolean {
  return approverId !== campaign.createdBy && approverId !== campaign.submittedBy;
}

/** Approved campaigns whose time has come (no time = at once). */
export function isDueToSend(campaign: { status: string; sendAt: Date | null }, now: Date): boolean {
  return campaign.status === "approved" && (campaign.sendAt === null || campaign.sendAt.getTime() <= now.getTime());
}

/** The opt-out link is valid for this long after the campaign went out. */
export const OPT_OUT_TOKEN_DAYS = 30;
