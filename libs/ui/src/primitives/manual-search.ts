import { headingSlug } from "./markdown";

/** One searchable section of the manual: a heading and the text under it, with where it is shown. */
export interface ManualSection {
  /** The chapter's slug ("" when the manual is one page) and title. */
  chapter: string;
  chapterTitle: string;
  /** The section's heading (the chapter title for text before its first section). */
  heading: string;
  /** Where the section is shown: `<base>/<chapter>#<anchor>`, or `#<anchor>` when the manual is one page. */
  href: string;
  /** The section's text, Markdown marks stripped. */
  text: string;
}

export interface ManualHit extends ManualSection {
  /** A short passage around the first match, for the result list. */
  snippet: string;
  score: number;
}

/** Markdown to plain words: headings' marks, emphasis, code ticks, links (keep the text), table pipes. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#|]/g, " ")
    .replace(/^\s*-{3,}\s*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits chapters into sections at their `##`/`###` headings. The text before a chapter's first heading is a section
 * of its own under the chapter's title. Headings keep the anchor the Markdown view gives them (`headingSlug`).
 */
export function manualSections(chapters: ReadonlyArray<{ slug: string; title: string; source: string }>, base = "/help"): ManualSection[] {
  const sections: ManualSection[] = [];
  for (const chapter of chapters) {
    const body = chapter.source.replace(/^#\s+.+\r?\n/m, "");
    const page = chapter.slug ? `${base}/${chapter.slug}` : "";
    const parts = body.split(/^(?=#{2,3}\s)/m);
    for (const part of parts) {
      const heading = /^#{2,3}\s+(.+?)\s*$/m.exec(part)?.[1];
      const text = plainText(heading ? part.replace(/^#{2,3}\s+.+\r?\n/m, "") : part);
      if (!heading && !text) continue;
      sections.push({
        chapter: chapter.slug,
        chapterTitle: chapter.title,
        heading: heading ?? chapter.title,
        href: heading ? `${page}#${headingSlug(heading)}` : page || "#",
        text,
      });
    }
  }
  return sections;
}

const SNIPPET_RADIUS = 90;

/**
 * Sections whose heading or text contains every word of the query (case-insensitive), best first: heading matches
 * before text matches, then by how often the words occur, then in manual order. At most `limit` hits.
 */
export function searchManual(sections: readonly ManualSection[], query: string, limit = 20): ManualHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits: ManualHit[] = [];
  sections.forEach((section, order) => {
    const heading = section.heading.toLowerCase();
    const text = section.text.toLowerCase();
    if (!words.every((w) => heading.includes(w) || text.includes(w))) return;
    const inHeading = words.filter((w) => heading.includes(w)).length;
    const occurrences = words.reduce((n, w) => n + text.split(w).length - 1, 0);
    const first = Math.min(...words.map((w) => text.indexOf(w)).filter((i) => i >= 0), Number.POSITIVE_INFINITY);
    hits.push({
      ...section,
      snippet: snippetAround(section.text, Number.isFinite(first) ? first : 0),
      score: inHeading * 1000 + occurrences * 10 - order / 10_000,
    });
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function snippetAround(text: string, index: number): string {
  if (text.length <= SNIPPET_RADIUS * 2) return text;
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}
