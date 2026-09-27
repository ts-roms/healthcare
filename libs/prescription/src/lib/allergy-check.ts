import type { AllergyWarning } from './prescription.schema';
import type { AllergyContext } from './ports';

/**
 * Drug–allergy DECISION SUPPORT (CLAUDE.md §35). A simple name match between
 * prescribed medicines and recorded medication/biologic allergies. It does
 * not know drug classes or cross-reactivity (e.g. penicillin → amoxicillin),
 * so the absence of a warning is NOT evidence of safety. Clinicians review
 * and may override with a documented reason.
 */
export function checkAllergies(
  medications: Array<{ genericName: string; brandName?: string | null }>,
  context: AllergyContext,
): AllergyWarning[] {
  const warnings: AllergyWarning[] = [];
  const relevant = context.allergies.filter((a) => a.category === 'medication' || a.category === 'biologic' || a.category === 'other');
  for (const medication of medications) {
    const names = [medication.genericName, medication.brandName].filter((n): n is string => Boolean(n)).map(tokens);
    for (const allergy of relevant) {
      const substance = tokens(allergy.substance);
      if (substance.length === 0) continue;
      if (names.some((name) => overlaps(name, substance))) {
        warnings.push({
          allergyId: allergy.id,
          substance: allergy.substance,
          medication: medication.genericName,
          criticality: allergy.criticality,
          reaction: allergy.reaction,
          basis: 'name_match',
        });
      }
    }
  }
  return warnings;
}

function tokens(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
}

const STOP_WORDS = new Set(['tablet', 'tablets', 'capsule', 'syrup', 'suspension', 'injection', 'cream', 'drops', 'sodium', 'potassium', 'hydrochloride', 'allergy']);

function overlaps(medication: string[], substance: string[]): boolean {
  return substance.some((s) => medication.some((m) => m === s || m.includes(s) || s.includes(m)));
}
