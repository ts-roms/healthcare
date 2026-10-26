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
export function wordingProblems(input: {
  channels: ReadonlyArray<keyof typeof BODY_LIMITS>;
  subject: string | null;
  body: string;
  /** Characters added after the body (the booking link), which count against every channel's length. */
  reservedChars?: number;
}): WordingProblem[] {
  const problems: WordingProblem[] = [];
  const body = input.body.trim();
  const length = body.length + (input.reservedChars ?? 0);
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
