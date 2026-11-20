import { type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";
import { type FrequencyCap, type QuietHours, quietHoldUntil, type SegmentCriteria } from "../crm.rules";

/**
 * The outreach assistant's rules (docs/domains/assistant.md), on the outreach screen for the people who plan campaigns:
 * when patients use MyHealth, audiences worth a segment, and patients receiving many campaigns. They read counts only —
 * never a patient — and change nothing: each suggestion is a link to a screen where a person decides. Audience ideas
 * use the same non-clinical criteria as every segment (crm.rules.ts), never a diagnosis, result or medication.
 */

const pct = (part: number, whole: number): string => `${Math.round((part / whole) * 100)}%`;
const clock = (hour: number): string => `${String(((hour % 24) + 24) % 24).padStart(2, "0")}:00`;

// ---- crm.send-hour ---------------------------------------------------------------------------------------------------

export const sendHourParameters = z.object({
  /** Days of MyHealth use looked at, ending now. */
  lookbackDays: z.number().int().min(7).max(90),
  /** Below this many visits in the period, nothing is said. */
  minVisits: z.number().int().min(20).max(100_000),
  /** How many hours the suggested window spans. */
  windowHours: z.number().int().min(1).max(4),
});
export type SendHourParameters = z.infer<typeof sendHourParameters>;

export const SEND_HOUR_RULE: RuleDefinition<SendHourParameters> = {
  id: "crm.send-hour",
  version: 1,
  domain: "crm",
  title: "When patients use MyHealth",
  description:
    "The hours of the day patients use MyHealth most, counted from the audit trail, as a guide to when outreach is read. It says nothing about patients without MyHealth and changes no campaign.",
  surfaces: ["outreach"],
  requires: ["crm.campaign.manage"],
  parametersSchema: sendHourParameters,
  defaultParameters: { lookbackDays: 28, minVisits: 200, windowHours: 2 },
  parameterLabels: {
    lookbackDays: { label: "Look at the last", unit: "days", min: 7, max: 90 },
    windowHours: { label: "Suggest a window of", unit: "hours", min: 1, max: 4 },
    minVisits: {
      label: "Only from",
      unit: "MyHealth visits",
      min: 20,
      max: 100_000,
      hint: "With fewer visits there is too little to say when patients read messages.",
    },
  },
};

export interface SendHourInput {
  /** MyHealth visits per local hour (0 to 23, Asia/Manila): an account active in that hour of a day counts once. */
  hourly: readonly number[];
  /** The organization's quiet hours when they are on: messages sent then wait until they end, so no window starts there. */
  quietHours: QuietHours | null;
  /** The local hours the most recent campaigns started at, newest first. */
  recentSendHours: readonly number[];
}

/** Visits in the `hours` hours starting at `start` (wrapping past midnight). */
export function windowVisits(hourly: readonly number[], start: number, hours: number): number {
  let total = 0;
  for (let i = 0; i < hours; i += 1) total += hourly[(start + i) % 24] ?? 0;
  return total;
}

/** Whether a message sent at `hour`:00 Asia/Manila time would wait for the end of quiet hours. */
export function inQuietHours(hour: number, quiet: QuietHours | null): boolean {
  return quiet !== null && quietHoldUntil(new Date(`2000-01-03T${clock(hour)}:00+08:00`), quiet) !== null;
}

/** The window with the most visits that does not start inside quiet hours (ties: the earlier hour). */
export function bestSendWindow(input: SendHourInput, windowHours: number): { start: number; visits: number } | null {
  let best: { start: number; visits: number } | null = null;
  for (let start = 0; start < 24; start += 1) {
    if (inQuietHours(start, input.quietHours)) continue;
    const visits = windowVisits(input.hourly, start, windowHours);
    if (!best || visits > best.visits) best = { start, visits };
  }
  return best;
}

/** The hour recent campaigns most often started at (ties: the most recent one). */
export function usualSendHour(hours: readonly number[]): number | null {
  if (hours.length === 0) return null;
  const counts = new Map<number, number>();
  for (const hour of hours) counts.set(hour, (counts.get(hour) ?? 0) + 1);
  let usual = hours[0] ?? 0;
  for (const hour of hours) if ((counts.get(hour) ?? 0) > (counts.get(usual) ?? 0)) usual = hour;
  return usual;
}

export function sendHourSuggestions(input: SendHourInput, params: SendHourParameters): Suggestion[] {
  const total = input.hourly.reduce((sum, n) => sum + n, 0);
  if (total < params.minVisits) return [];
  const best = bestSendWindow(input, params.windowHours);
  if (!best || best.visits === 0) return [];
  const usual = usualSendHour(input.recentSendHours);
  const usualVisits = usual === null ? null : windowVisits(input.hourly, usual, params.windowHours);
  // Recent campaigns already go out at about the best time: nothing to say.
  if (usualVisits !== null && usualVisits >= 0.8 * best.visits) return [];
  // Use spread evenly over the day: the hour matters little, and the suggestion says so.
  const spread = best.visits / total < 1.5 * (params.windowHours / 24);
  const from = clock(best.start);
  const to = clock(best.start + params.windowHours);
  let busiest = 0;
  for (let hour = 1; hour < 24; hour += 1) if ((input.hourly[hour] ?? 0) > (input.hourly[busiest] ?? 0)) busiest = hour;
  const quiet = input.quietHours;
  return [
    {
      id: suggestionId(SEND_HOUR_RULE.id, SEND_HOUR_RULE.version, `window:${best.start}:${params.windowHours}`),
      ruleId: SEND_HOUR_RULE.id,
      ruleVersion: SEND_HOUR_RULE.version,
      surface: "outreach",
      severity: usual === null ? "info" : "advice",
      title: spread ? `MyHealth use is spread over the day, a little more around ${from}–${to}` : `Patients use MyHealth most around ${from}–${to}`,
      rationale:
        `${pct(best.visits, total)} of MyHealth visits in the last ${params.lookbackDays} days fell between ${from} and ${to} (Asia/Manila time)` +
        (usual !== null && usualVisits !== null
          ? `, against ${pct(usualVisits, total)} in the ${params.windowHours} hours from ${clock(usual)}, when recent campaigns started. `
          : ". ") +
        "When patients use MyHealth is a guide to when they read messages; it says nothing about patients without MyHealth." +
        (quiet ? ` No window starting in your quiet hours (${quiet.start}–${quiet.end}) is suggested.` : ""),
      evidence: [
        {
          label: `MyHealth visits between ${from} and ${to}`,
          resourceType: "portal_activity",
          resourceId: `hours:${best.start}:${params.windowHours}`,
          value: `${best.visits} (${pct(best.visits, total)})`,
        },
        ...(usual !== null && usualVisits !== null
          ? [
              {
                label: `From ${clock(usual)}, when recent campaigns started`,
                resourceType: "crm_campaign",
                resourceId: `hour:${usual}`,
                value: `${usualVisits} (${pct(usualVisits, total)})`,
              },
            ]
          : []),
        {
          label: "Busiest single hour",
          resourceType: "portal_activity",
          resourceId: `hour:${busiest}`,
          value: `${clock(busiest)}–${clock(busiest + 1)} (${pct(input.hourly[busiest] ?? 0, total)})`,
        },
        { label: `MyHealth visits in the last ${params.lookbackDays} days`, resourceType: "portal_activity", resourceId: "total", value: String(total) },
        ...(quiet
          ? [{ label: "Quiet hours (no window starts there)", resourceType: "crm_setting", resourceId: "quiet_hours", value: `${quiet.start}–${quiet.end}` }]
          : []),
      ],
      basis: "statistic",
      strength: spread ? "weak" : "matched",
      requires: [...SEND_HOUR_RULE.requires],
      action: { label: "Plan a campaign", href: "/outreach#campaigns" },
    },
  ];
}

// ---- crm.audience-ideas ----------------------------------------------------------------------------------------------

export const audienceIdeasParameters = z.object({
  /** "Longer than usual" is beyond the time this share of returning patients came back within. */
  returnPercentile: z.number().int().min(50).max(95),
  /** Returns measured below which the usual return time is not worked out. */
  minReturns: z.number().int().min(20).max(100_000),
  /** An idea matching fewer patients is not offered. */
  minPatients: z.number().int().min(5).max(100_000),
  /** Next month's birthdays are offered in the month's last days (0: never). */
  birthdayLeadDays: z.number().int().min(0).max(28),
});
export type AudienceIdeasParameters = z.infer<typeof audienceIdeasParameters>;

export const AUDIENCE_IDEAS_RULE: RuleDefinition<AudienceIdeasParameters> = {
  id: "crm.audience-ideas",
  version: 1,
  domain: "crm",
  title: "Audiences to consider",
  description:
    "Offers a segment the organization does not have yet: patients not seen for longer than your own patients usually take to come back, and next month's birthdays. Non-clinical criteria only; nothing is created until someone saves the segment.",
  surfaces: ["outreach"],
  requires: ["crm.segment.manage"],
  parametersSchema: audienceIdeasParameters,
  defaultParameters: { returnPercentile: 75, minReturns: 50, minPatients: 20, birthdayLeadDays: 10 },
  parameterLabels: {
    returnPercentile: {
      label: "“Not seen for longer than usual” is beyond the time",
      unit: "% of returning patients came back within",
      min: 50,
      max: 95,
      hint: "Measured on the gaps between your own patients' completed consultations over the last two years.",
    },
    minReturns: {
      label: "Work it out only from",
      unit: "returns",
      min: 20,
      max: 100_000,
      hint: "With fewer, no usual return time is worked out and no recall idea is offered.",
    },
    minPatients: { label: "Offer an idea from", unit: "patients", min: 5, max: 100_000 },
    birthdayLeadDays: { label: "Offer next month's birthdays in the last", unit: "days of the month (0: never)", min: 0, max: 28 },
  },
};

/** How long patients take to come back: gaps between completed consultations of the same patient. */
export interface ReturnFigures {
  /** Gaps measured. */
  returns: number;
  /** The gap in days within which `returnPercentile`% of them fall; null without any. */
  days: number | null;
}

export interface AudienceIdea {
  /** Stable key: what the idea is about (`recall:5`, `birthdays:2026-12`). */
  key: string;
  name: string;
  criteria: SegmentCriteria;
  /** Why it is offered, in one sentence. */
  why: string;
  basis: "rule" | "statistic";
  evidence: Array<{ label: string; value: string }>;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The local day's month (1 to 12), the next month and its year, and the days left after `today` in its month. */
function calendar(today: string): { nextMonth: number; nextYear: number; daysLeft: number } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { nextMonth: month === 12 ? 1 : month + 1, nextYear: month === 12 ? year + 1 : year, daysLeft: length - day };
}

/** Days to whole months, as the segment criterion takes them (rounded up, 1 to 120). */
export function monthsFromDays(days: number): number {
  return Math.min(120, Math.max(1, Math.ceil(days / 30.44)));
}

/**
 * The ideas worth counting: those the organization's active segments do not already cover. A recall idea is covered
 * by any segment that selects by the last visit; a birthday idea by a segment for that same month.
 */
export function audienceIdeas(
  input: { today: string; returns: ReturnFigures; segments: readonly SegmentCriteria[] },
  params: AudienceIdeasParameters,
): AudienceIdea[] {
  const ideas: AudienceIdea[] = [];
  const { returns } = input;
  const hasRecall = input.segments.some((c) => c.noVisitForMonths !== undefined || c.lastVisitBefore !== undefined);
  if (!hasRecall && returns.days !== null && returns.returns >= params.minReturns) {
    const months = monthsFromDays(returns.days);
    ideas.push({
      key: `recall:${months}`,
      name: `Not seen in ${months} month${months === 1 ? "" : "s"}`,
      criteria: { noVisitForMonths: months },
      why: `${params.returnPercentile}% of your patients who came back did so within ${returns.days} days (about ${months} month${months === 1 ? "" : "s"}); these patients have had no completed consultation for longer, including some registered but never seen.`,
      basis: "statistic",
      evidence: [
        { label: "Returns measured (two years)", value: String(returns.returns) },
        { label: `${params.returnPercentile}% came back within`, value: `${returns.days} days` },
      ],
    });
  }
  const { nextMonth, nextYear, daysLeft } = calendar(input.today);
  if (params.birthdayLeadDays > 0 && daysLeft < params.birthdayLeadDays && !input.segments.some((c) => c.birthMonth === nextMonth)) {
    const month = MONTHS[nextMonth - 1] ?? "";
    ideas.push({
      key: `birthdays:${nextYear}-${String(nextMonth).padStart(2, "0")}`,
      name: `Birthdays in ${month}`,
      criteria: { birthMonth: nextMonth },
      why: `A greeting to patients born in ${month}, chosen by the month only, never the year or the day.`,
      basis: "rule",
      evidence: [{ label: "Born in", value: month }],
    });
  }
  return ideas;
}

/** Where an idea's link opens the outreach screen: the new segment form filled in with its name and criteria. */
export function segmentDraftHref(idea: Pick<AudienceIdea, "name" | "criteria">): string {
  const query = new URLSearchParams({ segment: "new", name: idea.name });
  for (const [key, value] of Object.entries(idea.criteria)) if (value !== undefined) query.set(key, String(value));
  return `/outreach?${query.toString()}#segments`;
}

export function audienceIdeaSuggestions(ideas: ReadonlyArray<AudienceIdea & { patients: number }>, params: AudienceIdeasParameters): Suggestion[] {
  return ideas
    .filter((idea) => idea.patients >= params.minPatients)
    .map((idea) => ({
      id: suggestionId(AUDIENCE_IDEAS_RULE.id, AUDIENCE_IDEAS_RULE.version, `idea:${idea.key}`),
      ruleId: AUDIENCE_IDEAS_RULE.id,
      ruleVersion: AUDIENCE_IDEAS_RULE.version,
      surface: "outreach" as const,
      severity: "info" as const,
      title: `Audience idea: ${idea.name} (${idea.patients} patients)`,
      rationale: `${idea.why} Each patient's own opt-in per channel still decides who receives a message; the segment's preview shows how many can be reached.`,
      evidence: [
        { label: "Patients who match today", resourceType: "crm_segment_idea", resourceId: idea.key, value: String(idea.patients) },
        ...idea.evidence.map((e) => ({ label: e.label, resourceType: "crm_segment_idea", resourceId: idea.key, value: e.value })),
      ],
      basis: idea.basis,
      strength: "matched" as const,
      requires: [...AUDIENCE_IDEAS_RULE.requires],
      action: { label: "Create this segment", href: segmentDraftHref(idea) },
    }));
}

// ---- crm.frequency-load ----------------------------------------------------------------------------------------------

export const frequencyLoadParameters = z.object({
  windowDays: z.number().int().min(7).max(90),
  /** Campaigns received in the window from which a patient counts. */
  campaigns: z.number().int().min(2).max(20),
  /** Such patients below which nothing is said. */
  minPatients: z.number().int().min(1).max(100_000),
});
export type FrequencyLoadParameters = z.infer<typeof frequencyLoadParameters>;

export const FREQUENCY_LOAD_RULE: RuleDefinition<FrequencyLoadParameters> = {
  id: "crm.frequency-load",
  version: 1,
  domain: "crm",
  title: "Patients receiving many campaigns",
  description:
    "Warns when patients received many outreach campaigns in a short time and the organization's frequency cap does not prevent it. It holds nothing back: a cap is set under Outreach → Limits.",
  surfaces: ["outreach"],
  requires: ["crm.campaign.approve"],
  parametersSchema: frequencyLoadParameters,
  defaultParameters: { windowDays: 30, campaigns: 4, minPatients: 10 },
  parameterLabels: {
    windowDays: { label: "Look at the last", unit: "days", min: 7, max: 90 },
    campaigns: { label: "Count patients who received", unit: "campaigns or more", min: 2, max: 20 },
    minPatients: { label: "Warn from", unit: "such patients", min: 1, max: 100_000 },
  },
};

export interface FrequencyLoadInput {
  /** Patients who received at least `campaigns` outreach campaigns (queued or delivered) in the window. */
  patients: number;
  /** The most campaigns any one patient received in it. */
  mostReceived: number;
  cap: FrequencyCap | null;
}

export function frequencyLoadSuggestions(input: FrequencyLoadInput, params: FrequencyLoadParameters): Suggestion[] {
  const { cap } = input;
  if (input.patients < params.minPatients) return [];
  // The cap already prevents this many in this period: what is counted went out before it was set.
  if (cap && cap.maxCampaigns < params.campaigns && cap.windowDays >= params.windowDays) return [];
  return [
    {
      id: suggestionId(FREQUENCY_LOAD_RULE.id, FREQUENCY_LOAD_RULE.version, `load:${params.windowDays}:${params.campaigns}`),
      ruleId: FREQUENCY_LOAD_RULE.id,
      ruleVersion: FREQUENCY_LOAD_RULE.version,
      surface: "outreach",
      severity: "advice",
      title: `${input.patients} patient${input.patients === 1 ? "" : "s"} received ${params.campaigns} or more campaigns in ${params.windowDays} days`,
      rationale:
        (cap ? `Your frequency cap allows ${cap.maxCampaigns} in ${cap.windowDays} days. ` : "No frequency cap is set. ") +
        "Many messages in a short time can lead patients to opt out of outreach; a cap holds back a patient who has had enough, and is recorded with the campaign.",
      evidence: [
        {
          label: `Patients with ${params.campaigns} or more campaigns in ${params.windowDays} days`,
          resourceType: "crm_campaign_delivery",
          resourceId: `window:${params.windowDays}`,
          value: String(input.patients),
        },
        {
          label: "Most received by one patient",
          resourceType: "crm_campaign_delivery",
          resourceId: `window:${params.windowDays}`,
          value: String(input.mostReceived),
        },
        {
          label: "Frequency cap",
          resourceType: "crm_setting",
          resourceId: "frequency_cap",
          value: cap ? `${cap.maxCampaigns} in ${cap.windowDays} days` : "none",
        },
      ],
      basis: "rule",
      strength: "matched",
      requires: [...FREQUENCY_LOAD_RULE.requires],
      action: { label: "Review outreach limits", href: "/outreach/settings" },
    },
  ];
}
