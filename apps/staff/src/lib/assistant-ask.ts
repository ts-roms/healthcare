import type { AskCompare, AskHistoryItem, AskInterpretation, AskNoteCode, AskScope } from "./api/types";

/**
 * Addresses of the assistant's Ask page (docs/domains/assistant.md, "Ask"; ADR-0019). An answer's address names the
 * catalogue question, its period, comparison and scope: never the words typed, which go to the API in a request body
 * and are dropped there. The API checks every value again.
 */

export const ASK_HOME = "/assistant/ask";

/** The period, comparison and scope read from a question. */
export interface AskReading {
  period?: string;
  compare?: AskCompare;
  scope?: AskScope;
}

export interface AskParams extends AskReading {
  questionId: string;
  notes?: AskNoteCode[];
}

const QUESTION_ID = /^[a-z0-9][a-z0-9.-]{1,80}$/;
const PERIOD = /^[a-z0-9.-]{1,40}$/;
const COMPARES: readonly AskCompare[] = ["previous", "last-year"];
const NOTES: readonly AskNoteCode[] = ["period-not-applicable", "day-only", "not-comparable"];
/** Questions offered at most when a typed question fits several. */
const MAX_CHOICES = 5;

function withReading(query: URLSearchParams, r: AskReading): string {
  if (r.period) query.set("period", r.period);
  if (r.compare) query.set("compare", r.compare);
  if (r.scope === "organization") query.set("scope", "all");
  return `${ASK_HOME}?${query.toString()}`;
}

/** The address of an answer. */
export function askHref(p: AskParams): string {
  const query = new URLSearchParams({ question: p.questionId });
  if (p.notes && p.notes.length > 0) query.set("notes", p.notes.join(","));
  return withReading(query, p);
}

/**
 * Where the reading of a typed question leads: its answer, or a choice between questions. Null when nothing was
 * recognised: the question box says so and keeps the words for another try.
 */
export function hrefForInterpretation(read: AskInterpretation): string | null {
  if (read.kind === "question")
    return askHref({ questionId: read.questionId, period: read.period, compare: read.compare, scope: read.scope, notes: read.notes });
  if (read.kind === "ambiguous") return withReading(new URLSearchParams({ choose: read.candidates.map((c) => c.id).join(",") }), read);
  return null;
}

type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function readReading(search: Search): AskReading {
  const period = one(search["period"]);
  const compare = one(search["compare"]) as AskCompare | undefined;
  return {
    ...(period && PERIOD.test(period) ? { period } : {}),
    ...(compare && COMPARES.includes(compare) ? { compare } : {}),
    ...(one(search["scope"]) === "all" ? { scope: "organization" as const } : {}),
  };
}

/** The answer an address asks for; null when it asks none or names something that is not a question. */
export function readAskParams(search: Search): AskParams | null {
  const questionId = one(search["question"]);
  if (!questionId || !QUESTION_ID.test(questionId)) return null;
  const notes = (one(search["notes"]) ?? "").split(",").filter((n): n is AskNoteCode => (NOTES as readonly string[]).includes(n));
  return { questionId, ...readReading(search), ...(notes.length > 0 ? { notes } : {}) };
}

/** The questions offered when a typed question fitted more than one, with the period read for whichever is chosen. */
export function readChoice(search: Search): { questionIds: string[]; reading: AskReading } {
  const questionIds = (one(search["choose"]) ?? "")
    .split(",")
    .filter((id) => QUESTION_ID.test(id))
    .slice(0, MAX_CHOICES);
  return { questionIds, reading: readReading(search) };
}

/** The address an entry of "Your questions" asks again. */
export function hrefForEntry(entry: AskHistoryItem): string {
  return askHref({ questionId: entry.questionId, period: entry.period ?? undefined, compare: entry.compare ?? undefined, scope: entry.scope });
}
