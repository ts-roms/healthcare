import { percentile, type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";

/**
 * Rule `clinic.queue-wait` (docs/domains/assistant.md): patients waiting to be called longer than this facility usually
 * takes for that visit type. "Usually" is a percentile of the waits from check-in (or the time a visit went back in line)
 * to the first call over the past weeks — the facility's own pattern, never a target or standard. It says nothing
 * about priority or who should be seen first: the queue's order is unchanged. The suggestion names counts, never a
 * patient.
 */

export const queueWaitParameters = z.object({
  /** Days of past visits that set the usual wait. */
  historyDays: z.number().int().min(7).max(90),
  /** Past visits of the visit type needed before a usual wait is worked out. */
  minVisits: z.number().int().min(5).max(500),
  /** The share of past waits (percent) that counts as usual. */
  percentile: z.number().int().min(50).max(99),
});
export type QueueWaitParameters = z.infer<typeof queueWaitParameters>;

export const QUEUE_WAIT_RULE: RuleDefinition<QueueWaitParameters> = {
  id: "clinic.queue-wait",
  version: 1,
  domain: "clinic",
  title: "Patients are waiting longer than usual",
  description:
    "Compares how long patients have been waiting to be called with this facility's usual waits for the same visit type over the past weeks. It never changes the order of the queue.",
  surfaces: ["queue"],
  requires: ["clinic.queue.read"],
  parametersSchema: queueWaitParameters,
  defaultParameters: { historyDays: 28, minVisits: 20, percentile: 90 },
  parameterLabels: {
    percentile: {
      label: "Usual means within the wait of",
      unit: "% of past visits",
      min: 50,
      max: 99,
      hint: "90 flags a wait longer than 9 in 10 past waits.",
    },
    historyDays: { label: "Usual waits from the last", unit: "days", min: 7, max: 90 },
    minVisits: { label: "Past visits needed", unit: "visits", min: 5, max: 500, hint: "Visit types with fewer past visits are never flagged." },
  },
};

export interface QueueWaitInput {
  visitTypeId: string;
  visitTypeName: string;
  /** Minutes from joining the line to the first call, of past visits. */
  pastWaits: number[];
  /** Minutes waited so far by each visit still waiting to be called. */
  waitingNow: number[];
}

export function queueWaitSuggestions(inputs: readonly QueueWaitInput[], params: QueueWaitParameters, date: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const type of inputs) {
    const usual = percentile(type.pastWaits, params.percentile, params.minVisits);
    if (usual === null) continue;
    const limit = Math.max(1, Math.round(usual));
    const over = type.waitingNow.filter((m) => m > limit);
    if (over.length === 0) continue;
    const longest = Math.round(Math.max(...over));
    const share = params.percentile >= 90 ? `${Math.round(params.percentile / 10)} in 10` : `${params.percentile}%`;
    out.push({
      id: suggestionId(QUEUE_WAIT_RULE.id, QUEUE_WAIT_RULE.version, `visit-type:${type.visitTypeId}:${date}`),
      ruleId: QUEUE_WAIT_RULE.id,
      ruleVersion: QUEUE_WAIT_RULE.version,
      surface: "queue",
      severity: longest > limit * 2 ? "warning" : "advice",
      title: `${type.visitTypeName}: ${over.length} ${over.length === 1 ? "patient has" : "patients have"} waited longer than usual`,
      rationale:
        `Here, ${share} patients for ${type.visitTypeName} are called within ${limit} minutes. The longest is at ${longest} minutes. ` +
        `Consider calling them, telling them about the delay, or sending them to another service point.`,
      evidence: [
        {
          label: `Usual wait (${params.percentile}% of ${type.pastWaits.length} visits in ${params.historyDays} days)`,
          resourceType: "visit_type",
          resourceId: type.visitTypeId,
          value: `${limit} min`,
        },
        { label: "Waiting longer now", resourceType: "visit_type", resourceId: type.visitTypeId, value: `${over.length}, longest ${longest} min` },
      ],
      basis: "statistic",
      strength: type.pastWaits.length >= params.minVisits * 2 ? "matched" : "weak",
      requires: [...QUEUE_WAIT_RULE.requires],
      // Shown on the queue itself: no link to the page the reader is already on.
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? a.title.localeCompare(b.title) : a.severity === "warning" ? -1 : 1));
}
