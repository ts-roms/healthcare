import { z } from "zod";
import {
  ALLERGY_OVERRIDE_MIN_REASON,
  findAllergyConflict,
  isValidOverrideReason,
  type Allergy,
  type PrescriptionItem,
  type PrescriptionSubmission,
} from "@healthcare/domain";

const itemSchema = z.object({
  id: z.string(),
  drug: z.string().min(1, "Required"),
  strength: z.string().min(1, "Required"),
  form: z.string().min(1, "Required"),
  sig: z.string().min(3, "Enter directions"),
  quantity: z.coerce.number<number>().int().positive("Must be > 0"),
  refills: z.coerce.number<number>().int().min(0).max(11),
  /** Documented reason for prescribing despite an allergy conflict. */
  overrideReason: z.string().optional(),
});

/**
 * Form schema for a set of recorded allergies: a line that conflicts with an
 * allergy needs a documented override reason (or a different drug) to sign.
 */
export function createPrescriptionSchema(allergies: readonly Allergy[]) {
  return z.object({ items: z.array(itemSchema).min(1, "Add at least one medication") }).superRefine((value, ctx) => {
    value.items.forEach((item, index) => {
      if (findAllergyConflict(item.drug, allergies) && !isValidOverrideReason(item.overrideReason)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "overrideReason"],
          message: `Allergy conflict: change the drug or document an override reason (at least ${ALLERGY_OVERRIDE_MIN_REASON} characters).`,
        });
      }
    });
  });
}

export const prescriptionSchema = createPrescriptionSchema([]);
export type PrescriptionFormValues = z.infer<typeof prescriptionSchema>;

/** Splits validated form values into prescription items and the allergy overrides to audit. */
export function toPrescriptionSubmission(values: PrescriptionFormValues, allergies: readonly Allergy[]): PrescriptionSubmission {
  const items: PrescriptionItem[] = [];
  const allergyOverrides: PrescriptionSubmission["allergyOverrides"] = [];
  for (const { overrideReason, ...item } of values.items) {
    items.push(item);
    const conflict = findAllergyConflict(item.drug, allergies);
    if (conflict) {
      allergyOverrides.push({
        prescriptionItemId: item.id,
        drug: item.drug,
        allergyId: conflict.allergy.id,
        substance: conflict.allergy.substance,
        matchedTerm: conflict.matchedTerm,
        reason: overrideReason?.trim() ?? "",
      });
    }
  }
  return { items, allergyOverrides };
}
