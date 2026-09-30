import { localDate } from "@healthcare/core";
import type { OccurrencePrecision } from "./immunization.schema";

/**
 * Pure rules of the immunization history (docs/domains/immunizations.md). Nothing here knows a schedule, an interval or
 * which dose is due: the platform records what was given, not given or reported, as the clinician or source states it.
 */

/** When a dose was given, at the precision it is known. */
export interface Occurrence {
  /** YYYY-MM-DD; a year is kept as 1 January, a month as its first day. */
  date: string;
  precision: OccurrencePrecision;
  /** The instant, only with precision `time`. */
  at: Date | null;
}

const YEAR = /^(\d{4})$/;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

function validDay(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Whether text is an occurrence the platform can record: YYYY, YYYY-MM, YYYY-MM-DD, or an instant with a time zone. */
export function isOccurrenceText(value: string): boolean {
  if (YEAR.test(value) || MONTH.test(value)) return Number(value.slice(0, 4)) >= 1900;
  if (DAY.test(value)) return validDay(value) && Number(value.slice(0, 4)) >= 1900;
  return INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Reads an occurrence: a year, a year and month, a day, or an instant (whose calendar day is taken in `timeZone`).
 * Throws on anything else (callers validate with `isOccurrenceText` first).
 */
export function parseOccurrence(value: string, timeZone: string): Occurrence {
  if (!isOccurrenceText(value)) throw new Error(`Not an occurrence: ${value}`);
  if (YEAR.test(value)) return { date: `${value}-01-01`, precision: "year", at: null };
  if (MONTH.test(value)) return { date: `${value}-01`, precision: "month", at: null };
  if (DAY.test(value)) return { date: value, precision: "day", at: null };
  const at = new Date(value);
  return { date: localDate(at, timeZone), precision: "time", at };
}

/** The occurrence as text at its precision: "2019", "2019-05", "2019-05-12" or an ISO instant. */
export function occurrenceText(o: { date: string; precision: OccurrencePrecision; at: Date | string | null }): string {
  switch (o.precision) {
    case "year":
      return o.date.slice(0, 4);
    case "month":
      return o.date.slice(0, 7);
    case "day":
      return o.date;
    case "time":
      return o.at instanceof Date ? o.at.toISOString() : (o.at ?? o.date);
  }
}

/** Whether the occurrence is in the future (a year or month is future only when it starts after today). */
export function occurrenceInFuture(o: Occurrence, today: string, now: Date): boolean {
  if (o.at) return o.at.getTime() > now.getTime() + 5 * 60_000;
  return o.date > today;
}

/** Given here: a day or a time (a partial date is for reported doses only). */
export function precisionAllowedHere(precision: OccurrencePrecision): boolean {
  return precision === "day" || precision === "time";
}

/** An expiry is valid when it is not before the day the dose was given. */
export function expiryValid(expiryDate: string | null | undefined, occurrenceDate: string): boolean {
  return !expiryDate || expiryDate >= occurrenceDate;
}

/** The dose as shown: the label as recorded, else "Dose n", else null. */
export function doseText(dose: { doseLabel: string | null; doseNumber: number | null }): string | null {
  if (dose.doseLabel)
    return dose.doseNumber && !dose.doseLabel.includes(String(dose.doseNumber)) ? `${dose.doseLabel} (dose ${dose.doseNumber})` : dose.doseLabel;
  return dose.doseNumber ? `Dose ${dose.doseNumber}` : null;
}

/** Catalogue route and site options: trimmed, de-duplicated (case-insensitively), in the order given. */
export function cleanOptions(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out;
}
