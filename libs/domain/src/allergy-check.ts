/**
 * Drug–allergy decision support (libs/clinic/CLAUDE.md, root CLAUDE.md §35).
 *
 * This is decision support, not a diagnosis: it warns, shows its evidence,
 * and the prescriber may override with a documented reason. It never blocks
 * silently.
 *
 * The class map below is a DEMO rule set. Production must use a maintained
 * drug-interaction / allergy knowledge source, configured per deployment.
 */
import type { Allergy, PrescriptionItem } from "./types";

/** Allergy substance (lower-case) → drug names or name fragments in the same cross-reactive class. */
export type AllergyClassMap = Record<string, { label: string; members: string[] }>;

export const DEMO_ALLERGY_CLASSES: AllergyClassMap = {
  penicillin: {
    label: "penicillin-class antibiotics",
    members: ["penicillin", "amoxicillin", "ampicillin", "co-amoxiclav", "piperacillin", "cloxacillin", "flucloxacillin"],
  },
  sulfonamides: {
    label: "sulfonamide antibiotics",
    members: ["sulfamethoxazole", "cotrimoxazole", "co-trimoxazole", "sulfasalazine", "sulfadiazine"],
  },
};

export interface AllergyConflict {
  allergy: Allergy;
  /** The fragment of the drug name that matched. */
  matchedTerm: string;
  /** Human-readable class, when the match came from a class rule rather than the substance name itself. */
  drugClass?: string;
  /** Where the rule came from, shown to the prescriber as evidence. */
  source: string;
}

export interface AllergyOverride {
  prescriptionItemId: string;
  drug: string;
  allergyId: string;
  substance: string;
  matchedTerm: string;
  reason: string;
}

/** A prescription as submitted for signing: items plus every documented allergy override, for the audit trail. */
export interface PrescriptionSubmission {
  items: PrescriptionItem[];
  allergyOverrides: AllergyOverride[];
}

export const ALLERGY_OVERRIDE_MIN_REASON = 10;

/** Common reasons offered as shortcuts; the prescriber can always write their own. */
export const ALLERGY_OVERRIDE_REASONS = [
  "Tolerated this drug previously without reaction",
  "Benefit outweighs risk; patient counselled and monitoring arranged",
  "Recorded allergy is intolerance, not true allergy",
] as const;

export function findAllergyConflict(
  drug: string,
  allergies: readonly Allergy[],
  classes: AllergyClassMap = DEMO_ALLERGY_CLASSES,
  source = "Demo cross-reactivity list — verify clinically",
): AllergyConflict | undefined {
  const d = drug.trim().toLowerCase();
  if (!d) return undefined;
  for (const allergy of allergies) {
    const key = allergy.substance.trim().toLowerCase();
    if (!key) continue;
    const cls = classes[key];
    const terms = cls ? cls.members : [key];
    const matchedTerm = terms.find((t) => d.includes(t));
    if (matchedTerm) {
      return { allergy, matchedTerm, drugClass: cls && matchedTerm !== key ? cls.label : undefined, source };
    }
  }
  return undefined;
}

export function isValidOverrideReason(reason: string | undefined): boolean {
  return (reason?.trim().length ?? 0) >= ALLERGY_OVERRIDE_MIN_REASON;
}
