import { type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";

/**
 * Rule `laboratory.delta-check` (docs/domains/assistant.md): a numeric result waiting to be verified, approved or
 * released that differs from the same patient's last released result of the same test (same unit) by more than the
 * organization's percentage. A change may be real; it may also be a mislabelled specimen or an entry error. The
 * suggestion asks for a second look, names the order (never the patient) and changes nothing: the result workflow and
 * its flags are untouched. Thresholds are the organization's own; no test-specific limits are shipped.
 */

export const deltaCheckParameters = z.object({
  /** Change from the last released value (percent) from which a result is flagged. */
  percent: z.number().int().min(10).max(500),
  /** How far back the last released result may be. */
  lookbackDays: z.number().int().min(7).max(1825),
});
export type DeltaCheckParameters = z.infer<typeof deltaCheckParameters>;

export const DELTA_CHECK_RULE: RuleDefinition<DeltaCheckParameters> = {
  id: "laboratory.delta-check",
  version: 1,
  domain: "laboratory",
  title: "A result differs sharply from the patient's last one",
  description:
    "Compares numeric results waiting for verification, approval or release with the same patient's last released result of the same test, and asks for a second look when the change is large. It changes no result.",
  surfaces: ["laboratory"],
  requires: ["lab.result.read"],
  parametersSchema: deltaCheckParameters,
  defaultParameters: { percent: 50, lookbackDays: 365 },
  parameterLabels: {
    percent: { label: "Flag a change from the last released result of", unit: "% or more", min: 10, max: 500 },
    lookbackDays: { label: "Compare with a result released within the last", unit: "days", min: 7, max: 1825 },
  },
  reads:
    "Numeric results waiting for verification, approval or release at the facility, and the same patient's last released result of the same test in the same unit within the days you set. Only the order number is shown.",
  knownFalsePositives: [
    "A real change the care explains: after treatment, a transfusion or a procedure.",
    "Results near zero, where a small change is a large percentage.",
    "A test measured with another method or specimen type but reported in the same unit.",
  ],
  blindSpots: [
    "A previous result in another unit or of zero, and text or coded results.",
    "Results from other laboratories, including outside results filed on the record.",
    "One percentage for every test: a change that matters for a test but stays under it.",
  ],
};

export type PendingStage = "entered" | "verified" | "approved";

export interface DeltaCheckInput {
  resultId: string;
  orderNumber: string;
  testName: string;
  unit: string | null;
  value: number;
  stage: PendingStage;
  previous: { value: number; unit: string | null; releasedAt: string } | null;
}

const NEXT_STAGE: Record<PendingStage, { stage: string; label: string }> = {
  entered: { stage: "verify", label: "Open the Verify worklist" },
  verified: { stage: "approve", label: "Open the Approve worklist" },
  approved: { stage: "release", label: "Open the Release worklist" },
};

/** The change from `previous` in percent (signed); null when it cannot be expressed (a previous value of zero). */
export function percentChange(value: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((value - previous) / Math.abs(previous)) * 100;
}

export function deltaCheckSuggestions(inputs: readonly DeltaCheckInput[], params: DeltaCheckParameters): Suggestion[] {
  const out: Suggestion[] = [];
  for (const r of inputs) {
    if (!r.previous || (r.previous.unit ?? "") !== (r.unit ?? "")) continue;
    const change = percentChange(r.value, r.previous.value);
    if (change === null || Math.abs(change) < params.percent) continue;
    const unit = r.unit ? ` ${r.unit}` : "";
    const signed = `${change > 0 ? "+" : "−"}${Math.round(Math.abs(change))}%`;
    const released = r.previous.releasedAt.slice(0, 10);
    const next = NEXT_STAGE[r.stage];
    out.push({
      id: suggestionId(DELTA_CHECK_RULE.id, DELTA_CHECK_RULE.version, `result:${r.resultId}`),
      ruleId: DELTA_CHECK_RULE.id,
      ruleVersion: DELTA_CHECK_RULE.version,
      surface: "laboratory",
      severity: Math.abs(change) >= params.percent * 2 ? "warning" : "advice",
      title: `${r.testName}, order ${r.orderNumber}: ${r.value}${unit} (${signed} from the last released ${r.previous.value}${unit})`,
      rationale:
        "The change from this patient's last released result is large. Before signing it off, consider checking the specimen's labelling and the entry, " +
        "and whether a repeat is needed. A real change stays as it is.",
      evidence: [
        { label: "This result", resourceType: "lab_result", resourceId: r.resultId, value: `${r.value}${unit}` },
        { label: `Last released (${released})`, resourceType: "lab_result", resourceId: r.resultId, value: `${r.previous.value}${unit}` },
        { label: "Change", resourceType: "lab_result", resourceId: r.resultId, value: signed },
      ],
      basis: "rule",
      strength: "matched",
      requires: [...DELTA_CHECK_RULE.requires],
      action: { label: next.label, href: `/laboratory/worklist?stage=${next.stage}` },
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? a.title.localeCompare(b.title) : a.severity === "warning" ? -1 : 1));
}
