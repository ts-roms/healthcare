import { median, type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";

/**
 * Rule `security.unusual-access` (docs/domains/assistant.md): staff accounts whose access to patient records in the last
 * hours stands out from the audit trail — many more patients than the account's own usual working day, patients opened
 * outside the organization's working hours, or many refused requests. It may be a busy day, a shared screen, or a
 * compromised account: the suggestion points an administrator to that account's audit trail and decides nothing,
 * blocks nothing and tells no one else. Only administrators see it (`audit.read`). Counts only, never a patient.
 */

export const unusualAccessParameters = z
  .object({
    /** Hours of the audit trail looked at, ending now. */
    windowHours: z.number().int().min(1).max(168),
    /** Patients opened in the window below this are never flagged for volume. */
    minPatients: z.number().int().min(5).max(5000),
    /** Flag when the window holds this many times the account's usual working day. */
    multiple: z.number().int().min(2).max(20),
    /** The organization's working hours (local), start and end hour. */
    workStartHour: z.number().int().min(0).max(23),
    workEndHour: z.number().int().min(1).max(24),
    /** Patients opened outside working hours from which an account is flagged. */
    minOffHoursPatients: z.number().int().min(1).max(1000),
    /** Refused requests in the window from which an account is flagged. */
    minDenials: z.number().int().min(3).max(1000),
  })
  .refine((p) => p.workEndHour > p.workStartHour, { path: ["workEndHour"], message: "Working hours must end after they start" });
export type UnusualAccessParameters = z.infer<typeof unusualAccessParameters>;

export const UNUSUAL_ACCESS_RULE: RuleDefinition<UnusualAccessParameters> = {
  id: "security.unusual-access",
  version: 1,
  domain: "audit",
  title: "Unusual access to patient records",
  description:
    "Points administrators to staff accounts that opened many more patient records than usual, opened records outside working hours, or were refused many times, from the audit trail. It blocks nothing.",
  surfaces: ["security"],
  requires: ["audit.read"],
  parametersSchema: unusualAccessParameters,
  defaultParameters: { windowHours: 24, minPatients: 50, multiple: 3, workStartHour: 7, workEndHour: 19, minOffHoursPatients: 5, minDenials: 10 },
  parameterLabels: {
    windowHours: { label: "Look at the last", unit: "hours", min: 1, max: 168 },
    multiple: { label: "Flag an account that opened at least", unit: "times its usual day's patients", min: 2, max: 20 },
    minPatients: { label: "…and at least", unit: "patients", min: 5, max: 5000, hint: "Below this, a busy day is never flagged." },
    workStartHour: { label: "Working hours start at", unit: "o'clock", min: 0, max: 23 },
    workEndHour: { label: "Working hours end at", unit: "o'clock", min: 1, max: 24 },
    minOffHoursPatients: { label: "Flag outside working hours from", unit: "patients", min: 1, max: 1000 },
    minDenials: { label: "Flag refused requests from", unit: "refusals", min: 3, max: 1000 },
  },
};

export interface UnusualAccessInput {
  userId: string;
  displayName: string;
  /** Distinct patients the account opened in the window. */
  patients: number;
  /** Distinct patients per earlier working day (days the account opened at least one), oldest first. */
  usualDays: number[];
  /** Distinct patients opened outside working hours in the window. */
  offHoursPatients: number;
  /** Refused requests in the window. */
  denials: number;
}

/** The reasons an account stands out, in plain words. */
export function unusualReasons(input: UnusualAccessInput, params: UnusualAccessParameters): { reasons: string[]; usual: number | null } {
  const usual = median(input.usualDays, 5);
  const reasons: string[] = [];
  if (input.patients >= params.minPatients && (usual === null || input.patients >= params.multiple * Math.max(usual, 1))) {
    reasons.push(
      usual === null
        ? `opened ${input.patients} patients' records in ${params.windowHours} hours (no usual pattern yet)`
        : `opened ${input.patients} patients' records in ${params.windowHours} hours, against about ${Math.round(usual)} on a usual day`,
    );
  }
  if (input.offHoursPatients >= params.minOffHoursPatients) {
    reasons.push(`opened ${input.offHoursPatients} patients' records outside ${params.workStartHour}:00–${params.workEndHour}:00`);
  }
  if (input.denials >= params.minDenials) reasons.push(`was refused ${input.denials} times`);
  return { reasons, usual };
}

export function unusualAccessSuggestions(inputs: readonly UnusualAccessInput[], params: UnusualAccessParameters, date: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const input of inputs) {
    const { reasons, usual } = unusualReasons(input, params);
    if (reasons.length === 0) continue;
    out.push({
      id: suggestionId(UNUSUAL_ACCESS_RULE.id, UNUSUAL_ACCESS_RULE.version, `user:${input.userId}:${date}`),
      ruleId: UNUSUAL_ACCESS_RULE.id,
      ruleVersion: UNUSUAL_ACCESS_RULE.version,
      surface: "security",
      severity: reasons.length >= 2 ? "warning" : "advice",
      title: `${input.displayName}: ${reasons[0]}`,
      rationale:
        `${reasons.length > 1 ? `Also ${reasons.slice(1).join("; ")}. ` : ""}` +
        "It may be a busy day or a shared screen; it may also be an account someone else is using. Check the audit trail and ask the person if in doubt.",
      evidence: [
        { label: `Patients opened in the last ${params.windowHours} hours`, resourceType: "app_user", resourceId: input.userId, value: String(input.patients) },
        {
          label: "Usual working day",
          resourceType: "app_user",
          resourceId: input.userId,
          value: usual === null ? "not enough history" : `about ${Math.round(usual)}`,
        },
        { label: "Outside working hours", resourceType: "app_user", resourceId: input.userId, value: String(input.offHoursPatients) },
        { label: "Refused requests", resourceType: "app_user", resourceId: input.userId, value: String(input.denials) },
      ],
      basis: "statistic",
      strength: usual === null && reasons.length === 1 && reasons[0]!.includes("no usual pattern") ? "weak" : "matched",
      requires: [...UNUSUAL_ACCESS_RULE.requires],
      action: { label: "Open their audit trail", href: `/admin/audit?actor=${input.userId}` },
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? a.title.localeCompare(b.title) : a.severity === "warning" ? -1 : 1));
}
