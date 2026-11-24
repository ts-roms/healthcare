/**
 * Periods for the assistant's Ask (docs/domains/assistant.md, "Ask"; ADR-0019): what a person types for a time ("last
 * week", "October", "1 to 15 Nov", "this month vs last month") read into a stable key, and a key resolved to local dates.
 * Keys are relative where the words were ("last-week"), so a saved question asked again reads its own new last week.
 * Fixed word lists and patterns only; the facility's time zone gives `today`.
 *
 * Keys: `today` `yesterday` `tomorrow` `this-week` `last-week` `this-month` `last-month` `this-year` `last-year`
 * `last-N-days` (1–366), a month `YYYY-MM`, a day `YYYY-MM-DD`, a range `YYYY-MM-DD..YYYY-MM-DD`. Weeks run Monday to
 * Sunday.
 */

export const PERIOD_KEY =
  /^(?:today|yesterday|tomorrow|this-week|last-week|this-month|last-month|this-year|last-year|last-\d{1,3}-days|\d{4}-\d{2}|\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2})$/;

export const COMPARE_MODES = ["previous", "last-year"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

/** The most days a period may cover (the management dashboard's limit). */
export const MAX_PERIOD_DAYS = 366;

/** Keys of a single day. */
export function isDayKey(key: string): boolean {
  return key === "today" || key === "yesterday" || key === "tomorrow" || /^\d{4}-\d{2}-\d{2}$/.test(key);
}

// ---- dates (local calendar dates, YYYY-MM-DD; arithmetic in UTC so no time zone or daylight saving moves a day) -------

const parts = (date: string) => date.split("-").map(Number) as [number, number, number];
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  return iso(y, m, d + days);
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The same day `months` months away, the last day of the month when that month is shorter (31 Mar − 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = first.getUTCFullYear();
  const tm = first.getUTCMonth() + 1;
  return iso(ty, tm, Math.min(d, lastDayOfMonth(ty, tm)));
}

/** Days from `from` to `to` inclusive. */
export function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** The Monday of the week holding `date`. */
function mondayOf(date: string): string {
  const [y, m, d] = parts(date);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const monthEnd = (date: string) => {
  const [y, m] = parts(date);
  return iso(y, m, lastDayOfMonth(y, m));
};

/**
 * The local dates a key covers, against the facility's `today`. Null when the key is not one, or covers more than
 * `MAX_PERIOD_DAYS` or ends before it starts. Days after today are kept (an appointments question may ask about
 * tomorrow); whoever reads figures that only exist up to today clips with `upToToday`.
 */
export function resolvePeriod(key: string, today: string): { from: string; to: string } | null {
  if (!PERIOD_KEY.test(key)) return null;
  const [ty] = parts(today);
  let range: { from: string; to: string };
  const lastDays = /^last-(\d{1,3})-days$/.exec(key);
  if (key === "today") range = { from: today, to: today };
  else if (key === "yesterday") range = { from: addDays(today, -1), to: addDays(today, -1) };
  else if (key === "tomorrow") range = { from: addDays(today, 1), to: addDays(today, 1) };
  else if (key === "this-week") range = { from: mondayOf(today), to: today };
  else if (key === "last-week") range = { from: addDays(mondayOf(today), -7), to: addDays(mondayOf(today), -1) };
  else if (key === "this-month") range = { from: monthStart(today), to: today };
  else if (key === "last-month") {
    const day = addDays(monthStart(today), -1);
    range = { from: monthStart(day), to: day };
  } else if (key === "this-year") range = { from: `${ty}-01-01`, to: today };
  else if (key === "last-year") range = { from: `${ty - 1}-01-01`, to: `${ty - 1}-12-31` };
  else if (lastDays) {
    const n = Number(lastDays[1]);
    if (n < 1) return null;
    range = { from: addDays(today, -(n - 1)), to: today };
  } else if (/^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split("-").map(Number) as [number, number];
    if (m < 1 || m > 12) return null;
    range = { from: iso(y, m, 1), to: iso(y, m, lastDayOfMonth(y, m)) };
  } else {
    const [from, to = from] = key.split("..") as [string, string?];
    if (!validDate(from) || !validDate(to)) return null;
    range = { from, to };
  }
  if (range.from > range.to || dayCount(range.from, range.to) > MAX_PERIOD_DAYS) return null;
  return range;
}

function validDate(date: string): boolean {
  const [y, m, d] = parts(date);
  return m >= 1 && m <= 12 && d >= 1 && d <= lastDayOfMonth(y, m);
}

/** A range that ends after today, ended at today (null when it starts after today). */
export function upToToday(range: { from: string; to: string }, today: string): { from: string; to: string } | null {
  if (range.from > today) return null;
  return { from: range.from, to: range.to > today ? today : range.to };
}

/**
 * What a period is compared with. `last-year`: the same dates a year earlier. `previous`: like for like where the key is
 * a calendar period (this month so far against the same days of last month, last week against the week before, a month
 * against the month before), otherwise the same number of days just before.
 */
export function comparisonRange(key: string, range: { from: string; to: string }, mode: CompareMode): { from: string; to: string } {
  if (mode === "last-year") return { from: addMonths(range.from, -12), to: addMonths(range.to, -12) };
  if (key === "this-week" || key === "last-week") return { from: addDays(range.from, -7), to: addDays(range.to, -7) };
  const wholeMonths = range.from === monthStart(range.from) && range.to === monthEnd(range.to);
  if (key === "this-month" || key === "last-month" || /^\d{4}-\d{2}$/.test(key) || wholeMonths) {
    const months = monthIndex(range.to) - monthIndex(range.from) + 1;
    const from = addMonths(range.from, -months);
    // Up to the same day of the month (the month before may be shorter); a whole month against the whole month before.
    const to = range.to === monthEnd(range.to) ? monthEnd(addMonths(range.to, -months)) : addMonths(range.to, -months);
    return { from, to };
  }
  if (key === "this-year" || key === "last-year") return { from: addMonths(range.from, -12), to: addMonths(range.to, -12) };
  const days = dayCount(range.from, range.to);
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

const monthIndex = (date: string) => {
  const [y, m] = parts(date);
  return y * 12 + m;
};

// ---- words ------------------------------------------------------------------------------------------------------------

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Month words: English (full and short) and Filipino. */
const MONTH_WORDS: Record<string, number> = {};
for (const [i, name] of MONTH_NAMES.entries()) {
  MONTH_WORDS[name.toLowerCase()] = i + 1;
  MONTH_WORDS[name.slice(0, 3).toLowerCase()] = i + 1;
}
Object.assign(MONTH_WORDS, {
  sept: 9,
  enero: 1,
  pebrero: 2,
  marso: 3,
  abril: 4,
  mayo: 5,
  hunyo: 6,
  hulyo: 7,
  agosto: 8,
  setyembre: 9,
  oktubre: 10,
  nobyembre: 11,
  disyembre: 12,
});
const MONTH = `(${Object.keys(MONTH_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|")})\\.?`;

/** "15 November 2026", "1–15 November 2026", "1 October – 15 November 2026". */
export function formatRange(from: string, to: string): string {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  const day = (y: number, m: number, d: number) => `${d} ${MONTH_NAMES[m - 1]} ${y}`;
  if (from === to) return day(fy, fm, fd);
  if (fy === ty && fm === tm) return `${fd}–${td} ${MONTH_NAMES[fm - 1]} ${fy}`;
  if (fy === ty) return `${fd} ${MONTH_NAMES[fm - 1]} – ${day(ty, tm, td)}`;
  return `${day(fy, fm, fd)} – ${day(ty, tm, td)}`;
}

/** A key in words: "Last week", "October 2026", "15 November 2026". */
export function periodLabel(key: string): string {
  const fixed: Record<string, string> = {
    today: "Today",
    yesterday: "Yesterday",
    tomorrow: "Tomorrow",
    "this-week": "This week",
    "last-week": "Last week",
    "this-month": "This month",
    "last-month": "Last month",
    "this-year": "This year",
    "last-year": "Last year",
  };
  if (fixed[key]) return fixed[key];
  const lastDays = /^last-(\d{1,3})-days$/.exec(key);
  if (lastDays) return lastDays[1] === "1" ? "Today" : `Last ${lastDays[1]} days`;
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split("-").map(Number) as [number, number];
    return `${MONTH_NAMES[m - 1]} ${y}`;
  }
  const [from, to = from] = key.split("..") as [string, string?];
  return formatRange(from, to);
}

export function compareLabel(mode: CompareMode): string {
  return mode === "last-year" ? "the same dates last year" : "the period before";
}

// ---- reading what was typed -------------------------------------------------------------------------------------------

/** Lower case, accents removed, dashes made plain, spaces collapsed. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/[^a-z0-9\-/.,\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ReadPeriod {
  /** The period named, as a key. */
  period?: string;
  /** "vs last month", "compared to last year". */
  compare?: CompareMode;
  /** "now", "right now", "currently": the person wants the state at this moment. */
  now: boolean;
  /** "all facilities", "whole organization". */
  allFacilities: boolean;
  /** What is left once the period, comparison and scope words are taken out, for matching the question. */
  rest: string;
}

const COMPARE = /\b(?:vs|versus|compared (?:to|with)|against|kumpara sa)\b\.?/;
const LAST_YEAR = /\b(?:last year|a year ago|year before|previous year|same (?:time|period|dates) last year|noong nakaraang taon)\b/;
/** What follows "vs": the period compared with ("last month", "the same time last year", "the month before"). */
const COMPARE_TARGET =
  /^\s*(?:(?:the )?same (?:time|period|dates|days|month|week) )?(?:(?:last|previous|past|this|the) (?:week|month|year|period|quarter)(?: before)?|a year ago|the (?:year|month|week|period) before|before|noong nakaraang (?:taon|buwan|linggo))\b/;
const NOW = /\b(?:right now|now|currently|at the moment|at present)\b/;
const ALL_FACILITIES =
  /\b(?:all (?:the )?(?:facilities|clinics|branches|sites)|every (?:facility|clinic|branch)|whole organi[sz]ation|organi[sz]ation[- ]wide|everywhere|lahat ng (?:clinic|sangay))\b/;

/** Reads the period, comparison, "now" and scope words out of a question. */
export function readPeriod(text: string, today: string): ReadPeriod {
  let rest = ` ${normalizeText(text)} `;
  const take = (re: RegExp): RegExpExecArray | null => {
    const match = re.exec(rest);
    if (match) rest = `${rest.slice(0, match.index)} ${rest.slice(match.index + match[0].length)}`;
    return match;
  };

  const allFacilities = take(ALL_FACILITIES) !== null;
  let compare: CompareMode | undefined;
  const split = COMPARE.exec(rest);
  if (split) {
    const after = rest.slice(split.index + split[0].length);
    compare = LAST_YEAR.test(after) ? "last-year" : "previous";
    // The period compared with is the comparison's, not the question's: take it out, keep any words after it.
    const target = COMPARE_TARGET.exec(after);
    rest = `${rest.slice(0, split.index)} ${target ? after.slice(target[0].length) : after}`;
  }
  const period = takePeriod(take, today);
  const now = take(NOW) !== null;
  return { period, compare, now, allFacilities, rest: rest.replace(/\s+/g, " ").trim() };
}

/** "2026-11-15", "nov 15", "15 nov", "november 15, 2026", "15 nobyembre 2026". */
const DATE = `(?:(\\d{4})-(\\d{2})-(\\d{2})|${MONTH}\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?|(\\d{1,2})\\s+${MONTH}(?:,?\\s+(\\d{4}))?)`;
const DATE_RE = new RegExp(`^${DATE}$`);

function dateOf(text: string, today: string): string | null {
  const m = DATE_RE.exec(text.trim());
  if (!m) return null;
  if (m[1]) return validDate(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  const month = MONTH_WORDS[(m[4] ?? m[8])!]!;
  const day = Number(m[5] ?? m[7]);
  const year = m[6] ?? m[9];
  return dayInYear(month, day, year ? Number(year) : undefined, today);
}

/** A day named without a year: this year's, or last year's when this year's is more than six months ahead. */
function dayInYear(month: number, day: number, year: number | undefined, today: string): string | null {
  const [ty] = parts(today);
  const y = year ?? ty;
  if (day < 1 || day > lastDayOfMonth(y, month)) return null;
  const date = iso(y, month, day);
  return year === undefined && date > addMonths(today, 6) ? iso(y - 1, month, Math.min(day, lastDayOfMonth(y - 1, month))) : date;
}

/** A month named without a year: the latest one not after this month. */
function monthKey(month: number, year: number | undefined, today: string): string {
  const [ty, tm] = parts(today);
  const y = year ?? (month > tm ? ty - 1 : ty);
  return `${y}-${String(month).padStart(2, "0")}`;
}

function takePeriod(take: (re: RegExp) => RegExpExecArray | null, today: string): string | undefined {
  // A range of days or months: "from 1 nov to 15 nov", "between oct 1 and oct 15", "nov 1 to 15", "1-15 nov", "march to may".
  const range = take(new RegExp(`\\b(?:from |between )?(${DATE})\\s*(?:to|until|till|and|-)\\s*(${DATE})(?=\\s|$)`));
  if (range) {
    const from = dateOf(range[1]!, today);
    const to = dateOf(range[11]!, today);
    if (from && to) return from <= to ? `${from}..${to}` : `${addMonths(from, -12)}..${to}`;
  }
  const sameMonth = take(new RegExp(`\\b(?:from |between )?${MONTH}\\s+(\\d{1,2})\\s*(?:to|until|till|and|-)\\s*(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`));
  if (sameMonth) {
    const month = MONTH_WORDS[sameMonth[1]!]!;
    const year = sameMonth[4] ? Number(sameMonth[4]) : undefined;
    const from = dayInYear(month, Number(sameMonth[2]), year, today);
    const to = from ? iso(Number(from.slice(0, 4)), month, Number(sameMonth[3])) : null;
    if (from && to && validDate(to) && from <= to) return `${from}..${to}`;
  }
  const daysOfMonth = take(new RegExp(`\\b(?:from |between )?(\\d{1,2})\\s*(?:to|until|till|and|-)\\s*(\\d{1,2})\\s+${MONTH}(?:,?\\s+(\\d{4}))?\\b`));
  if (daysOfMonth) {
    const month = MONTH_WORDS[daysOfMonth[3]!]!;
    const year = daysOfMonth[4] ? Number(daysOfMonth[4]) : undefined;
    const from = dayInYear(month, Number(daysOfMonth[1]), year, today);
    const to = from ? iso(Number(from.slice(0, 4)), month, Number(daysOfMonth[2])) : null;
    if (from && to && validDate(to) && from <= to) return `${from}..${to}`;
  }
  const months = take(new RegExp(`\\b(?:from |between )?${MONTH}(?:\\s+(\\d{4}))?\\s*(?:to|until|till|and|-)\\s*${MONTH}(?:\\s+(\\d{4}))?\\b`));
  if (months) {
    const first = monthKey(MONTH_WORDS[months[1]!]!, months[2] ? Number(months[2]) : undefined, today);
    const last = monthKey(MONTH_WORDS[months[3]!]!, months[4] ? Number(months[4]) : undefined, today);
    const from = `${first}-01`;
    const to = monthEnd(`${last}-01`);
    if (from <= to) return `${from}..${to}`;
  }

  const lastN = take(/\b(?:the )?(?:last|past|previous) (\d{1,3}) (day|week|month)s?\b/);
  if (lastN) {
    const n = Number(lastN[1]);
    const days = lastN[2] === "day" ? n : lastN[2] === "week" ? n * 7 : dayCount(addDays(addMonths(today, -n), 1), today);
    if (days >= 1 && days <= MAX_PERIOD_DAYS) return `last-${days}-days`;
  }
  const relative = take(/\b(this|last|previous|past) (week|month|year)\b/);
  if (relative) return `${relative[1] === "this" ? "this" : "last"}-${relative[2]}`;
  if (take(/\b(?:year to date|ytd|so far this year)\b/)) return "this-year";

  const single = take(new RegExp(`\\b(?:on |for )?${DATE}(?=\\s|$)`));
  if (single) {
    const date = dateOf(single[0].replace(/^(?:on|for) /, ""), today);
    if (date) return date;
  }
  // A month alone; "may" is a month only after a word that introduces a time ("in may") or before a year.
  const month = take(
    new RegExp(
      `\\b(?:(?:in|for|during|of|since|noong|nung) )?(?!may\\b(?!\\s+\\d{4}))${MONTH}(?:\\s+(\\d{4}))?\\b|\\b(?:in|for|during|of|since|noong|nung) (may)\\b`,
    ),
  );
  if (month) {
    const word = (month[1] ?? month[3])!;
    return monthKey(MONTH_WORDS[word]!, month[2] ? Number(month[2]) : undefined, today);
  }
  if (take(/\b(?:today|ngayong araw|ngayon)\b/)) return "today";
  if (take(/\b(?:yesterday|kahapon)\b/)) return "yesterday";
  if (take(/\b(?:tomorrow|bukas)\b/)) return "tomorrow";
  return undefined;
}
