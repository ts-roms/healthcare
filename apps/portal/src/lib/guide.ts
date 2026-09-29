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

/** Links inside the guide: anchors on the page stay; links to the staff chapters of the manual become text. */
export function guideHref(href: string): string | null {
  return href.startsWith("#") || /^https?:/.test(href) ? href : null;
}
