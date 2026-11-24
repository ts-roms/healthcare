import { type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";
import type { ComplianceArea, ComplianceOutcome } from "../compliance/compliance.schema";

/**
 * Rule `admin.compliance-gaps` (docs/domains/assistant.md): compliance areas whose configuration nobody has recorded
 * validating, whose last review is older than the organization's interval, or whose last review found changes needed
 * (`compliance_review`, docs/architecture/compliance-configuration.md). It says nothing about whether the configuration
 * is right — only that no one has said so recently. Not every area applies to every organization: dismiss those.
 */

export const complianceGapsParameters = z.object({
  /** Months after which a review counts as old. */
  maxMonths: z.number().int().min(1).max(60),
});
export type ComplianceGapsParameters = z.infer<typeof complianceGapsParameters>;

export const COMPLIANCE_GAPS_RULE: RuleDefinition<ComplianceGapsParameters> = {
  id: "admin.compliance-gaps",
  version: 1,
  domain: "organization",
  title: "Compliance areas to review",
  description:
    "Lists compliance areas nobody has recorded validating, whose last review is old, or whose last review found changes needed. It does not judge the configuration.",
  surfaces: ["settings"],
  requires: ["compliance.review.manage"],
  parametersSchema: complianceGapsParameters,
  defaultParameters: { maxMonths: 12 },
  parameterLabels: {
    maxMonths: { label: "A review is old after", unit: "months", min: 1, max: 60 },
  },
  reads: "Your organization's compliance reviews: for each area, the date and outcome of the latest one.",
  knownFalsePositives: [
    "Areas that do not apply to your organization, such as dental written estimates without dentistry: dismiss them.",
    "A review done on paper but not recorded under Settings → Compliance.",
  ],
  blindSpots: ["Whether the configuration is right: it only says whether someone recorded checking it.", "Rules outside the platform's compliance areas."],
};

/** How the settings screen names each area (the staff app's Compliance page uses the same words). */
export const COMPLIANCE_AREA_NAME: Record<ComplianceArea, string> = {
  billing_tax: "Billing tax and documents",
  procurement: "Procurement and withholding",
  controlled_drugs: "Controlled drugs",
  laboratory_licensing: "Laboratory licensing",
  doh_reporting: "DOH reporting",
  data_privacy: "Data privacy",
  dental_estimates: "Dental written estimates",
  patient_results: "Results shown to patients",
};

export interface ComplianceAreaState {
  area: ComplianceArea;
  /** The latest review, if any (YYYY-MM-DD). */
  last: { reviewedOn: string; outcome: ComplianceOutcome } | null;
}

/** A short, stable fingerprint of a text (FNV-1a, 32 bits): the subject key stays well within its length limit. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Months between two YYYY-MM-DD dates, counting whole months. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

export function complianceGapsSuggestions(areas: readonly ComplianceAreaState[], params: ComplianceGapsParameters, today: string): Suggestion[] {
  const never = areas.filter((a) => !a.last);
  const changes = areas.filter((a) => a.last?.outcome === "changes_needed");
  const old = areas.filter((a) => a.last && a.last.outcome !== "changes_needed" && monthsBetween(a.last.reviewedOn, today) >= params.maxMonths);
  const total = never.length + changes.length + old.length;
  if (total === 0) return [];
  const parts = [
    changes.length ? `${changes.length} found changes needed` : "",
    never.length ? `${never.length} never reviewed` : "",
    old.length ? `${old.length} last reviewed over ${params.maxMonths} months ago` : "",
  ].filter(Boolean);
  const evidence = [
    ...changes.map((a) => ({
      label: COMPLIANCE_AREA_NAME[a.area],
      resourceType: "compliance_area",
      resourceId: a.area,
      value: `changes needed (${a.last!.reviewedOn})`,
    })),
    ...never.map((a) => ({ label: COMPLIANCE_AREA_NAME[a.area], resourceType: "compliance_area", resourceId: a.area, value: "never reviewed" })),
    ...old.map((a) => ({
      label: COMPLIANCE_AREA_NAME[a.area],
      resourceType: "compliance_area",
      resourceId: a.area,
      value: `last reviewed ${a.last!.reviewedOn}`,
    })),
  ];
  return [
    {
      // The id follows the gaps: a dismissal holds until they change.
      id: suggestionId(
        COMPLIANCE_GAPS_RULE.id,
        COMPLIANCE_GAPS_RULE.version,
        `areas:${fingerprint(evidence.map((e) => `${e.resourceId}=${e.value}`).join("|"))}`,
      ),
      ruleId: COMPLIANCE_GAPS_RULE.id,
      ruleVersion: COMPLIANCE_GAPS_RULE.version,
      surface: "settings",
      severity: changes.length ? "warning" : "advice",
      title: `${total} compliance ${total === 1 ? "area" : "areas"} to review: ${parts.join(", ")}`,
      rationale:
        "Record who validated each area's configuration against current official requirements. Areas that do not apply to your organization can be dismissed.",
      evidence,
      basis: "rule",
      strength: "matched",
      requires: [...COMPLIANCE_GAPS_RULE.requires],
      action: { label: "Open Compliance", href: "/admin/compliance" },
    },
  ];
}
