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

/**
 * The chapter about a staff screen, by route prefix (longest first), for the help dialog's "About this screen" link:
 * the slug of a `docs/manual` chapter, or null where no chapter fits (the manual itself, unknown routes).
 */
const CHAPTER_BY_ROUTE: [prefix: string, slug: string][] = [
  ["/laboratory/qc", "laboratory-quality"],
  ["/laboratory/instruments", "laboratory-quality"],
  ["/laboratory/reagents", "laboratory-quality"],
  ["/laboratory/temperatures", "laboratory-quality"],
  ["/laboratory/nonconformances", "laboratory-quality"],
  ["/laboratory/eqa", "laboratory-quality"],
  ["/laboratory/competency", "laboratory-quality"],
  ["/laboratory/licence", "laboratory-quality"],
  ["/laboratory", "laboratory"],
  ["/patients", "patients"],
  ["/appointments", "appointments-and-queue"],
  ["/queue", "appointments-and-queue"],
  ["/calendar", "appointments-and-queue"],
  ["/doctors", "appointments-and-queue"],
  ["/clinic", "consultations-and-care-plans"],
  ["/telemedicine", "telemedicine"],
  ["/dental", "dental"],
  ["/pharmacy", "pharmacy-and-inventory"],
  ["/inventory", "pharmacy-and-inventory"],
  ["/billing", "billing"],
  ["/records", "records-reporting-and-integrations"],
  ["/reporting", "records-reporting-and-integrations"],
  ["/management", "records-reporting-and-integrations"],
  ["/admin/integrations", "records-reporting-and-integrations"],
  ["/messages", "records-reporting-and-integrations"],
  ["/communications", "records-reporting-and-integrations"],
  ["/outreach", "records-reporting-and-integrations"],
  ["/admin", "administration"],
  ["/account", "getting-started"],
  ["/notifications", "getting-started"],
];

export function chapterForPath(pathname: string): string | null {
  if (pathname === "/") return "getting-started";
  const match = CHAPTER_BY_ROUTE.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return match?.[1] ?? null;
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
