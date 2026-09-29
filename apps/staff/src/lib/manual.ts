/**
 * The user manual (`docs/manual/*.md`) shown in the app under /help. The Markdown files stay the single source:
 * they are imported as text at build time (`turbopack.rules` in next.config.ts).
 */
export interface ManualChapter {
  /** URL segment: the file name without its number and extension (`02-patients.md` → `patients`). */
  slug: string;
  file: string;
  title: string;
}

const CHAPTER_FILE = /^(\d+)-([a-z0-9-]+)\.md$/;

/** `02-patients.md` → `patients`; anything that is not a numbered chapter file → null. */
export function chapterSlug(file: string): string | null {
  return CHAPTER_FILE.exec(file)?.[2] ?? null;
}

/** The chapter's first heading without its number: `# 2. Patients` → `Patients`. */
export function chapterTitle(source: string): string {
  const heading = /^#\s+(.+)$/m.exec(source)?.[1] ?? "";
  return heading.replace(/^\d+\.\s*/, "").trim();
}

/** The Markdown after its first heading (the page header shows the title). */
export function withoutTitle(source: string): string {
  return source.replace(/^#\s+.+\r?\n/m, "").trimStart();
}

/**
 * Maps a link in the manual to an app path: other chapters → `/help/<slug>`, the index → `/help`, same-page
 * anchors and web links unchanged. Links to the developer documentation (outside the manual) are shown as text.
 */
export function manualHref(href: string, base = "/help"): string | null {
  if (href.startsWith("#") || /^https?:/.test(href)) return href;
  const [path = "", anchor] = href.split("#", 2);
  const hash = anchor ? `#${anchor}` : "";
  if (path === "README.md") return `${base}${hash}`;
  if (path.includes("/")) return null;
  const slug = chapterSlug(path);
  return slug ? `${base}/${slug}${hash}` : null;
}
