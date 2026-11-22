import { matchWords, type RuleDefinition, type Suggestion, suggestionId, wordsOf } from "@healthcare/core";
import { z } from "zod";

/**
 * Rule `clinic.code-suggestions` (docs/domains/assistant.md): for a diagnosis written without a code, or an assessment
 * with no diagnosis yet, the codes this organization has itself used whose descriptions share the most words with the
 * text. No code set is shipped and nothing is inferred: it is word matching against the organization's own past coding,
 * shown with the matching words, never applied. A code counts only after it was used at least `minUses` times, so a
 * one-off description typed for a single patient never appears.
 */

export const codeSuggestionsParameters = z.object({
  /** Share of a code's description words found in the text (percent) for it to be offered. */
  minCoveragePercent: z.number().int().min(30).max(100),
  /** Times the organization used the code before it is offered. */
  minUses: z.number().int().min(2).max(100),
  /** Days of past coding looked at. */
  lookbackDays: z.number().int().min(30).max(3650),
});
export type CodeSuggestionsParameters = z.infer<typeof codeSuggestionsParameters>;

export const CODE_SUGGESTIONS_RULE: RuleDefinition<CodeSuggestionsParameters> = {
  id: "clinic.code-suggestions",
  version: 1,
  domain: "clinic",
  title: "Codes your clinic has used for these words",
  description:
    "For a diagnosis written without a code, or an assessment with no diagnosis yet, shows the codes your organization has used whose descriptions share the most words with the text. Nothing is applied: you choose.",
  surfaces: ["encounter"],
  requires: ["encounter.read"],
  parametersSchema: codeSuggestionsParameters,
  defaultParameters: { minCoveragePercent: 60, minUses: 2, lookbackDays: 730 },
  parameterLabels: {
    minCoveragePercent: {
      label: "Offer a code when the text holds at least",
      unit: "% of its description's words",
      min: 30,
      max: 100,
      hint: "Higher means fewer, closer matches.",
    },
    minUses: { label: "Only codes used at least", unit: "times", min: 2, max: 100, hint: "A code used only once is never offered." },
    lookbackDays: { label: "Look at coding from the last", unit: "days", min: 30, max: 3650 },
  },
  reads:
    "The words of the consultation's diagnoses written without a code (or of its assessment), and the codes your organization used over the days you set, each with its most common description and how often it was used.",
  knownFalsePositives: [
    "Negations are not understood: small words such as “not” and “without” are ignored, so “without fever” still matches a code described as “Fever”.",
    "Common words shared with unrelated codes (“acute”, “pain”, “left”) can bring a close-looking but wrong code.",
    "A code your organization used wrongly before is offered again for the same words.",
  ],
  blindSpots: [
    "Codes your organization never used, or used fewer times than you set.",
    "Synonyms, abbreviations and misspellings do not match.",
    "The coding system's own list is not read.",
  ],
};

/** A code the organization used, with its most common description. */
export interface UsedCode {
  codeSystemKey: string;
  code: string;
  display: string;
  uses: number;
}

export interface CodeSuggestionTarget {
  /** `diagnosis:<id>` for an uncoded diagnosis, `assessment:<encounter id>` for the assessment. */
  key: string;
  kind: "diagnosis" | "assessment";
  text: string;
}

const MAX_CODES = 3;

export function codeSuggestions(targets: readonly CodeSuggestionTarget[], codes: readonly UsedCode[], params: CodeSuggestionsParameters): Suggestion[] {
  const usable = codes.filter((c) => c.uses >= params.minUses).map((c) => ({ ...c, words: wordsOf(c.display) }));
  const out: Suggestion[] = [];
  for (const target of targets) {
    const words = wordsOf(target.text);
    if (words.size === 0) continue;
    const ranked = usable
      .map((c) => ({ c, match: matchWords(words, c.words) }))
      .filter((m) => m.match.coverage * 100 >= params.minCoveragePercent && m.match.matched.length > 0)
      .sort((a, b) => b.match.coverage - a.match.coverage || b.match.matched.length - a.match.matched.length || b.c.uses - a.c.uses)
      .slice(0, MAX_CODES);
    if (ranked.length === 0) continue;
    const quoted = target.text.length > 60 ? `${target.text.slice(0, 57)}…` : target.text;
    out.push({
      id: suggestionId(CODE_SUGGESTIONS_RULE.id, CODE_SUGGESTIONS_RULE.version, target.key),
      ruleId: CODE_SUGGESTIONS_RULE.id,
      ruleVersion: CODE_SUGGESTIONS_RULE.version,
      surface: "encounter",
      severity: "info",
      title: target.kind === "diagnosis" ? `Codes your clinic used for “${quoted}”` : "Codes your clinic used for words in the assessment",
      rationale: "These codes' descriptions share words with what you wrote. It is word matching, not a diagnosis: pick one in Diagnoses only if it is right.",
      evidence: ranked.map((m) => ({
        label: `${m.c.code} ${m.c.display} (${m.c.codeSystemKey})`,
        resourceType: "diagnosis_code",
        resourceId: `${m.c.codeSystemKey}:${m.c.code}`,
        value: `used ${m.c.uses} times; matching words: ${m.match.matched.join(", ")}`,
      })),
      basis: "text-match",
      strength: ranked[0]!.match.coverage >= 0.8 ? "matched" : "weak",
      requires: [...CODE_SUGGESTIONS_RULE.requires],
    });
  }
  return out;
}
