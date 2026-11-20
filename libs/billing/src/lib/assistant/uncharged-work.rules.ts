import { type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";

/**
 * Rule `billing.uncharged-work` (docs/domains/assistant.md): clinic and dental procedures performed some hours ago that
 * have no charge, grouped by procedure code and the likely reason — no billing service is mapped to the code (which
 * may be deliberate), the service has no price on that day, or the charge was not captured. Counts and codes only:
 * never a patient. Pure: the procedures come from the clinical domains and their charge state from billing, composed
 * in the API.
 */

export const unchargedWorkParameters = z.object({
  /** Hours after a procedure before a missing charge counts (capture runs in the background). */
  delayHours: z.number().int().min(1).max(72),
  /** Days of procedures looked at. */
  lookbackDays: z.number().int().min(1).max(60),
});
export type UnchargedWorkParameters = z.infer<typeof unchargedWorkParameters>;

export const UNCHARGED_WORK_RULE: RuleDefinition<UnchargedWorkParameters> = {
  id: "billing.uncharged-work",
  version: 1,
  domain: "billing",
  title: "Procedures with no charge",
  description:
    "Finds clinic and dental procedures with no charge some hours after they were done, and says why: no billing service for the code, no price on that day, or not captured.",
  surfaces: ["billing"],
  requires: ["billing.charge.read"],
  parametersSchema: unchargedWorkParameters,
  defaultParameters: { delayHours: 2, lookbackDays: 14 },
  parameterLabels: {
    delayHours: { label: "Wait before flagging", unit: "hours", min: 1, max: 72, hint: "Charges are captured in the background, usually within minutes." },
    lookbackDays: { label: "Look at procedures from the last", unit: "days", min: 1, max: 60 },
  },
};

export type UnchargedKind = "clinic_procedure" | "dental_procedure";
export type UnchargedReason = "no_service" | "no_price" | "not_captured";

export interface UnchargedWorkInput {
  kind: UnchargedKind;
  sourceId: string;
  /** The procedure's code as the clinic wrote it (billing matches it without regard to case). */
  code: string;
  name: string;
  /** YYYY-MM-DD, the facility's day of the procedure. */
  serviceDate: string;
  charged: boolean;
  /** An active billing service is mapped to the code. */
  mapped: boolean;
  /** That service has a price on the service date. */
  priced: boolean;
}

const KIND_LABEL: Record<UnchargedKind, string> = { clinic_procedure: "clinic procedure", dental_procedure: "dental procedure" };

const REASON: Record<UnchargedReason, { why: string; severity: Suggestion["severity"]; action: { label: string; href: string } }> = {
  no_service: {
    why: "No billing service is mapped to this code, so nothing was charged. If the procedure is free on purpose, dismiss this.",
    severity: "advice",
    action: { label: "Open services and prices", href: "/billing/settings" },
  },
  no_price: {
    why: "A billing service is mapped to this code but has no price on the day it was done, so the charge was skipped.",
    severity: "warning",
    action: { label: "Open services and prices", href: "/billing/settings" },
  },
  not_captured: {
    why: "A priced service is mapped to this code, but no charge was recorded. Charge capture may have failed: add the charge by hand on the patient's billing page.",
    severity: "warning",
    action: { label: "Open the cashier's desk", href: "/billing" },
  },
};

export function unchargedReason(item: Pick<UnchargedWorkInput, "mapped" | "priced">): UnchargedReason {
  if (!item.mapped) return "no_service";
  if (!item.priced) return "no_price";
  return "not_captured";
}

export function unchargedWorkSuggestions(inputs: readonly UnchargedWorkInput[], params: UnchargedWorkParameters): Suggestion[] {
  const groups = new Map<string, { kind: UnchargedKind; code: string; name: string; reason: UnchargedReason; dates: string[] }>();
  for (const item of inputs) {
    if (item.charged) continue;
    const reason = unchargedReason(item);
    const key = `${item.kind}:${item.code}:${reason}`;
    const group = groups.get(key) ?? { kind: item.kind, code: item.code, name: item.name, reason, dates: [] };
    group.dates.push(item.serviceDate);
    groups.set(key, group);
  }
  const out: Suggestion[] = [];
  for (const [key, group] of groups) {
    const reason = REASON[group.reason];
    const dates = [...group.dates].sort();
    const count = dates.length;
    const span = dates[0] === dates[count - 1] ? dates[0]! : `${dates[0]} to ${dates[count - 1]}`;
    out.push({
      id: suggestionId(UNCHARGED_WORK_RULE.id, UNCHARGED_WORK_RULE.version, key),
      ruleId: UNCHARGED_WORK_RULE.id,
      ruleVersion: UNCHARGED_WORK_RULE.version,
      surface: "billing",
      severity: reason.severity,
      title: `${count} × ${group.name} (${group.code}) not charged`,
      rationale: reason.why,
      evidence: [
        { label: `${KIND_LABEL[group.kind]} code`, resourceType: group.kind, resourceId: group.code, value: group.code },
        { label: `Done in the last ${params.lookbackDays} days with no charge`, resourceType: group.kind, resourceId: group.code, value: `${count} (${span})` },
      ],
      basis: "rule",
      strength: "matched",
      requires: [...UNCHARGED_WORK_RULE.requires],
      action: reason.action,
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? a.title.localeCompare(b.title) : a.severity === "warning" ? -1 : 1));
}
