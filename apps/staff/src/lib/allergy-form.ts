import { z } from "zod";
import type { AllergyRecord, AllergySummary } from "./api/types";

/**
 * Allergy recording helpers. The API (`libs/clinic` triage service) validates
 * and audits every change; these give field-level errors and decide which
 * actions to offer. Allergies are never edited in place: a wrong entry is
 * marked "entered in error" (with a reason) and recorded again.
 */

export const CATEGORY_LABEL: Record<AllergyRecord["category"], string> = {
  medication: "Medication",
  food: "Food",
  environment: "Environment",
  biologic: "Biologic / vaccine",
  other: "Other",
};

export const allergyFormSchema = z.object({
  category: z.enum(["medication", "food", "environment", "biologic", "other"]),
  substance: z.string().trim().min(1, "Name the substance").max(200),
  reaction: z
    .string()
    .trim()
    .max(500)
    .transform((v) => v || undefined),
  severity: z.enum(["", "mild", "moderate", "severe"]).transform((v) => v || undefined),
  criticality: z.enum(["low", "high", "unable_to_assess"]),
  verification: z.enum(["unconfirmed", "confirmed"]),
});
export type AllergyForm = z.input<typeof allergyFormSchema>;
export type AllergyPayload = z.output<typeof allergyFormSchema>;

export const BLANK_ALLERGY: AllergyForm = {
  category: "medication",
  substance: "",
  reaction: "",
  severity: "",
  criticality: "unable_to_assess",
  verification: "unconfirmed",
};

export type AllergyStatusChange = "resolved" | "inactive" | "entered_in_error";

export const STATUS_CHANGE_LABEL: Record<AllergyStatusChange, string> = {
  resolved: "Resolved",
  inactive: "No longer relevant",
  entered_in_error: "Entered in error",
};

/** What the review line says; "not reviewed" is never presented as "no allergies". */
export function reviewState(summary: Pick<AllergySummary, "status" | "allergies">): {
  tone: "warning" | "success" | "neutral";
  text: string;
  /** "Confirm no known allergies" is offered only when nothing active is recorded. */
  canConfirmNone: boolean;
} {
  if (summary.status === "not_reviewed") return { tone: "warning", text: "Allergies not recorded — ask the patient", canConfirmNone: true };
  if (summary.status === "no_known_allergies") return { tone: "success", text: "No known allergies (reviewed)", canConfirmNone: false };
  return { tone: "neutral", text: `${summary.allergies.length} active allerg${summary.allergies.length === 1 ? "y" : "ies"}`, canConfirmNone: false };
}
