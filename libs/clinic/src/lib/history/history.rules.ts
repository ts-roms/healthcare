import type { FamilyRelationship, FamilyReviewOutcome, HistoryDatePrecision, UseStatus } from "./history.schema";

/**
 * Pure rules of the patient history (docs/domains/patient-history.md). Nothing here scores, classifies or infers
 * anything clinical: the platform keeps what was reported or documented, as precise as it was given.
 */

/** A past date at the precision known. */
export interface PartialDate {
  /** YYYY-MM-DD; a year is kept as 1 January, a month as its first day. */
  date: string;
  precision: HistoryDatePrecision;
}

const YEAR = /^(\d{4})$/;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function validDay(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Whether text is a past date the history can keep: YYYY, YYYY-MM or YYYY-MM-DD (from 1900). */
export function isPartialDateText(value: string): boolean {
  if (!YEAR.test(value) && !MONTH.test(value) && !(DAY.test(value) && validDay(value))) return false;
  return Number(value.slice(0, 4)) >= 1900;
}

/** Reads YYYY, YYYY-MM or YYYY-MM-DD. Throws on anything else (callers validate with `isPartialDateText`). */
export function parsePartialDate(value: string): PartialDate {
  if (!isPartialDateText(value)) throw new Error(`Not a partial date: ${value}`);
  if (YEAR.test(value)) return { date: `${value}-01-01`, precision: "year" };
  if (MONTH.test(value)) return { date: `${value}-01`, precision: "month" };
  return { date: value, precision: "day" };
}

/** The date as text at its precision: "2019", "2019-05" or "2019-05-12"; null when unknown. */
export function partialDateText(date: string | null, precision: HistoryDatePrecision | null): string | null {
  if (!date || !precision) return null;
  return precision === "year" ? date.slice(0, 4) : precision === "month" ? date.slice(0, 7) : date;
}

/** Whether a partial date starts after today (a year or month is in the future only when it starts after today). */
export function partialDateInFuture(d: PartialDate, today: string): boolean {
  return d.date > today;
}

export const RELATIONSHIP_LABEL: Record<FamilyRelationship, string> = {
  mother: "Mother",
  father: "Father",
  sister: "Sister",
  brother: "Brother",
  sibling: "Sibling",
  half_sibling: "Half-sibling",
  daughter: "Daughter",
  son: "Son",
  child: "Child",
  maternal_grandmother: "Maternal grandmother",
  maternal_grandfather: "Maternal grandfather",
  paternal_grandmother: "Paternal grandmother",
  paternal_grandfather: "Paternal grandfather",
  maternal_aunt: "Maternal aunt",
  maternal_uncle: "Maternal uncle",
  paternal_aunt: "Paternal aunt",
  paternal_uncle: "Paternal uncle",
  cousin: "Cousin",
  other: "Other relative",
};

/** The relative as shown: the listed relationship, with the free text ("Other relative" is replaced by the text). */
export function relativeText(relationship: FamilyRelationship, text: string | null): string {
  if (relationship === "other") return text ?? RELATIONSHIP_LABEL.other;
  return text ? `${RELATIONSHIP_LABEL[relationship]} (${text})` : RELATIONSHIP_LABEL[relationship];
}

/**
 * The family history's state: entries recorded (whatever the latest review says), else the latest review's answer
 * (none known, or not known), else not recorded — the same wording rules as allergies: "none known" only after a
 * recorded review.
 */
export type FamilyHistoryState = "not_recorded" | "recorded" | "none_known" | "unknown";

export function familyHistoryState(activeEntries: number, latestReview: { outcome: FamilyReviewOutcome } | null): FamilyHistoryState {
  if (activeEntries > 0) return "recorded";
  if (latestReview?.outcome === "none_known") return "none_known";
  if (latestReview?.outcome === "unknown") return "unknown";
  return "not_recorded";
}

/** A review outcome that contradicts the entries: "none known" while entries are listed, "reviewed" with nothing listed. */
export function reviewConflict(outcome: FamilyReviewOutcome, activeEntries: number): string | null {
  if (outcome === "none_known" && activeEntries > 0) return "Family history is listed: mark those entries entered in error first, or review it as listed";
  if (outcome === "reviewed" && activeEntries === 0) return "Nothing is listed: record the entries first, or record that none are known";
  return null;
}

/** The social history fields a version holds (sensitive ones marked). */
export interface SocialFields {
  tobaccoStatus: UseStatus | null;
  tobaccoType: string | null;
  tobaccoAmount: string | null;
  tobaccoQuitYear: number | null;
  alcoholStatus: UseStatus | null;
  alcoholFrequency: string | null;
  substanceUse: string | null;
  occupation: string | null;
  occupationalExposures: string | null;
  livingSituation: string | null;
  physicalActivity: string | null;
  diet: string | null;
  sexualHistory: string | null;
  notes: string | null;
}

export const SOCIAL_FIELDS = [
  "tobaccoStatus",
  "tobaccoType",
  "tobaccoAmount",
  "tobaccoQuitYear",
  "alcoholStatus",
  "alcoholFrequency",
  "substanceUse",
  "occupation",
  "occupationalExposures",
  "livingSituation",
  "physicalActivity",
  "diet",
  "sexualHistory",
  "notes",
] as const satisfies ReadonlyArray<keyof SocialFields>;

/** Shown only to users who also hold encounter.write (and to the patient); never in notices, the timeline or search. */
export const SENSITIVE_SOCIAL_FIELDS = ["substanceUse", "sexualHistory"] as const satisfies ReadonlyArray<keyof SocialFields>;
export type SensitiveSocialField = (typeof SENSITIVE_SOCIAL_FIELDS)[number];

/** The permission, besides history.read, that shows the sensitive parts of the social history. */
export const SENSITIVE_HISTORY_PERMISSION = "encounter.write";

export const EMPTY_SOCIAL: SocialFields = Object.fromEntries(SOCIAL_FIELDS.map((k) => [k, null])) as unknown as SocialFields;

/**
 * A new version of the social history: it starts from the current version; each field given replaces it (null clears
 * it), each field left out is carried over. Details that only apply to a status are dropped when the status no longer
 * allows them (tobacco type and amount for former or current use, the quit year for former use, the alcohol
 * frequency for former or current use).
 */
export function nextSocialVersion(current: SocialFields | null, changes: Partial<SocialFields>): SocialFields {
  const next: SocialFields = { ...(current ?? EMPTY_SOCIAL) };
  for (const key of SOCIAL_FIELDS) {
    if (changes[key] !== undefined) (next as unknown as Record<string, unknown>)[key] = changes[key];
  }
  if (next.tobaccoStatus !== "former" && next.tobaccoStatus !== "current") {
    next.tobaccoType = null;
    next.tobaccoAmount = null;
  }
  if (next.tobaccoStatus !== "former") next.tobaccoQuitYear = null;
  if (next.alcoholStatus !== "former" && next.alcoholStatus !== "current") next.alcoholFrequency = null;
  return next;
}

/** Whether a version says anything (a version with every field empty is refused). */
export function socialHasContent(fields: SocialFields): boolean {
  return SOCIAL_FIELDS.some((k) => fields[k] !== null);
}

/** The fields that differ between two versions (names only; used for the audit, never the values). */
export function changedSocialFields(before: SocialFields | null, after: SocialFields): Array<keyof SocialFields> {
  return SOCIAL_FIELDS.filter((k) => (before ? before[k] : null) !== after[k]);
}

export const USE_STATUS_LABEL: Record<UseStatus, string> = { never: "Never", former: "Former", current: "Current", unknown: "Not known" };

/** "Current — cigarettes, 10 a day" / "Former — quit 2015" / "Never". */
export function tobaccoText(f: Pick<SocialFields, "tobaccoStatus" | "tobaccoType" | "tobaccoAmount" | "tobaccoQuitYear">): string | null {
  if (!f.tobaccoStatus) return null;
  const details = [f.tobaccoType, f.tobaccoAmount, f.tobaccoQuitYear ? `quit ${f.tobaccoQuitYear}` : null].filter(Boolean);
  return details.length ? `${USE_STATUS_LABEL[f.tobaccoStatus]} — ${details.join(", ")}` : USE_STATUS_LABEL[f.tobaccoStatus];
}

export function alcoholText(f: Pick<SocialFields, "alcoholStatus" | "alcoholFrequency">): string | null {
  if (!f.alcoholStatus) return null;
  return f.alcoholFrequency ? `${USE_STATUS_LABEL[f.alcoholStatus]} — ${f.alcoholFrequency}` : USE_STATUS_LABEL[f.alcoholStatus];
}
