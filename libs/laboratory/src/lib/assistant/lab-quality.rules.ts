import { localDate, mean, type RuleDefinition, type Suggestion, suggestionId } from "@healthcare/core";
import { z } from "zod";

/**
 * The laboratory's timing and quality rules (docs/domains/assistant.md, phase 3 of the assistant): on the workbench,
 * orders whose turnaround is at risk; on the QC page, control values drifting or shifted from their target and specimen
 * rejections concentrated on one collector or one facility. They read times, z-scores and counts — never a patient, a
 * result value or the free-text reason a specimen was rejected — and change nothing: no run is rejected, no order moved.
 */

/** Minutes in words: "45 min", "2 h 10 min", "3 days 4 h". */
export function durationWords(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) {
    const hours = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(m / 1440);
  const hours = Math.round((m % 1440) / 60);
  return hours ? `${days} days ${hours} h` : `${days} days`;
}

const percent = (part: number, whole: number): string => `${whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10}%`;
const signed = (z: number): string => `${z >= 0 ? "+" : "−"}${Math.abs(Math.round(z * 10) / 10).toFixed(1)}`;

// ---- laboratory.turnaround-risk --------------------------------------------------------------------------------------

export const turnaroundRiskParameters = z.object({
  /** Days of first releases the usual turnaround is worked out from (and how far back open orders are read). */
  lookbackDays: z.number().int().min(7).max(180),
  /** Releases of a test needed to use its own usual time; below, the catalog's target is used, if any. */
  minReleases: z.number().int().min(5).max(1000),
  /** At risk past the usual time plus this share of it. */
  marginPercent: z.number().int().min(0).max(300),
});
export type TurnaroundRiskParameters = z.infer<typeof turnaroundRiskParameters>;

export const TURNAROUND_RISK_RULE: RuleDefinition<TurnaroundRiskParameters> = {
  id: "laboratory.turnaround-risk",
  version: 1,
  domain: "laboratory",
  title: "Orders past their usual turnaround",
  description:
    "Tests collected but not yet released whose time since collection is past this facility's usual turnaround for the test (the median of its recent releases, STAT orders apart, plus a margin), or the catalog's target when there are too few releases. Grouped by test, with the stage each waits at. It changes nothing.",
  surfaces: ["laboratory"],
  requires: ["lab.order.read"],
  parametersSchema: turnaroundRiskParameters,
  defaultParameters: { lookbackDays: 60, minReleases: 20, marginPercent: 25 },
  parameterLabels: {
    marginPercent: { label: "At risk past the usual turnaround plus", unit: "%", min: 0, max: 300 },
    lookbackDays: { label: "Work out the usual turnaround from the last", unit: "days of releases", min: 7, max: 180 },
    minReleases: {
      label: "Use a test's own turnaround from",
      unit: "releases",
      min: 5,
      max: 1000,
      hint: "With fewer, the catalog's turnaround target is used; a test with neither is not checked.",
    },
  },
};

/** Where an open order item waits, as the worklist names its stages. */
export type OpenStage = "receive" | "enter" | "verify" | "approve" | "release";

const STAGE_WORDS: Record<OpenStage, string> = {
  receive: "waiting to be received",
  enter: "waiting for a result",
  verify: "waiting for verification",
  approve: "waiting for approval",
  release: "waiting for release",
};
const STAGE_ORDER: OpenStage[] = ["receive", "enter", "verify", "approve", "release"];

export interface OpenLabItem {
  orderItemId: string;
  orderNumber: string;
  testId: string;
  testName: string;
  stat: boolean;
  /** ISO instant the specimen was collected. */
  collectedAt: string;
  stage: OpenStage;
}

/** A test's median collection-to-release time at the facility; `stat` null for every priority together. */
export interface UsualTurnaround {
  testId: string;
  stat: boolean | null;
  medianMinutes: number;
  releases: number;
}

export interface TurnaroundInput {
  items: OpenLabItem[];
  usual: UsualTurnaround[];
  /** The catalog's turnaround target of the tests that have one. */
  targets: Array<{ testId: string; minutes: number }>;
}

/** What an open item is measured against: its test's usual time (STAT apart, plus the margin), else the catalog target. */
export function turnaroundLimit(
  item: Pick<OpenLabItem, "testId" | "stat">,
  input: Pick<TurnaroundInput, "usual" | "targets">,
  params: TurnaroundRiskParameters,
): { minutes: number; basis: "statistic" | "rule"; text: string } | null {
  const own =
    input.usual.find((u) => u.testId === item.testId && u.stat === item.stat && u.releases >= params.minReleases) ??
    input.usual.find((u) => u.testId === item.testId && u.stat === null && u.releases >= params.minReleases);
  if (own) {
    const minutes = own.medianMinutes * (1 + params.marginPercent / 100);
    return {
      minutes,
      basis: "statistic",
      text:
        `Usually released within ${durationWords(own.medianMinutes)} of collection here${own.stat ? " for STAT orders" : ""} ` +
        `(the median of ${own.releases} releases in ${params.lookbackDays} days)` +
        (params.marginPercent ? `; at risk past ${durationWords(minutes)}` : ""),
    };
  }
  const target = input.targets.find((t) => t.testId === item.testId);
  return target ? { minutes: target.minutes, basis: "rule", text: `The catalog's turnaround target is ${durationWords(target.minutes)}` } : null;
}

export function turnaroundRiskSuggestions(input: TurnaroundInput, params: TurnaroundRiskParameters, asOf: string, date: string): Suggestion[] {
  const now = Date.parse(asOf);
  const late = new Map<string, Array<{ item: OpenLabItem; elapsed: number; limit: NonNullable<ReturnType<typeof turnaroundLimit>> }>>();
  for (const item of input.items) {
    const limit = turnaroundLimit(item, input, params);
    if (!limit) continue;
    const elapsed = (now - Date.parse(item.collectedAt)) / 60_000;
    if (elapsed <= limit.minutes) continue;
    late.set(item.testId, [...(late.get(item.testId) ?? []), { item, elapsed, limit }]);
  }
  const out: Suggestion[] = [];
  for (const [testId, group] of late) {
    group.sort((a, b) => b.elapsed - a.elapsed);
    const first = group[0];
    if (!first) continue;
    const counts = new Map<OpenStage, number>();
    for (const g of group) counts.set(g.item.stage, (counts.get(g.item.stage) ?? 0) + 1);
    const stage = STAGE_ORDER.reduce((best, s) => ((counts.get(s) ?? 0) > (counts.get(best) ?? 0) ? s : best), first.item.stage);
    const urgent = group.some((g) => g.item.stat || g.elapsed >= 2 * g.limit.minutes);
    out.push({
      id: suggestionId(TURNAROUND_RISK_RULE.id, TURNAROUND_RISK_RULE.version, `test:${testId}:${date}`),
      ruleId: TURNAROUND_RISK_RULE.id,
      ruleVersion: TURNAROUND_RISK_RULE.version,
      surface: "laboratory",
      severity: urgent ? "warning" : "advice",
      title: `${first.item.testName}: ${group.length} order${group.length === 1 ? "" : "s"} past the usual turnaround (longest ${durationWords(first.elapsed)} since collection)`,
      rationale: `${first.limit.text}. Each order shows how long it has waited since collection and where it waits now; a referred test or a recollection may explain some.`,
      evidence: group.slice(0, 10).map((g) => ({
        label: `Order ${g.item.orderNumber}${g.item.stat ? " (STAT)" : ""}`,
        resourceType: "lab_order_item",
        resourceId: g.item.orderItemId,
        value: `${durationWords(g.elapsed)} since collection, ${STAGE_WORDS[g.item.stage]}`,
      })),
      basis: first.limit.basis,
      strength: "matched",
      requires: [...TURNAROUND_RISK_RULE.requires],
      action: { label: "Open the worklist", href: `/laboratory/worklist?stage=${stage}` },
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? b.evidence.length - a.evidence.length : a.severity === "warning" ? -1 : 1));
}

// ---- laboratory.qc-trend ---------------------------------------------------------------------------------------------

export const qcTrendParameters = z.object({
  /** Days of QC runs read. */
  lookbackDays: z.number().int().min(7).max(180),
  /** Runs in a row, each higher (or each lower) than the one before, that make a drift. */
  trendRuns: z.number().int().min(5).max(12),
  /** Runs averaged for a shift. */
  shiftRuns: z.number().int().min(5).max(30),
  /** A shift when that average is this far from the target mean, in percent of an SD. */
  shiftPercentSd: z.number().int().min(50).max(300),
});
export type QcTrendParameters = z.infer<typeof qcTrendParameters>;

export const QC_TREND_RULE: RuleDefinition<QcTrendParameters> = {
  id: "laboratory.qc-trend",
  version: 1,
  domain: "laboratory",
  title: "QC values drifting or shifted",
  description:
    "Per instrument, test and control lot: runs in a row each higher or each lower than the one before (a drift), or the average of the last runs well away from the target mean (a shift), which the Westgard rules may not flag yet. It rejects no run and stops no result.",
  surfaces: ["laboratory-quality"],
  requires: ["lab.qc.read"],
  parametersSchema: qcTrendParameters,
  defaultParameters: { lookbackDays: 30, trendRuns: 6, shiftRuns: 10, shiftPercentSd: 100 },
  parameterLabels: {
    trendRuns: { label: "A drift is", unit: "runs in a row, each higher (or each lower) than the one before", min: 5, max: 12 },
    shiftRuns: { label: "A shift is the average of the last", unit: "runs…", min: 5, max: 30 },
    shiftPercentSd: { label: "…at least", unit: "% of an SD away from the target mean", min: 50, max: 300 },
    lookbackDays: { label: "Read runs from the last", unit: "days", min: 7, max: 180 },
  },
};

export interface QcSeries {
  instrumentId: string;
  instrumentName: string;
  testId: string;
  testName: string;
  qcLotId: string;
  materialName: string;
  level: string;
  lotNumber: string;
  /** Oldest first. */
  runs: Array<{ runAt: string; z: number; status: "accepted" | "warning" | "rejected" }>;
}

/** The last `n` z-scores each higher ("up") or each lower ("down") than the one before; null otherwise. */
export function qcDrift(zs: readonly number[], n: number): "up" | "down" | null {
  if (zs.length < n) return null;
  const last = zs.slice(-n);
  const up = last.every((z, i) => i === 0 || z > (last[i - 1] ?? z));
  const down = last.every((z, i) => i === 0 || z < (last[i - 1] ?? z));
  return up ? "up" : down ? "down" : null;
}

/** The average of the last `n` z-scores when it is at least `threshold` SD from the target mean; null otherwise. */
export function qcShift(zs: readonly number[], n: number, threshold: number): number | null {
  if (zs.length < n) return null;
  const average = mean(zs.slice(-n));
  return average !== null && Math.abs(average) >= threshold ? average : null;
}

export function qcTrendSuggestions(series: readonly QcSeries[], params: QcTrendParameters, timeZone: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const s of series) {
    const zs = s.runs.map((r) => r.z);
    const drift = qcDrift(zs, params.trendRuns);
    const shift = qcShift(zs, params.shiftRuns, params.shiftPercentSd / 100);
    if (!drift && shift === null) continue;
    const parts = [
      ...(drift ? [`drifting ${drift} over the last ${params.trendRuns} runs`] : []),
      ...(shift !== null ? [`the last ${params.shiftRuns} runs average ${signed(shift)} SD ${shift > 0 ? "above" : "below"} the target mean`] : []),
    ];
    const last = s.runs[s.runs.length - 1];
    const shown = zs.slice(-Math.max(drift ? params.trendRuns : 0, shift !== null ? params.shiftRuns : 0));
    out.push({
      id: suggestionId(
        QC_TREND_RULE.id,
        QC_TREND_RULE.version,
        `series:${s.instrumentId}:${s.testId}:${s.qcLotId}:${[drift ? `drift-${drift}` : "", shift !== null ? "shift" : ""].filter(Boolean).join("+")}`,
      ),
      ruleId: QC_TREND_RULE.id,
      ruleVersion: QC_TREND_RULE.version,
      surface: "laboratory-quality",
      severity: drift && shift !== null ? "warning" : "advice",
      title: `${s.testName} on ${s.instrumentName}, ${s.materialName} (${s.level}) lot ${s.lotNumber}: ${parts.join("; ")}`,
      rationale:
        "The Westgard rules judge each run; a steady drift or a shift can show a reagent, calibrator, control or instrument change before a run is rejected. " +
        "Look at the instrument's maintenance and calibration and at the reagent and control lots, and record what you find.",
      evidence: [
        { label: "Last runs (z-scores, oldest first)", resourceType: "lab_qc_run", resourceId: s.qcLotId, value: shown.map(signed).join(", ") },
        ...(shift !== null
          ? [{ label: `Average of the last ${params.shiftRuns}`, resourceType: "lab_qc_run", resourceId: s.qcLotId, value: `${signed(shift)} SD` }]
          : []),
        ...(last
          ? [{ label: "Last run", resourceType: "lab_qc_run", resourceId: s.qcLotId, value: `${last.status}, ${localDate(new Date(last.runAt), timeZone)}` }]
          : []),
      ],
      basis: "statistic",
      strength: "matched",
      requires: [...QC_TREND_RULE.requires],
      action: { label: "Open its Levey-Jennings chart", href: `/laboratory/qc?instrument=${s.instrumentId}&test=${s.testId}#qc-chart` },
    });
  }
  return out;
}

// ---- laboratory.rejection-rate ---------------------------------------------------------------------------------------

export const rejectionRateParameters = z.object({
  windowDays: z.number().int().min(7).max(180),
  /** Specimens collected below which a collector (or facility) is not compared. */
  minSpecimens: z.number().int().min(5).max(1000),
  /** Rejections below which nothing is said. */
  minRejections: z.number().int().min(2).max(100),
  /** Said when the share of rejected specimens is this many times the rest's. */
  multiple: z.number().int().min(2).max(10),
});
export type RejectionRateParameters = z.infer<typeof rejectionRateParameters>;

export const REJECTION_RATE_RULE: RuleDefinition<RejectionRateParameters> = {
  id: "laboratory.rejection-rate",
  version: 1,
  domain: "laboratory",
  title: "Specimen rejections concentrated on a collector or a facility",
  description:
    "Staff who collected specimens at this facility, and this facility against the organization's others, whose share of rejected specimens is several times the rest's. Counts only, never a patient or the wording of a rejection. It may be the case mix; it judges no one and blocks nothing; only quality managers see it.",
  surfaces: ["laboratory-quality"],
  requires: ["lab.qc.manage"],
  parametersSchema: rejectionRateParameters,
  defaultParameters: { windowDays: 30, minSpecimens: 20, minRejections: 3, multiple: 2 },
  parameterLabels: {
    windowDays: { label: "Look at specimens collected in the last", unit: "days", min: 7, max: 180 },
    multiple: { label: "Point out a share of rejections at least", unit: "times the rest's", min: 2, max: 10 },
    minSpecimens: { label: "Compare only from", unit: "specimens collected", min: 5, max: 1000 },
    minRejections: { label: "…and at least", unit: "rejections", min: 2, max: 100 },
  },
};

export interface RejectionFigures {
  /** Per staff account that collected at the facility in the window. */
  collectors: Array<{ userId: string; displayName: string; collected: number; rejected: number }>;
  /** The organization's other facilities together; null when it has none. */
  others: { collected: number; rejected: number } | null;
}

/** Whether `rejected/collected` stands out against `restRejected/restCollected`. */
function standsOut(rejected: number, collected: number, restRejected: number, restCollected: number, params: RejectionRateParameters): boolean {
  if (collected < params.minSpecimens || rejected < params.minRejections || restCollected < params.minSpecimens) return false;
  return rejected / collected >= params.multiple * (restRejected / restCollected);
}

export function rejectionRateSuggestions(figures: RejectionFigures, params: RejectionRateParameters): Suggestion[] {
  const collected = figures.collectors.reduce((sum, c) => sum + c.collected, 0);
  const rejected = figures.collectors.reduce((sum, c) => sum + c.rejected, 0);
  const out: Suggestion[] = [];
  const rationale =
    "It may be the patients, the tests or the tubes rather than the people: look at the rejection reasons and the collection steps together, and raise a nonconformance if a cause is found.";
  for (const c of figures.collectors) {
    const restCollected = collected - c.collected;
    const restRejected = rejected - c.rejected;
    if (!standsOut(c.rejected, c.collected, restRejected, restCollected, params)) continue;
    out.push({
      id: suggestionId(REJECTION_RATE_RULE.id, REJECTION_RATE_RULE.version, `collector:${c.userId}`),
      ruleId: REJECTION_RATE_RULE.id,
      ruleVersion: REJECTION_RATE_RULE.version,
      surface: "laboratory-quality",
      severity: "advice",
      title: `${c.displayName}: ${c.rejected} of ${c.collected} specimens rejected in ${params.windowDays} days (${percent(c.rejected, c.collected)}), against ${percent(restRejected, restCollected)} for others here`,
      rationale,
      evidence: [
        { label: "Specimens collected", resourceType: "app_user", resourceId: c.userId, value: String(c.collected) },
        { label: "Rejected", resourceType: "app_user", resourceId: c.userId, value: `${c.rejected} (${percent(c.rejected, c.collected)})` },
        {
          label: "Others at this facility",
          resourceType: "lab_specimen",
          resourceId: "facility",
          value: `${restRejected} of ${restCollected} (${percent(restRejected, restCollected)})`,
        },
      ],
      basis: "statistic",
      strength: c.collected >= 2 * params.minSpecimens ? "matched" : "weak",
      requires: [...REJECTION_RATE_RULE.requires],
      action: { label: "Open nonconformances", href: "/laboratory/nonconformances" },
    });
  }
  const others = figures.others;
  if (others && standsOut(rejected, collected, others.rejected, others.collected, params)) {
    out.push({
      id: suggestionId(REJECTION_RATE_RULE.id, REJECTION_RATE_RULE.version, "facility"),
      ruleId: REJECTION_RATE_RULE.id,
      ruleVersion: REJECTION_RATE_RULE.version,
      surface: "laboratory-quality",
      severity: "advice",
      title: `This facility: ${rejected} of ${collected} specimens rejected in ${params.windowDays} days (${percent(rejected, collected)}), against ${percent(others.rejected, others.collected)} at your other facilities`,
      rationale,
      evidence: [
        {
          label: "This facility",
          resourceType: "lab_specimen",
          resourceId: "facility",
          value: `${rejected} of ${collected} (${percent(rejected, collected)})`,
        },
        {
          label: "Your other facilities",
          resourceType: "lab_specimen",
          resourceId: "organization",
          value: `${others.rejected} of ${others.collected} (${percent(others.rejected, others.collected)})`,
        },
      ],
      basis: "statistic",
      strength: collected >= 2 * params.minSpecimens ? "matched" : "weak",
      requires: [...REJECTION_RATE_RULE.requires],
      action: { label: "Open nonconformances", href: "/laboratory/nonconformances" },
    });
  }
  return out;
}
