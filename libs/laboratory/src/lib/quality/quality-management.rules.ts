import type { CompetencyOutcome, NonconformanceEntryKind } from "./quality-management.schema";

/**
 * Rules of the laboratory's quality management (Phase 9). The values they
 * work with — acceptable ranges, reading intervals, competency areas and
 * intervals — are the laboratory's configuration, not regulatory defaults.
 */

/** A reading outside the unit's acceptable range (limits inclusive). */
export function isExcursion(celsius: number, min: number, max: number): boolean {
  return celsius < min || celsius > max;
}

/** A reading is due when the last one is older than the unit's interval (no interval: never due). */
export function readingOverdue(lastReadAt: Date | null, intervalHours: number | null, now: Date): boolean {
  if (intervalHours === null) return false;
  if (!lastReadAt) return true;
  return now.getTime() - lastReadAt.getTime() > intervalHours * 3_600_000;
}

/** What the trail must hold before a nonconformance is closed. */
export const REQUIRED_TO_CLOSE: ReadonlyArray<{ kind: NonconformanceEntryKind; label: string }> = [
  { kind: "root_cause", label: "root cause" },
  { kind: "corrective_action", label: "corrective action" },
  { kind: "effectiveness_check", label: "effectiveness check" },
];

/** The steps still missing before closing (empty: it can be closed). */
export function missingToClose(entryKinds: NonconformanceEntryKind[]): string[] {
  return REQUIRED_TO_CLOSE.filter((r) => !entryKinds.includes(r.kind)).map((r) => r.label);
}

export interface CompetencyAssessmentLike {
  testId: string | null;
  departmentId: string | null;
  outcome: CompetencyOutcome;
  assessedOn: string;
  nextDueOn: string | null;
  recordedAt: Date;
}

export type CompetencyState = "competent" | "due" | "not_yet_competent" | "not_assessed";

/**
 * A staff member's competency for a test: the latest assessment for the test itself, or — when there is none — for
 * its department. Competent until the next due date (inclusive); "due" after it.
 */
export function competencyFor(
  assessments: CompetencyAssessmentLike[],
  test: { id: string; departmentId: string },
  today: string,
): { state: CompetencyState; assessment: CompetencyAssessmentLike | null } {
  const latest = (list: CompetencyAssessmentLike[]) =>
    list.reduce<CompetencyAssessmentLike | null>(
      (best, a) => (!best || a.assessedOn > best.assessedOn || (a.assessedOn === best.assessedOn && a.recordedAt > best.recordedAt) ? a : best),
      null,
    );
  const assessment = latest(assessments.filter((a) => a.testId === test.id)) ?? latest(assessments.filter((a) => a.departmentId === test.departmentId));
  if (!assessment) return { state: "not_assessed", assessment: null };
  if (assessment.outcome !== "competent") return { state: "not_yet_competent", assessment };
  if (assessment.nextDueOn !== null && assessment.nextDueOn < today) return { state: "due", assessment };
  return { state: "competent", assessment };
}

export type LicenceState = "missing" | "valid" | "expiring" | "expired" | "not_yet_valid";

/**
 * Where the facility's recorded laboratory licence stands on a local date: expiring within the organization's own
 * reminder window, expired, or valid. The platform checks dates only; the licence itself is not verified.
 */
export function licenceState(licence: { validFrom: string; validUntil: string; reminderDays: number } | null, today: string): LicenceState {
  if (!licence) return "missing";
  if (today < licence.validFrom) return "not_yet_valid";
  if (today > licence.validUntil) return "expired";
  const remind = new Date(`${licence.validUntil}T00:00:00Z`);
  remind.setUTCDate(remind.getUTCDate() - licence.reminderDays);
  return today >= remind.toISOString().slice(0, 10) ? "expiring" : "valid";
}
