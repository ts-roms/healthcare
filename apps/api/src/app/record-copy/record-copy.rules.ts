import { localDate } from "@healthcare/core";

/** A period of local calendar dates (either end open). */
export interface CopyPeriod {
  from?: string | null;
  to?: string | null;
}

/** Whether an instant falls in the period, by its local date in the facility's time zone. */
export function instantInPeriod(at: string | Date | null | undefined, period: CopyPeriod, timeZone: string): boolean {
  if (!at) return false;
  return dateInPeriod(localDate(typeof at === "string" ? new Date(at) : at, timeZone), period);
}

/** Whether a calendar date (YYYY-MM-DD) falls in the period. */
export function dateInPeriod(date: string, period: CopyPeriod): boolean {
  return (!period.from || date >= period.from) && (!period.to || date <= period.to);
}

/** Whether a span of dates (a care plan from its start to its end, open-ended while running) overlaps the period. */
export function spanOverlapsPeriod(start: string, end: string | null, period: CopyPeriod): boolean {
  return (!period.to || start <= period.to) && (!period.from || end === null || end >= period.from);
}

/**
 * The days a recorded occurrence covers: a whole year, a whole month, or its day (an immunization reported as "2019"
 * or "May 2019"). Used to decide whether it falls in a period.
 */
export function occurrenceSpan(date: string, precision: "year" | "month" | "day" | "time"): { start: string; end: string } {
  if (precision === "year") return { start: `${date.slice(0, 4)}-01-01`, end: `${date.slice(0, 4)}-12-31` };
  if (precision === "month") {
    const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { start: `${date.slice(0, 7)}-01`, end: `${date.slice(0, 7)}-${String(last).padStart(2, "0")}` };
  }
  return { start: date, end: date };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A partial date as printed: "2019", "May 2019", or the day as `format` prints it. */
export function occurrenceLabel(date: string, precision: "year" | "month" | "day" | "time", format: (date: string) => string): string {
  if (precision === "year") return date.slice(0, 4);
  if (precision === "month") return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
  return format(date);
}

/** "All records", "From 1 Jan 2026", "Up to 31 Mar 2026" or "1 Jan 2026 to 31 Mar 2026". */
export function periodLabel(period: CopyPeriod, format: (date: string) => string): string {
  if (period.from && period.to) return `${format(period.from)} to ${format(period.to)}`;
  if (period.from) return `From ${format(period.from)}`;
  if (period.to) return `Up to ${format(period.to)}`;
  return "All records";
}

/** A laboratory result's value as printed: the number with its unit, the text, or the coded answer. */
export function resultValue(result: { valueNumeric: number | null; valueText: string | null; valueCoded: string | null; unit: string | null }): string {
  if (result.valueNumeric !== null) return result.unit ? `${result.valueNumeric} ${result.unit}` : String(result.valueNumeric);
  return result.valueText ?? result.valueCoded ?? "";
}

/** A reference range as printed ("3.9 to 5.5", "< 5.7", "> 40", or the laboratory's text). */
export function referenceRange(result: { refLow: number | null; refHigh: number | null; refText: string | null }): string {
  if (result.refLow !== null && result.refHigh !== null) return `${result.refLow} to ${result.refHigh}`;
  if (result.refHigh !== null) return `< ${result.refHigh}`;
  if (result.refLow !== null) return `> ${result.refLow}`;
  return result.refText ?? "";
}

const FLAGS: Record<string, string> = {
  low: "Low",
  high: "High",
  critical_low: "Critically low",
  critical_high: "Critically high",
  abnormal: "Abnormal",
};

/** A result flag as words (never a symbol alone); normal results print nothing. */
export function flagLabel(flag: string | null): string {
  return flag ? (FLAGS[flag] ?? "") : "";
}
