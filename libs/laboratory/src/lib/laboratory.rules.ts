import type { OrderItemStatus, ResultFlag, ResultStatus } from "./laboratory.schema";

/**
 * Pure laboratory rules: reference-range selection, result interpretation,
 * result state transitions and separation of duties. Flags are interpretation
 * aids against the laboratory's configured ranges — not diagnoses.
 */

export interface RangeCandidate {
  id: string;
  sex: "male" | "female" | null;
  ageMinDays: number;
  ageMaxDays: number | null;
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  textRange: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/** Whole days between two YYYY-MM-DD calendar dates (birth date → the facility-local date of collection). */
export function ageInDays(birthDate: string, onDate: string): number {
  const days = (date: string) => {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return Math.max(0, days(onDate) - days(birthDate));
}

/**
 * The range that applies to a patient at a moment: effective then, covering
 * the patient's age, and matching their sex — a sex-specific range wins over
 * an "any sex" one. Patients recorded as intersex or unknown get only "any"
 * ranges (never a guessed sex). Undefined when nothing applies.
 */
export function selectReferenceRange<T extends RangeCandidate>(ranges: T[], patient: { sex: string; ageDays: number }, at: Date): T | undefined {
  const applicable = ranges.filter(
    (r) =>
      r.effectiveFrom <= at &&
      (r.effectiveTo === null || at < r.effectiveTo) &&
      patient.ageDays >= r.ageMinDays &&
      (r.ageMaxDays === null || patient.ageDays < r.ageMaxDays) &&
      (r.sex === null || r.sex === patient.sex),
  );
  return applicable.find((r) => r.sex !== null) ?? applicable.find((r) => r.sex === null);
}

export interface Interpretation {
  flag: ResultFlag | null;
  critical: boolean;
}

/** Flags a numeric value against a range. Without a numeric range there is no flag. */
export function interpretNumeric(value: number, range: Pick<RangeCandidate, "low" | "high" | "criticalLow" | "criticalHigh"> | undefined): Interpretation {
  if (!range) return { flag: null, critical: false };
  if (range.criticalLow !== null && value <= range.criticalLow) return { flag: "critical_low", critical: true };
  if (range.criticalHigh !== null && value >= range.criticalHigh) return { flag: "critical_high", critical: true };
  if (range.low !== null && value < range.low) return { flag: "low", critical: false };
  if (range.high !== null && value > range.high) return { flag: "high", critical: false };
  if (range.low === null && range.high === null) return { flag: null, critical: false };
  return { flag: "normal", critical: false };
}

/** Coded results are abnormal when the laboratory configured the value as abnormal. */
export function interpretCoded(value: string, abnormalValues: readonly string[]): Interpretation {
  return { flag: abnormalValues.includes(value) ? "abnormal" : "normal", critical: false };
}

/** Rejects numeric values with more decimals than the test reports. */
export function exceedsDecimalPlaces(value: number, decimalPlaces: number | null): boolean {
  if (decimalPlaces === null) return false;
  const [, fraction = ""] = String(value).split(".");
  return fraction.length > decimalPlaces;
}

/** Forward-only result lifecycle (mirrored by the lab_result_guard trigger). */
const RESULT_TRANSITIONS: Record<ResultStatus, readonly ResultStatus[]> = {
  entered: ["verified", "superseded", "cancelled"],
  verified: ["approved", "superseded", "cancelled"],
  approved: ["released", "superseded", "cancelled"],
  released: ["superseded"],
  superseded: [],
  cancelled: [],
};

export function canTransition(from: ResultStatus, to: ResultStatus): boolean {
  return RESULT_TRANSITIONS[from].includes(to);
}

export type SignOff = "verify" | "approve";

/**
 * Separation of duties: whoever entered a result does not also verify or
 * approve it, unless the facility policy explicitly allows it. The outcome
 * records whether it was a self sign-off so the exception stays visible.
 */
export function signOffDecision(
  kind: SignOff,
  result: { enteredBy: string },
  actorUserId: string,
  policy: { allowSelfVerification: boolean; allowSelfApproval: boolean },
): { allowed: boolean; self: boolean } {
  const self = result.enteredBy === actorUserId;
  if (!self) return { allowed: true, self: false };
  return { allowed: kind === "verify" ? policy.allowSelfVerification : policy.allowSelfApproval, self: true };
}

/** Item status that follows from its current result's status. */
export function itemStatusForResult(status: ResultStatus): OrderItemStatus {
  return status === "released" ? "released" : "resulted";
}

/**
 * An order is complete when every item is released or cancelled (at least one
 * released); cancelled when every item is cancelled; otherwise still active.
 */
export function orderStatusFromItems(items: ReadonlyArray<{ status: OrderItemStatus }>): "active" | "completed" | "cancelled" {
  if (items.length > 0 && items.every((i) => i.status === "cancelled")) return "cancelled";
  if (items.every((i) => i.status === "released" || i.status === "cancelled") && items.some((i) => i.status === "released")) return "completed";
  return "active";
}

/** Accession number: facility-local YYMMDD + 4-digit daily counter (more digits past 9999). */
export function accessionNumber(localDate: string, counter: number): string {
  const [y, m, d] = localDate.split("-") as [string, string, string];
  return `${y.slice(2)}${m}${d}${String(counter).padStart(4, "0")}`;
}

/** Trend key: LOINC when configured (comparable across test codes), else the local test code. */
export function analyteKey(test: { code: string; loincCode: string | null }): string {
  return test.loincCode ? `loinc:${test.loincCode}` : `test:${test.code}`;
}
