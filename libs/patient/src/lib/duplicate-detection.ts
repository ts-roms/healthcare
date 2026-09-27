/**
 * Duplicate patient detection (CLAUDE.md §7). The database supplies candidate
 * rows with similarity measures; this module decides how strong a match is.
 * Kept pure so the matching policy is explicit and unit-tested.
 */

export type DuplicateLevel = "certain" | "high" | "possible";

export type DuplicateReason =
  | "identifier_match"
  | "exact_name_and_birth_date"
  | "similar_name_and_birth_date"
  | "contact_and_birth_date"
  | "similar_name_and_transposed_birth_date"
  | "similar_name_and_birth_year";

export interface MatchSignals {
  /** pg_trgm similarity of normalized full names, 0..1. */
  nameSimilarity: number;
  exactName: boolean;
  sameBirthDate: boolean;
  /** Day and month swapped (e.g. 03/04 vs 04/03), a common data-entry error. */
  transposedBirthDate: boolean;
  sameBirthYear: boolean;
  identifierMatch: boolean;
  contactMatch: boolean;
}

export interface DuplicateAssessment {
  level: DuplicateLevel;
  reasons: DuplicateReason[];
}

export const SIMILAR_NAME_THRESHOLD = 0.55;
export const LOOSE_NAME_THRESHOLD = 0.8;

export function assessDuplicate(signals: MatchSignals): DuplicateAssessment | undefined {
  const reasons: DuplicateReason[] = [];
  const similarName = signals.exactName || signals.nameSimilarity >= SIMILAR_NAME_THRESHOLD;

  if (signals.identifierMatch) reasons.push("identifier_match");
  if (signals.exactName && signals.sameBirthDate) reasons.push("exact_name_and_birth_date");
  else if (similarName && signals.sameBirthDate) reasons.push("similar_name_and_birth_date");
  if (signals.contactMatch && signals.sameBirthDate) reasons.push("contact_and_birth_date");
  if (similarName && signals.transposedBirthDate) reasons.push("similar_name_and_transposed_birth_date");
  if (!signals.sameBirthDate && signals.sameBirthYear && signals.nameSimilarity >= LOOSE_NAME_THRESHOLD) {
    reasons.push("similar_name_and_birth_year");
  }

  if (reasons.length === 0) return undefined;
  if (signals.identifierMatch) return { level: "certain", reasons };
  if (reasons.some((r) => r === "exact_name_and_birth_date" || r === "similar_name_and_birth_date" || r === "contact_and_birth_date")) {
    return { level: "high", reasons };
  }
  return { level: "possible", reasons };
}

/** "1980-03-04" → "1980-04-03"; undefined when the swap is not a valid date or is identical. */
export function transposeDayMonth(isoDate: string): string | undefined {
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day || month === day) return undefined;
  const swapped = `${year}-${day}-${month}`;
  const parsed = new Date(`${swapped}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(swapped) ? swapped : undefined;
}
