import { localDate, type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";
import { type OrderSetCandidate, orderSetReason } from "./order-sets.rules";

/**
 * `laboratory.monitoring-gap` (docs/domains/assistant.md, phase 3 — "a gap between a diagnosis and a configured monitoring
 * test"): in a consultation, a diagnosis marked chronic on the patient's record for some time (the long-term part of the
 * problem list) whose tests, as one of the organization's own order sets lists them for that diagnosis, have not been
 * released for the patient for months. The order sets are the configuration: no guideline or monitoring interval is built
 * in. Clinical decision support: nothing is ordered until the doctor does; the link opens the lab order form with the set
 * chosen.
 */

export const monitoringGapParameters = z.object({
  /** A test counts as not done when the patient has no released result of it in this many months. */
  monitorMonths: z.number().int().min(1).max(36),
  /** Only chronic diagnoses first recorded at least this many days ago (a new diagnosis is the order sets rule's). */
  establishedDays: z.number().int().min(0).max(730),
});
export type MonitoringGapParameters = z.infer<typeof monitoringGapParameters>;

export const MONITORING_GAP_RULE: RuleDefinition<MonitoringGapParameters> = {
  id: "laboratory.monitoring-gap",
  version: 1,
  domain: "laboratory",
  title: "Monitoring tests not done for a chronic condition",
  description:
    "In a consultation in progress: for a diagnosis marked chronic on the patient's record for some time, the tests one of your organization's order sets lists for it that have no released result for the patient in the months you set. The order sets are your own; nothing is ordered until the doctor does.",
  surfaces: ["encounter"],
  requires: ["encounter.read", "lab.result.read", "lab.order.create"],
  parametersSchema: monitoringGapParameters,
  defaultParameters: { monitorMonths: 12, establishedDays: 90 },
  parameterLabels: {
    monitorMonths: { label: "A test is due when it has no released result in", unit: "months", min: 1, max: 36 },
    establishedDays: {
      label: "Only for chronic diagnoses first recorded at least",
      unit: "days ago",
      min: 0,
      max: 730,
      hint: "A new diagnosis is offered its order set by the order sets rule instead.",
    },
  },
  reads:
    "In the consultation: the patient's coded diagnoses marked chronic and when each was first recorded (records linked to theirs included), when each test of the matching order sets was last released for the patient, and the tests ordered in the consultation. Never a result value or a note.",
  knownFalsePositives: [
    "Tests done at another laboratory, including outside results filed on the record.",
    "A test ordered in an earlier consultation and still waiting for its result counts as not done.",
    "Monitoring stopped on purpose for a diagnosis still marked chronic.",
    "One number of months for every set: a test needed less often is pointed out too early.",
  ],
  blindSpots: ["Diagnoses not marked chronic or not coded, and diagnoses no order set lists.", "A panel counts as done when any of its tests was released."],
};

export interface MonitoringInput {
  encounterId: string;
  /** ISO instant the check reads at. */
  asOf: string;
  timeZone: string;
  /** The patient's active coded diagnoses marked chronic by the moment (records linked to theirs included), first recorded when. */
  problems: Array<{ codeSystemKey: string | null; code: string; firstRecordedAt: string }>;
  /** The organization's active order sets. */
  sets: OrderSetCandidate[];
  /** The patient's latest release of each test, before the moment (ISO). */
  lastReleased: Array<{ testId: string; releasedAt: string }>;
  /** Tests already ordered in this consultation. */
  orderedTestIds: string[];
}

export function monitoringGapSuggestions(input: MonitoringInput, params: MonitoringGapParameters): Suggestion[] {
  const now = Date.parse(input.asOf);
  const established = input.problems
    .filter((p) => now - Date.parse(p.firstRecordedAt) >= params.establishedDays * 86_400_000)
    .sort((a, b) => a.firstRecordedAt.localeCompare(b.firstRecordedAt));
  const released = new Map(input.lastReleased.map((r) => [r.testId, Date.parse(r.releasedAt)]));
  const ordered = new Set(input.orderedTestIds);
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - params.monitorMonths);
  const day = (ms: number) => localDate(new Date(ms), input.timeZone);
  const out: Suggestion[] = [];
  for (const set of input.sets) {
    if (!set.triggers.some((t) => t.kind === "diagnosis_code")) continue;
    const problem = established.find((p) => orderSetReason(set, { encounterId: input.encounterId, visitTypeCode: null, diagnoses: [p], orderedTestIds: [] }));
    if (!problem) continue;
    const due = set.items
      .filter((item) => item.testIds.length > 0 && !item.testIds.some((id) => ordered.has(id)))
      .map((item) => {
        const latest = Math.max(...item.testIds.map((id) => released.get(id) ?? Number.NEGATIVE_INFINITY));
        return { item, latest: Number.isFinite(latest) ? latest : null };
      })
      .filter((d) => d.latest === null || d.latest < cutoff.getTime());
    if (due.length === 0) continue;
    const names = due.length <= 2 ? due.map((d) => d.item.name).join(" and ") : `${due.length} of its tests`;
    out.push({
      id: suggestionId(MONITORING_GAP_RULE.id, MONITORING_GAP_RULE.version, `encounter:${input.encounterId}:set:${set.id}`),
      ruleId: MONITORING_GAP_RULE.id,
      ruleVersion: MONITORING_GAP_RULE.version,
      surface: "encounter",
      severity: "advice",
      title: `${set.name}: ${names} not released in ${params.monitorMonths} months (${problem.code})`,
      rationale:
        `${problem.code}, marked chronic, has been on the patient's record since ${day(Date.parse(problem.firstRecordedAt))}, and your organization's order set “${set.name}” lists these tests for it; the patient has no released result of them in ${params.monitorMonths} months. ` +
        "Its link opens the lab order form with the set's tests chosen; check each one before ordering.",
      evidence: due.map((d) => ({
        label: d.item.name,
        resourceType: "lab_order_set",
        resourceId: set.id,
        value: d.latest === null ? "no released result here" : `last released ${day(d.latest)}`,
      })),
      basis: "rule",
      strength: "matched",
      requires: [...MONITORING_GAP_RULE.requires],
      action: { label: "Open in the lab order form", href: `/clinic/encounters/${input.encounterId}?orderSet=${set.id}#lab-orders` },
    });
  }
  return out;
}
