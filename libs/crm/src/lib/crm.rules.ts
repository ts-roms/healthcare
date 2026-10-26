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
    /** Born in this month (1 to 12), for a birthday greeting. Never the year or the exact day. */
    birthMonth: z.number().int().min(1).max(12).optional(),
    /** MyHealth: has an active account, or has none that is active (never signed up, only invited, or disabled). */
    myHealth: z.enum(["active", "not_active"]).optional(),
    /** Registered at this facility of the organization. */
    registeredFacilityId: z.uuid().optional(),
    /** Has this kind of number on file (PhilHealth or an HMO membership). Never the number itself. */
    identifierOnFile: z.enum(["philhealth_pin", "hmo_member_id"]).optional(),
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
  channel: keyof typeof BODY_LIMITS | "subject" | "body";
  message: string;
}

/** Why a campaign's wording cannot go out on its channels, if anything. */
export function wordingProblems(input: {
  channels: ReadonlyArray<keyof typeof BODY_LIMITS>;
  subject: string | null;
  body: string;
  /** Characters added after the body (the booking link), which count against every channel's length. */
  reservedChars?: number;
  /** The organization's name, which fills {{clinicName}}; the length check uses the longest a first name could be. */
  clinicName?: string;
}): WordingProblem[] {
  const problems: WordingProblem[] = [];
  const body = input.body.trim();
  for (const token of unknownPlaceholders(`${input.subject ?? ""}\n${body}`)) {
    problems.push({ channel: "body", message: `{{${token}}} is not a placeholder you can use. Use ${PLACEHOLDERS.map((p) => `{{${p}}}`).join(" or ")}.` });
  }
  if (input.subject && renderedLength(input.subject, input.clinicName ?? "") > SUBJECT_MAX)
    problems.push({ channel: "subject", message: `The subject is longer than ${SUBJECT_MAX} characters` });
  const length = renderedLength(body, input.clinicName ?? "") + (input.reservedChars ?? 0);
  for (const channel of input.channels) {
    if (length > BODY_LIMITS[channel])
      problems.push({
        channel,
        message: `The message is longer than ${BODY_LIMITS[channel]} characters allowed for ${channel}${input.reservedChars ? " (with the booking link)" : ""}`,
      });
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

// ---- the booking link ------------------------------------------------------------------------------------------------

/** MyHealth's booking page. The address carries nothing about the patient: signing in is what identifies them. */
export const BOOKING_LINK_PATH = "/appointments/book";
export const BOOKING_LINK_LABEL = "Book a visit: ";

/** The booking link's address for MyHealth at `portalBase`. */
export function bookingLinkUrl(portalBase: string): string {
  return `${portalBase.replace(/\/$/, "")}${BOOKING_LINK_PATH}`;
}

/** What follows the body in a message that carries the booking link (the notification template renders the same text). */
export function bookingLinkText(portalBase: string): string {
  return `\n\n${BOOKING_LINK_LABEL}${bookingLinkUrl(portalBase)}`;
}

// ---- how often and when ----------------------------------------------------------------------------------------------

export interface FrequencyCap {
  maxCampaigns: number;
  windowDays: number;
}

/** Whether a patient already reached by `recent` campaigns in the window is held back from another one. */
export function capReached(recent: number, cap: FrequencyCap | null): boolean {
  return cap !== null && recent >= cap.maxCampaigns;
}

export interface QuietHours {
  /** "HH:MM" in Asia/Manila time; a start later than the end crosses midnight ("22:00" to "07:00"). */
  start: string;
  end: string;
}

const DAY_MS = 86_400_000;
/** The Philippines has no daylight saving: local time is UTC+8 all year. */
const PH_OFFSET_MS = 8 * 3_600_000;

const clockMs = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return ((h ?? 0) * 60 + (m ?? 0)) * 60_000;
};

/** When a message held for quiet hours may go out (the end of the period), or null when `at` is not in quiet hours. */
export function quietHoldUntil(at: Date, quiet: QuietHours): Date | null {
  const start = clockMs(quiet.start);
  const end = clockMs(quiet.end);
  const local = (((at.getTime() + PH_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  const inside = start < end ? local >= start && local < end : local >= start || local < end;
  if (!inside) return null;
  return new Date(at.getTime() + ((end - local + DAY_MS) % DAY_MS));
}

// ---- who a campaign can actually reach -------------------------------------------------------------------------------

export type ReachChannel = "sms" | "email" | "push" | "in_app";

/** What the notification service's consent and contact checks say about one patient on one channel. */
export type ChannelReach = { allowed: true } | { allowed: false; reason: string };

export interface ReachSummary {
  /** Patients whose reach was checked (a very large segment is checked in part). */
  evaluated: number;
  /** True when the segment has more members than were checked: the figures describe the first `evaluated`. */
  sampled: boolean;
  /** For each channel: patients who can be messaged, and why the others cannot (most common first). */
  byChannel: Array<{ channel: ReachChannel; reachable: number; notReached: Array<{ reason: string; total: number }> }>;
  /** Patients who can be messaged on at least one of the channels. */
  reachableOnAny: number;
  /** Patients who can be messaged on none of them. */
  unreachable: number;
}

/** Tallies per-patient results into what a person reads: reachable counts and the reasons for the rest. */
export function summarizeReach(
  channels: readonly ReachChannel[],
  results: ReadonlyArray<Partial<Record<ReachChannel, ChannelReach>>>,
  totalMatched: number,
): ReachSummary {
  const byChannel = channels.map((channel) => {
    let reachable = 0;
    const reasons = new Map<string, number>();
    for (const result of results) {
      const outcome = result[channel];
      if (outcome?.allowed) reachable += 1;
      else reasons.set(outcome?.reason ?? "unknown", (reasons.get(outcome?.reason ?? "unknown") ?? 0) + 1);
    }
    return {
      channel,
      reachable,
      notReached: [...reasons.entries()].map(([reason, total]) => ({ reason, total })).sort((a, b) => b.total - a.total || a.reason.localeCompare(b.reason)),
    };
  });
  const reachableOnAny = results.filter((result) => channels.some((channel) => result[channel]?.allowed)).length;
  return { evaluated: results.length, sampled: totalMatched > results.length, byChannel, reachableOnAny, unreachable: results.length - reachableOnAny };
}

// ---- wording variables -----------------------------------------------------------------------------------------------

/**
 * What a campaign's wording may fill in for each patient: their first name and the organization's name, nothing else.
 * Nothing clinical, and no appointment, balance or contact detail, can be put into a message this way.
 */
export const PLACEHOLDERS = ["firstName", "clinicName"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** The longest first name a message carries (a longer one is cut at its first word), so the length check can be exact. */
export const FIRST_NAME_MAX = 30;
export const CLINIC_NAME_MAX = 80;
export const SUBJECT_MAX = 120;

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Placeholder names in the text that are not ones the platform fills in (typos, or an attempt to put other data in). */
export function unknownPlaceholders(text: string): string[] {
  const unknown = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1] ?? "";
    if (!(PLACEHOLDERS as readonly string[]).includes(name)) unknown.add(name);
  }
  return [...unknown];
}

/** The patient's first name as the message shows it: their given name's first word, never empty or long. */
export function firstNameOf(givenName: string | null | undefined): string {
  const word = (givenName ?? "").trim().split(/\s+/)[0] ?? "";
  return word.slice(0, FIRST_NAME_MAX) || "there";
}

/** The wording with each placeholder filled in for one patient (an unknown one is left as written). */
export function renderWording(text: string, values: { firstName: string; clinicName: string }): string {
  return text.replace(PLACEHOLDER_PATTERN, (whole, name: string) =>
    name === "firstName" ? values.firstName : name === "clinicName" ? values.clinicName.slice(0, CLINIC_NAME_MAX) : whole,
  );
}

/** The longest the wording can be once filled in: a first name of the greatest length, the organization's own name. */
export function renderedLength(text: string, clinicName: string): number {
  return renderWording(text, { firstName: "x".repeat(FIRST_NAME_MAX), clinicName }).length;
}

// ---- one message per patient -----------------------------------------------------------------------------------------

export const DELIVERY_MODES = ["all", "first_available"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

/** For "one message per patient": the order channels are tried in. The app comes first, the inbox copy only as a last resort. */
export const CHANNEL_PRIORITY: readonly ReachChannel[] = ["push", "sms", "email", "in_app"];

/** The campaign's channels, in the order a patient is tried. */
export function prioritized(channels: readonly ReachChannel[]): ReachChannel[] {
  return CHANNEL_PRIORITY.filter((c) => channels.includes(c));
}

/** The first channel, in priority order, that can reach the patient; null when none can. */
export function firstAvailableChannel(channels: readonly ReachChannel[], result: Partial<Record<ReachChannel, ChannelReach>>): ReachChannel | null {
  return prioritized(channels).find((c) => result[c]?.allowed) ?? null;
}

/** How many patients each channel would carry in "one message per patient", and how many no channel reaches. */
export function plannedChannels(
  channels: readonly ReachChannel[],
  results: ReadonlyArray<Partial<Record<ReachChannel, ChannelReach>>>,
): { byChannel: Array<{ channel: ReachChannel; total: number }>; none: number } {
  const counts = new Map<ReachChannel, number>();
  let none = 0;
  for (const result of results) {
    const channel = firstAvailableChannel(channels, result);
    if (channel) counts.set(channel, (counts.get(channel) ?? 0) + 1);
    else none += 1;
  }
  return { byChannel: prioritized(channels).map((channel) => ({ channel, total: counts.get(channel) ?? 0 })), none };
}

// ---- approval nudges -------------------------------------------------------------------------------------------------

/** A campaign still waiting for approval this many days after it was submitted reminds its approvers once. */
export const APPROVAL_REMINDER_DAYS = 2;

export function approvalReminderDue(
  campaign: { status: string; submittedAt: Date | null; approvalRemindedAt: Date | null },
  now: Date,
  days: number = APPROVAL_REMINDER_DAYS,
): boolean {
  return (
    campaign.status === "submitted" &&
    campaign.submittedAt !== null &&
    campaign.approvalRemindedAt === null &&
    campaign.submittedAt.getTime() <= now.getTime() - days * 86_400_000
  );
}
