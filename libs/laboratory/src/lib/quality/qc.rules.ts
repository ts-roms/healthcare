import type { QcRejectRule, QcStatus } from "../laboratory.schema";

/**
 * Internal quality control evaluation (Westgard multirules). A control value
 * is expressed as a z-score against its lot's target mean and SD, and read
 * together with the previous controls of the same test on the same instrument
 * (all control levels, as z-scores, so levels run together are compared):
 *
 * - `1_2s` one control beyond ±2 SD — a warning, never a rejection by itself
 * - `1_3s` one control beyond ±3 SD
 * - `2_2s` two consecutive controls beyond 2 SD on the same side
 * - `R_4s` two consecutive controls of different levels (a run) more than 4 SD apart, on opposite sides
 * - `4_1s` four consecutive controls beyond 1 SD on the same side
 * - `10_x` ten consecutive controls on the same side of the mean
 *
 * Which rules reject a run is the facility's choice (laboratory policy); a
 * rule that fires but is not chosen makes the run a warning. This supports
 * the laboratory's QC decision; it does not replace its review.
 */

export interface QcPoint {
  z: number;
  qcLotId: string;
}

export interface QcEvaluation {
  zScore: number;
  status: QcStatus;
  violations: string[];
}

export function zScore(value: number, mean: number, sd: number): number {
  if (!(sd > 0)) throw new Error("SD must be positive");
  return Math.round(((value - mean) / sd) * 1000) / 1000;
}

/** `previous` are the earlier controls of the series, newest first. */
export function evaluateQc(current: QcPoint, previous: QcPoint[], rejectRules: readonly QcRejectRule[]): QcEvaluation {
  const z = current.z;
  const series = [current, ...previous];
  const side = (p: QcPoint) => Math.sign(p.z);
  const last = (n: number) => (series.length >= n ? series.slice(0, n) : null);
  const fired: string[] = [];

  if (Math.abs(z) > 2) fired.push("1_2s");
  if (Math.abs(z) > 3) fired.push("1_3s");
  const prior = previous[0];
  if (prior && Math.abs(z) > 2 && Math.abs(prior.z) > 2 && side(prior) === Math.sign(z)) fired.push("2_2s");
  if (prior && prior.qcLotId !== current.qcLotId && side(prior) === -Math.sign(z) && Math.abs(z - prior.z) > 4) fired.push("R_4s");
  const four = last(4);
  if (four && four.every((p) => Math.abs(p.z) > 1 && side(p) === Math.sign(z))) fired.push("4_1s");
  const ten = last(10);
  if (ten && z !== 0 && ten.every((p) => side(p) === Math.sign(z))) fired.push("10_x");

  const rejected = fired.some((rule) => (rejectRules as readonly string[]).includes(rule));
  return { zScore: z, status: rejected ? "rejected" : fired.length ? "warning" : "accepted", violations: fired };
}

const SEVERITY: Record<QcStatus, number> = { accepted: 0, warning: 1, rejected: 2 };

/**
 * The run that decides the QC state of a test on an instrument: of the latest run of each control lot (level) within
 * the QC window, the worst one (the most recent among equals). A newer accepted level does not hide a rejected one.
 */
export function decisiveRun<T extends { status: QcStatus; runAt: Date }>(latestPerLot: T[]): T | null {
  return latestPerLot.reduce<T | null>((worst, run) => {
    if (!worst) return run;
    const diff = SEVERITY[run.status] - SEVERITY[worst.status];
    return diff > 0 || (diff === 0 && run.runAt > worst.runAt) ? run : worst;
  }, null);
}

/**
 * Whether patient results on an instrument may be entered for a test, given the decisive QC run within the facility's
 * validity window (null when none). Only enforced when the facility requires QC.
 */
export function qcAllowsResults(latest: { status: QcStatus } | null, required: boolean): { allowed: boolean; reason?: string } {
  if (!required) return { allowed: true };
  if (!latest) return { allowed: false, reason: "No QC has been run for this test on this instrument within the facility's QC window" };
  if (latest.status === "rejected") return { allowed: false, reason: "The latest QC run of a control level for this test on this instrument was rejected" };
  return { allowed: true };
}
