/**
 * Word matching for assistant rules (docs/domains/assistant.md): plain tokens, no model. Text is lower-cased, accents
 * removed, split on anything that is not a letter or digit, and common English and Filipino words dropped. A trailing
 * plural "s" is removed from longer words so "infections" meets "infection". That is the whole of it.
 */

const STOPWORDS = new Set([
  // English
  "and",
  "the",
  "for",
  "with",
  "without",
  "from",
  "due",
  "not",
  "other",
  "unspecified",
  "specified",
  "of",
  "in",
  "on",
  "to",
  "or",
  "by",
  "at",
  "as",
  "an",
  "is",
  "are",
  "was",
  "has",
  "had",
  "may",
  "per",
  "type",
  "site",
  // Filipino
  "ang",
  "ng",
  "sa",
  "na",
  "at",
  "mga",
  "si",
  "ni",
  "kay",
  "may",
  "pa",
  "po",
]);

/** The distinct meaningful words of a text. */
export function wordsOf(text: string): Set<string> {
  const out = new Set<string>();
  const plain = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  for (const raw of plain.split(/[^a-z0-9]+/)) {
    if (raw.length < 3 && !/^\d+$/.test(raw)) continue;
    if (STOPWORDS.has(raw)) continue;
    out.add(raw.length > 4 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw);
  }
  return out;
}

export interface WordMatch {
  /** Words of the candidate found in the text. */
  matched: string[];
  /** Share of the candidate's words found in the text (0–1). */
  coverage: number;
}

/** How much of `candidate` (e.g. a code's description) the `text` covers. */
export function matchWords(text: Set<string>, candidate: Set<string>): WordMatch {
  if (candidate.size === 0) return { matched: [], coverage: 0 };
  const matched = [...candidate].filter((w) => text.has(w));
  return { matched, coverage: matched.length / candidate.size };
}
