/** Sections of the manual's MyHealth chapter that are for clinic staff, not patients. */
const STAFF_SECTIONS = ["For clinic staff", "Related chapters"];

/**
 * The patient-facing part of the manual's MyHealth chapter: without its title (the page shows one) and without
 * the sections written for staff.
 */
export function patientGuide(source: string): string {
  const sections = source.replace(/^#\s+.+\r?\n/m, "").split(/^(?=## )/m);
  return sections
    .filter((section) => !STAFF_SECTIONS.some((title) => section.startsWith(`## ${title}`)))
    .join("")
    .trim();
}

/**
 * The "For patients" questions of the manual's glossary-and-FAQ chapter, as a section of the guide ("Frequently asked
 * questions"); empty when the chapter has none. Questions keep their numbers from the manual.
 */
export function patientFaq(source: string): string {
  const match = /^### For patients\r?\n([\s\S]*?)(?=^## |^### |(?![\s\S]))/m.exec(source);
  const body = match?.[1]?.trim();
  return body ? `## Frequently asked questions\n\n${body}` : "";
}

/** The guide with the patient FAQ appended (when there is one). */
export function patientGuideWithFaq(chapter: string, faqChapter: string): string {
  const faq = patientFaq(faqChapter);
  return faq ? `${patientGuide(chapter)}\n\n${faq}` : patientGuide(chapter);
}

/** Links inside the guide: anchors on the page stay; links to the staff chapters of the manual become text. */
export function guideHref(href: string): string | null {
  return href.startsWith("#") || /^https?:/.test(href) ? href : null;
}
