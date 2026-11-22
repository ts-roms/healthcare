import { type CompareMode, isDayKey, readPeriod } from "./period";

/**
 * Reading a typed question for the assistant's Ask (docs/domains/assistant.md, "Ask"; ADR-0019): which question of a
 * closed catalogue it is, and the period, comparison and scope it names. Words are compared as they are, plurals made
 * singular; no model, no fuzzy guess. When two questions fit equally the person is asked which one; when none fits,
 * nothing is answered. The text is read here and dropped: nothing in this module keeps it.
 */

/** How a question reads time: not at all, the state now, one day, or a period of days. */
export type AskPeriodKind = "none" | "now" | "day" | "range";

/** A catalogue question as the reader sees it. */
export interface AskQuestionSpec {
  id: string;
  /** Word groups that must all be found; a group lists synonyms, a synonym may be several words ("no show"). */
  words: ReadonlyArray<ReadonlyArray<string>>;
  /** Word groups that make this question the better fit when found. */
  hints?: ReadonlyArray<ReadonlyArray<string>>;
  period: AskPeriodKind;
  comparable: boolean;
  /** Whether the person asking may see its answer: preferred over one they may not when both fit equally. */
  allowed: boolean;
}

/** What was read but does not apply to the question found. Codes, so they can travel without the words typed. */
export const ASK_NOTES = ["period-not-applicable", "day-only", "not-comparable"] as const;
export type AskNote = (typeof ASK_NOTES)[number];

export const ASK_NOTE_TEXT: Record<AskNote, string> = {
  "period-not-applicable": "This question is about the present, so the period you named was left out.",
  "day-only": "This question is about one day, so the period you named was left out.",
  "not-comparable": "This question is not compared with another period.",
};

export type Interpretation =
  | {
      kind: "question";
      questionId: string;
      /** The period named, when the question takes one (else the question's own default applies). */
      period?: string;
      compare?: CompareMode;
      allFacilities: boolean;
      notes: AskNote[];
    }
  | {
      kind: "ambiguous";
      questionIds: string[];
      /** As read, for whichever question the person chooses (the answer leaves out what does not apply to it). */
      period?: string;
      compare?: CompareMode;
      allFacilities: boolean;
    }
  | { kind: "unrecognised" };

/** The most characters read. */
export const MAX_QUESTION_LENGTH = 200;

/** Lower-case words, a trailing plural "s" taken off words of four letters or more ("shows" → "show", not "less"). */
export function questionWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length >= 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

function hasPhrase(words: readonly string[], phrase: string): boolean {
  const target = questionWords(phrase);
  if (target.length === 0) return false;
  for (let i = 0; i + target.length <= words.length; i += 1) {
    if (target.every((t, j) => words[i + j] === t)) return true;
  }
  return false;
}

const groupFound = (words: readonly string[], group: ReadonlyArray<string>) => group.some((synonym) => hasPhrase(words, synonym));

/**
 * Which catalogue question a text asks, against the facility's `today`. Candidates are the questions whose every word
 * group is found; a period named narrows them to questions that take one ("now" to those about the present); the most
 * groups found (hints included) wins; between equals, one the person may see wins; otherwise the person chooses.
 */
export function interpretQuestion(text: string, catalogue: readonly AskQuestionSpec[], today: string): Interpretation {
  const read = readPeriod(text.slice(0, MAX_QUESTION_LENGTH), today);
  const words = questionWords(read.rest);
  let candidates = catalogue
    .filter((q) => q.words.length > 0 && q.words.every((group) => groupFound(words, group)))
    .map((q) => ({ q, score: q.words.length + (q.hints ?? []).filter((group) => groupFound(words, group)).length }));
  if (candidates.length === 0) return { kind: "unrecognised" };

  const narrow = (keep: (q: AskQuestionSpec) => boolean) => {
    const kept = candidates.filter((c) => keep(c.q));
    if (kept.length > 0) candidates = kept;
  };
  if (read.now) narrow((q) => q.period === "now" || q.period === "none");
  else if (read.period) narrow((q) => q.period === "range" || (q.period === "day" && isDayKey(read.period!)));

  const best = Math.max(...candidates.map((c) => c.score));
  let top = candidates.filter((c) => c.score === best);
  if (top.length > 1 && top.some((c) => c.q.allowed)) top = top.filter((c) => c.q.allowed);
  if (top.length > 1) {
    return {
      kind: "ambiguous",
      questionIds: top.map((c) => c.q.id),
      ...(read.period ? { period: read.period } : {}),
      ...(read.compare ? { compare: read.compare } : {}),
      allFacilities: read.allFacilities,
    };
  }

  const question = top[0]!.q;
  const notes: AskNote[] = [];
  let period = read.period;
  if (period && (question.period === "none" || question.period === "now")) {
    notes.push("period-not-applicable");
    period = undefined;
  } else if (period && question.period === "day" && !isDayKey(period)) {
    notes.push("day-only");
    period = undefined;
  }
  let compare = read.compare;
  if (compare && !question.comparable) {
    notes.push("not-comparable");
    compare = undefined;
  }
  return {
    kind: "question",
    questionId: question.id,
    ...(period ? { period } : {}),
    ...(compare ? { compare } : {}),
    allFacilities: read.allFacilities,
    notes,
  };
}
