import type { AssistantReplay, AssistantReviewOutcome, AssistantRule, AssistantRuleInsight, AssistantRuleReviewSummary } from "./api/types";

/**
 * What the assistant settings screen (`/admin/assistant`) shows for one rule. The API decides what is in force and
 * validates every value; these helpers only put the API's answer into words and fail fast on obvious input mistakes.
 */

export type RuleState =
  /** This scope has its own setting. */
  | { kind: "own"; enabled: boolean }
  /** A facility without a setting of its own: the organization's applies. */
  | { kind: "inherited"; enabled: boolean }
  /** Nothing set anywhere: the rule is off. */
  | { kind: "unset" };

export function ruleState(rule: AssistantRule): RuleState {
  if (rule.setting) return { kind: "own", enabled: rule.setting.enabled };
  if (rule.scope.facilityId && rule.organizationSetting) return { kind: "inherited", enabled: rule.organizationSetting.enabled };
  return { kind: "unset" };
}

/** Whether the rule runs in this scope, in a word with what decides it. */
export function ruleStateLabel(state: RuleState, scopeName: string): string {
  if (state.kind === "own") return `${state.enabled ? "On" : "Off"} for ${scopeName}`;
  if (state.kind === "inherited") return `${state.enabled ? "On" : "Off"}: follows the organization's setting`;
  return "Off: not turned on yet";
}

export interface ParameterField {
  key: string;
  label: string;
  unit?: string;
  hint?: string;
  min?: number;
  max?: number;
  /** As the input shows it. */
  value: string;
}

/**
 * The rule's parameters in the order the rule lists its labels, filled with this scope's values, else (for a facility)
 * the organization's, else the rule's starting values.
 */
export function parameterFields(rule: AssistantRule): ParameterField[] {
  const current = rule.setting?.parameters ?? rule.organizationSetting?.parameters ?? rule.defaultParameters;
  return Object.entries(rule.parameterLabels).map(([key, label]) => {
    const raw = current[key] ?? rule.defaultParameters[key];
    return { key, ...label, value: raw === undefined || raw === null ? "" : String(raw) };
  });
}

/** Whole numbers within each field's range, or the first problem in the field's own words. */
export function readParameters(
  fields: readonly ParameterField[],
  values: Readonly<Record<string, string>>,
): { ok: true; parameters: Record<string, number> } | { ok: false; message: string } {
  const parameters: Record<string, number> = {};
  for (const field of fields) {
    const text = (values[field.key] ?? "").trim();
    const value = Number(text);
    const inRange = (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max);
    if (text === "" || !Number.isInteger(value) || !inRange) {
      const range = field.min !== undefined && field.max !== undefined ? ` from ${field.min} to ${field.max}` : "";
      return { ok: false, message: `${field.label}: enter a whole number${range}.` };
    }
    parameters[field.key] = value;
  }
  return { ok: true, parameters };
}

/** The version the editor last read for this scope (0 when it has none), sent back so a newer change is not overwritten. */
export function expectedVersion(rule: AssistantRule): number {
  return rule.setting?.version ?? 0;
}

/** What a replay found, in one sentence the settings screen shows under "Try these values". */
export function replaySummary(replay: AssistantReplay, facilityName: string): string {
  const days = replay.days.length;
  const quiet = replay.days.filter((d) => d.suggestions === 0).length;
  if (replay.maxPerDay === 0) return `Over the last ${days} days at ${facilityName}, these values would not have shown anything.`;
  const average = replay.averagePerDay === 1 ? "1 suggestion" : `${replay.averagePerDay} suggestions`;
  const quietText = quiet === 0 ? "" : quiet === 1 ? ", and nothing on 1 day" : `, and nothing on ${quiet} days`;
  return `Over the last ${days} days at ${facilityName}, these values would have shown about ${average} a day (at most ${replay.maxPerDay}${quietText}). Each day was read at ${replay.readAt}.`;
}

// ---- insights and reviews (/admin/assistant/insights; docs/runbooks/assistant-rule-review.md) ------------------------

export const REVIEW_OUTCOME_LABEL: Record<AssistantReviewOutcome, string> = {
  keep: "Keep as it is",
  adjust: "Adjust its thresholds",
  retire: "Retire it",
};

/** Where a rule is on, in words: "Whole organization and 2 facilities", "1 facility", "Off". */
export function whereOn(enabled: AssistantRuleInsight["enabled"]): string {
  const facilities = enabled.facilities === 0 ? "" : `${enabled.facilities} ${enabled.facilities === 1 ? "facility" : "facilities"}`;
  if (enabled.organization) return facilities ? `Whole organization and ${facilities}` : "Whole organization";
  return facilities || "Off";
}

/** The latest review in one line: "Retired after review on 2026-11-21 (version 1)". */
export function reviewSummary(review: AssistantRuleReviewSummary | null, currentVersion: number): string {
  if (!review) return "Not reviewed yet";
  const verb = review.outcome === "retire" ? "Retired" : review.outcome === "adjust" ? "Adjusted" : "Kept";
  const older = review.ruleVersion < currentVersion ? `, an earlier version (${review.ruleVersion})` : "";
  return `${verb} after review on ${review.reviewedOn}${older}`;
}

/** Share of answers that were dismissals or "not useful", as a whole percent; null without answers. */
export function dismissedShare(rule: Pick<AssistantRuleInsight, "dismissed" | "notUseful" | "answered">): number | null {
  return rule.answered === 0 ? null : Math.round(((rule.dismissed + rule.notUseful) / rule.answered) * 100);
}

/** The order of the insights table: due for review first, then mostly dismissed, then rules on, then the rest, by title. */
export function insightsOrder(rules: readonly AssistantRuleInsight[]): AssistantRuleInsight[] {
  const rank = (r: AssistantRuleInsight) => (r.reviewDue ? 0 : r.reviewSuggested ? 1 : whereOn(r.enabled) !== "Off" ? 2 : 3);
  return [...rules].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}
