/**
 * Normalizes personal names for matching: removes diacritics (e.g. "Peña" →
 * "pena", "Nuñez" → "nunez"), lower-cases, and collapses punctuation/whitespace.
 */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Trims and collapses inner whitespace, preserving case and diacritics. */
export function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Upper-cases and strips separators so "1234-5678 9012" and "123456789012" match. */
export function normalizeIdentifier(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
