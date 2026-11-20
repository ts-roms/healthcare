import type { AssistantRule } from "./api/types";

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
