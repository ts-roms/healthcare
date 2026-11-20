import type { z } from "zod";
import type { Permission } from "../access/permissions";

/**
 * The heuristic assistant's vocabulary (docs/architecture/heuristic-assistant.md, ADR-0018). A suggestion is decision
 * support: produced by a named, versioned rule from records the caller may read, with the evidence that led to it. It
 * never writes anything; its only action is a link to the screen that does the work.
 */

export const SUGGESTION_SURFACES = ["inventory"] as const;
/** Where a suggestion is shown. Grows with each phase; a new surface is a code change, not data. */
export type SuggestionSurface = (typeof SUGGESTION_SURFACES)[number];

export type SuggestionSeverity = "info" | "advice" | "warning";
/** How the rule got there. */
export type SuggestionBasis = "rule" | "statistic" | "text-match";
/** `matched`: the rule's condition held on enough data. `weak`: it held on little data; shown as such, never as a percentage. */
export type SuggestionStrength = "matched" | "weak";

export interface SuggestionEvidence {
  label: string;
  resourceType: string;
  resourceId: string;
  /** Short display value (a quantity, a rate). Only filled when the caller may read the source. */
  value?: string;
}

export interface Suggestion {
  /** `ruleId@version:subjectKey`: stable, so a dismissal of the same finding stays dismissed. */
  id: string;
  ruleId: string;
  ruleVersion: number;
  surface: SuggestionSurface;
  severity: SuggestionSeverity;
  title: string;
  /** One or two plain sentences saying why. */
  rationale: string;
  /** Never empty: no evidence, no suggestion. */
  evidence: SuggestionEvidence[];
  basis: SuggestionBasis;
  strength: SuggestionStrength;
  /** Permissions needed to see it (the rule's own; shown so a reader knows why others do not see it). */
  requires: Permission[];
  /** A link to an existing screen. The assistant never executes anything. */
  action?: { label: string; href: string };
  /** ISO instant after which the finding is stale. */
  expiresAt?: string;
}

/** What a rule is, independent of how its inputs are loaded. Rules are off until an organization turns them on. */
export interface RuleDefinition<Params> {
  id: string;
  /** Raised when the rule's logic or its parameters' meaning changes; dismissals are per version. */
  version: number;
  domain: string;
  title: string;
  description: string;
  surfaces: readonly SuggestionSurface[];
  /** Permissions a caller needs to be shown this rule's suggestions. */
  requires: readonly Permission[];
  parametersSchema: z.ZodType<Params>;
  /** The values offered when an administrator turns the rule on. They are a starting point, never clinical fact. */
  defaultParameters: Params;
  /** How the settings screen names each parameter, in the order it shows them. */
  parameterLabels: { [K in keyof Params]: RuleParameterLabel };
}

export interface RuleParameterLabel {
  label: string;
  /** The unit after the field ("days", "issues"). */
  unit?: string;
  /** One sentence on what changing it does. */
  hint?: string;
  /** The range the schema accepts, shown and used as the field's bounds. */
  min?: number;
  max?: number;
}

export function suggestionId(ruleId: string, ruleVersion: number, subjectKey: string): string {
  return `${ruleId}@${ruleVersion}:${subjectKey}`;
}

/** Splits an id made by `suggestionId`; null when it is not one. */
export function parseSuggestionId(id: string): { ruleId: string; ruleVersion: number; subjectKey: string } | null {
  const match = /^([a-z0-9.-]+)@(\d+):(.+)$/.exec(id);
  return match ? { ruleId: match[1]!, ruleVersion: Number(match[2]), subjectKey: match[3]! } : null;
}
