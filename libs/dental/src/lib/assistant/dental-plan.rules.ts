import { localDate, type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";
import { toothInNotation } from "../dental.rules";
import type { ChartEffect, Notation, ToothCondition } from "../dental.schema";

/**
 * The dental assistant's rules (docs/domains/assistant.md, phase 3), on the patient's dental record: treatment plan items
 * the chart says cannot be carried out as planned, and items still waiting for the patient's decision. They read the
 * current chart (its latest state per tooth) and the open plans; they change neither.
 */

export interface DentalPlanItemInput {
  itemId: string;
  procedureName: string;
  chartEffect: ChartEffect | null;
  /** FDI, as stored; shown in the facility's notation. */
  tooth: string | null;
  status: "proposed" | "accepted";
  /** ISO instant the item was added to the plan. */
  createdAt: string;
}

export interface DentalPlanInput {
  patientId: string;
  notation: Notation;
  /** Each charted tooth's current conditions, and since when (ISO). */
  chart: Array<{ tooth: string; conditions: ToothCondition[]; recordedAt: string }>;
  /** The patient's plans not closed (proposed, accepted, in progress), with their items still to do. */
  plans: Array<{ planId: string; title: string; items: DentalPlanItemInput[] }>;
}

const REQUIRES = ["dental.record.read"] as const;

// ---- dental.chart-consistency ----------------------------------------------------------------------------------------

/** No thresholds: a conflict between the plan and the chart is there or not. */
export const chartConsistencyParameters = z.object({});
export type ChartConsistencyParameters = z.infer<typeof chartConsistencyParameters>;

export const CHART_CONSISTENCY_RULE: RuleDefinition<ChartConsistencyParameters> = {
  id: "dental.chart-consistency",
  version: 1,
  domain: "dental",
  title: "Planned work the chart says cannot be done",
  description:
    "A treatment plan item still to do whose procedure works on the tooth itself (a restoration, sealant, root canal, crown or extraction) while the chart shows that tooth missing, replaced by a pontic or an implant, impacted or not erupted. The chart or the plan may need correcting; it changes neither.",
  surfaces: ["dental"],
  requires: [...REQUIRES],
  parametersSchema: chartConsistencyParameters,
  defaultParameters: {},
  parameterLabels: {},
  reads:
    "The patient's open treatment plans (items still to do: procedure, its chart effect, tooth and status) and the chart's latest state of each tooth and since when. Never notes, images or fees.",
  knownFalsePositives: [
    "A tooth charted missing, impacted or not erupted by mistake: the item looks impossible until the chart is corrected.",
    "A chart not updated since the tooth changed, such as a tooth that has erupted since: the item looks impossible until a new examination charts it.",
  ],
  blindSpots: [
    "Items without a tooth, and procedures without a chart effect in your catalogue.",
    "Other conflicts, such as a filling planned on a crowned tooth.",
    "Teeth never charted.",
  ],
};

const ON_ABSENT_TOOTH: ReadonlySet<ChartEffect> = new Set(["restoration", "sealant", "root_canal", "crown", "missing"]);
const ON_IMPLANT: ReadonlySet<ChartEffect> = new Set(["restoration", "sealant", "root_canal"]);
const ON_UNERUPTED: ReadonlySet<ChartEffect> = new Set(["restoration", "sealant", "root_canal", "crown"]);

/** Why a planned chart effect cannot be carried out on a tooth in these conditions, in words; null when it can. */
export function planChartConflict(effect: ChartEffect | null, conditions: readonly ToothCondition[]): string | null {
  if (!effect) return null;
  const has = (c: ToothCondition) => conditions.includes(c);
  if (has("missing")) return ON_ABSENT_TOOTH.has(effect) ? "missing" : null;
  if (has("pontic")) return ON_ABSENT_TOOTH.has(effect) ? "replaced by a bridge pontic" : null;
  if (has("implant")) return ON_IMPLANT.has(effect) ? "an implant" : null;
  if (has("impacted")) return ON_UNERUPTED.has(effect) ? "impacted" : null;
  if (has("unerupted")) return ON_UNERUPTED.has(effect) ? "not erupted" : null;
  return null;
}

export function chartConsistencySuggestions(input: DentalPlanInput, timeZone: string): Suggestion[] {
  const chart = new Map(input.chart.map((t) => [t.tooth, t]));
  const out: Suggestion[] = [];
  for (const plan of input.plans) {
    for (const item of plan.items) {
      if (!item.tooth) continue;
      const tooth = chart.get(item.tooth);
      const why = tooth ? planChartConflict(item.chartEffect, tooth.conditions) : null;
      if (!tooth || !why) continue;
      const label = toothInNotation(item.tooth, input.notation);
      const since = localDate(new Date(tooth.recordedAt), timeZone);
      out.push({
        id: suggestionId(CHART_CONSISTENCY_RULE.id, CHART_CONSISTENCY_RULE.version, `item:${item.itemId}`),
        ruleId: CHART_CONSISTENCY_RULE.id,
        ruleVersion: CHART_CONSISTENCY_RULE.version,
        surface: "dental",
        severity: "warning",
        title: `${item.procedureName} is planned on tooth ${label}, which the chart shows as ${why}`,
        rationale: `The chart has shown tooth ${label} as ${why} since ${since}, so this item of the plan “${plan.title}” cannot be carried out as planned. Check the tooth, then correct the chart or change or cancel the plan item.`,
        evidence: [
          {
            label: `Plan “${plan.title}”`,
            resourceType: "dental_treatment_plan_item",
            resourceId: item.itemId,
            value: `${item.procedureName}, tooth ${label} (${item.status})`,
          },
          { label: `Tooth ${label} on the chart`, resourceType: "dental_tooth_state", resourceId: item.tooth, value: `${why} since ${since}` },
        ],
        basis: "rule",
        strength: "matched",
        requires: [...CHART_CONSISTENCY_RULE.requires],
      });
    }
  }
  return out;
}

// ---- dental.plan-decisions -------------------------------------------------------------------------------------------

export const planDecisionsParameters = z.object({
  /** Items still proposed this many days after they were added are pointed out. */
  afterDays: z.number().int().min(3).max(365),
});
export type PlanDecisionsParameters = z.infer<typeof planDecisionsParameters>;

export const PLAN_DECISIONS_RULE: RuleDefinition<PlanDecisionsParameters> = {
  id: "dental.plan-decisions",
  version: 1,
  domain: "dental",
  title: "Treatment plan items waiting for the patient's decision",
  description:
    "Items of an open treatment plan still proposed, neither accepted nor declined, some days after they were added: a reminder to ask the patient and record the decision. It changes nothing.",
  surfaces: ["dental"],
  requires: [...REQUIRES],
  parametersSchema: planDecisionsParameters,
  defaultParameters: { afterDays: 30 },
  parameterLabels: {
    afterDays: { label: "Remind after", unit: "days without a decision", min: 3, max: 365 },
  },
  reads: "The patient's open treatment plans: the items still proposed and when each was added.",
  knownFalsePositives: [
    "Staged treatment, where later items stay proposed on purpose until earlier ones are done.",
    "A decision the patient made that nobody recorded on the plan: record it and the reminder stops.",
  ],
  blindSpots: ["Accepted items not carried out for a long time.", "Plans that are closed."],
};

export function planDecisionSuggestions(input: DentalPlanInput, params: PlanDecisionsParameters, asOf: string, timeZone: string): Suggestion[] {
  const now = Date.parse(asOf);
  const out: Suggestion[] = [];
  for (const plan of input.plans) {
    const waiting = plan.items
      .filter((i) => i.status === "proposed" && now - Date.parse(i.createdAt) >= params.afterDays * 86_400_000)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const oldest = waiting[0];
    if (!oldest) continue;
    const days = Math.floor((now - Date.parse(oldest.createdAt)) / 86_400_000);
    const what = (i: DentalPlanItemInput) => `${i.procedureName}${i.tooth ? `, tooth ${toothInNotation(i.tooth, input.notation)}` : ""}`;
    out.push({
      id: suggestionId(PLAN_DECISIONS_RULE.id, PLAN_DECISIONS_RULE.version, `plan:${plan.planId}`),
      ruleId: PLAN_DECISIONS_RULE.id,
      ruleVersion: PLAN_DECISIONS_RULE.version,
      surface: "dental",
      severity: "advice",
      title: `“${plan.title}”: ${waiting.length} item${waiting.length === 1 ? "" : "s"} waiting for the patient's decision for ${days} days`,
      rationale:
        "Ask the patient whether to go ahead, and record the decision on the plan (accepted or declined); nothing is booked or charged for these items until then.",
      evidence: waiting.slice(0, 10).map((i) => ({
        label: what(i),
        resourceType: "dental_treatment_plan_item",
        resourceId: i.itemId,
        value: `proposed ${localDate(new Date(i.createdAt), timeZone)}`,
      })),
      basis: "rule",
      strength: "matched",
      requires: [...PLAN_DECISIONS_RULE.requires],
    });
  }
  return out;
}
