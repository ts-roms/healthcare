import type { ReagentUseKind } from "../laboratory.schema";

/** A load with this share of its capacity or less left is shown as running low. */
export const REAGENT_LOW_SHARE = 0.1;

/**
 * Tests a load holds: the number stated at the load, or the stock taken times the reagent's yield (tests per stock
 * unit). Unknown (null) when neither is available — use is still counted, without a remainder.
 */
export function loadCapacity(input: { capacityTests?: number | null; stockQuantity?: number | null; testsPerUnit?: number | null }): number | null {
  if (input.capacityTests) return input.capacityTests;
  if (input.stockQuantity && input.testsPerUnit) return input.stockQuantity * input.testsPerUnit;
  return null;
}

export interface ReagentUseSummary {
  /** Patient runs (an order measured on the instrument; a panel counts once per result version). */
  patientRuns: number;
  /** Tests the patient runs used (more than the runs when a test uses several per run). */
  patientTests: number;
  qcRuns: number;
  qcTests: number;
  /** Repeats not entered as results, calibration, priming and other recorded use. */
  otherRuns: number;
  wasted: number;
  total: number;
  capacity: number | null;
  /** Capacity minus total use; negative when more was used than the stated capacity. Null without a capacity. */
  remaining: number | null;
  /** Share of the capacity used (0–1+), null without a capacity. */
  usedShare: number | null;
  /** Still loaded and at or below REAGENT_LOW_SHARE of its capacity. */
  low: boolean;
}

/**
 * Use of a load from its use records (`tests` summed and, for patient and QC runs, `runs` counted; `runs` defaults to
 * `tests`, as when every run used one test). Capacity and totals are in tests.
 */
export function summarizeReagentUse(
  uses: Array<{ kind: ReagentUseKind; tests: number; runs?: number }>,
  capacity: number | null,
  loaded: boolean,
): ReagentUseSummary {
  let patientRuns = 0;
  let patientTests = 0;
  let qcRuns = 0;
  let qcTests = 0;
  let otherRuns = 0;
  let wasted = 0;
  for (const use of uses) {
    if (use.kind === "patient") {
      patientRuns += use.runs ?? use.tests;
      patientTests += use.tests;
    } else if (use.kind === "qc") {
      qcRuns += use.runs ?? use.tests;
      qcTests += use.tests;
    } else if (use.kind === "waste") wasted += use.tests;
    else otherRuns += use.tests;
  }
  const total = patientTests + qcTests + otherRuns + wasted;
  const remaining = capacity === null ? null : capacity - total;
  return {
    patientRuns,
    patientTests,
    qcRuns,
    qcTests,
    otherRuns,
    wasted,
    total,
    capacity,
    remaining,
    usedShare: capacity === null ? null : total / capacity,
    low: loaded && capacity !== null && remaining !== null && remaining <= capacity * REAGENT_LOW_SHARE,
  };
}

/**
 * Reagent cost per patient run of a finished load: everything the load cost (QC, repeats, calibration, waste and what
 * was left unused included) spread over the patient runs it produced. Null while the load is in use, without a cost,
 * or without patient runs. Centavos, rounded.
 */
export function costPerPatientRun(cost: number | null, patientRuns: number, unloaded: boolean): number | null {
  if (!unloaded || cost === null || patientRuns === 0) return null;
  return Math.round(cost / patientRuns);
}

/** A reagent's tests per run for tests (keyed by test id); a test without a stated number uses 1. */
export function testsPerRunOf(stated: ReadonlyMap<string, number>, testId: string): number {
  return stated.get(testId) ?? 1;
}

/**
 * Tests a patient run counts on a load: the first run of an order (version 1) measures the ordered tests the load
 * serves — a panel is one run, counted with the most tests per run among them; a later version (a re-run or a re-test)
 * measures its own test. Tests the load does not serve are left out; at least 1.
 */
export function patientRunTests(input: {
  loadTestId: string | null;
  resultTestId: string;
  versionNumber: number;
  orderTestIds: readonly string[];
  testsPerRun: ReadonlyMap<string, number>;
}): number {
  const measured = input.versionNumber === 1 ? input.orderTestIds : [input.resultTestId];
  const served = measured.filter((t) => input.loadTestId === null || t === input.loadTestId);
  return Math.max(1, ...served.map((t) => testsPerRunOf(input.testsPerRun, t)));
}
