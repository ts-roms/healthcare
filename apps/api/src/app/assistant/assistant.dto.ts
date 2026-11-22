import { SUGGESTION_SURFACES } from "@healthcare/core";
import { FREQUENCIES } from "@healthcare/prescription";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const suggestionsQuerySchema = z.object({
  surface: z.enum(SUGGESTION_SURFACES),
  /** The day the screen shows (the appointments board); today otherwise. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
    .optional(),
  /** The consultation a consultation screen shows (surface `encounter`). */
  encounterId: z.string().uuid().optional(),
  /** The patient a patient screen shows (surface `dental`). */
  patientId: z.string().uuid().optional(),
  /** The prescription the dispense screen shows (surface `pharmacy`). */
  prescriptionId: z.string().uuid().optional(),
});
export class SuggestionsQueryDto extends createZodDto(suggestionsQuerySchema) {}

/** The Assistant section's overview: several screens in one request (comma-separated; every surface when left out). */
export const overviewQuerySchema = z.object({
  surfaces: z
    .string()
    .max(400)
    .optional()
    .transform((value) => (value ? value.split(",").map((s) => s.trim()) : [...SUGGESTION_SURFACES]))
    .pipe(z.array(z.enum(SUGGESTION_SURFACES)).min(1).max(SUGGESTION_SURFACES.length)),
  /** The most suggestions answered per surface (the rest are counted in `more`). */
  limit: z.coerce.number().int().min(1).max(20).optional(),
});
export class OverviewQueryDto extends createZodDto(overviewQuerySchema) {}

/** A medicine as written in a prescription being drafted: only what the prescribing rules compare. */
const draftMedicineSchema = z.object({
  genericName: z.string().trim().min(1).max(200),
  brandName: z.string().trim().max(200).nullish(),
  strength: z.string().trim().max(60).nullish(),
  doseAmount: z.number().positive().max(1_000_000).nullish(),
  doseUnit: z.string().trim().max(20).nullish(),
  frequency: z.enum(FREQUENCIES),
});

/** A draft checked before it is saved: for now a prescription in a consultation (surface `prescribing`). */
export const checkSchema = z.object({
  surface: z.literal("prescribing"),
  encounterId: z.string().uuid(),
  medicines: z.array(draftMedicineSchema).min(1).max(20),
  /** When replacing a prescription: it is left out of the patient's earlier ones. */
  replacesPrescriptionId: z.string().uuid().optional(),
});
export class CheckDto extends createZodDto(checkSchema) {}

export const feedbackSchema = z.object({
  outcome: z.enum(["accepted", "dismissed", "not_useful"]),
  reason: z.string().trim().min(1).max(500).optional(),
});
export class FeedbackDto extends createZodDto(feedbackSchema) {}

export const ruleSettingSchema = z.object({
  /** Null or absent: the organization's setting. */
  facilityId: z.string().uuid().nullish(),
  enabled: z.boolean(),
  /** Checked against the rule's own parameter schema; missing: the rule's starting values. */
  parameters: z.record(z.string(), z.unknown()).optional(),
  /** The setting version the editor last read (0 for a rule never configured here); a newer one is refused. */
  expectedVersion: z.number().int().min(0),
});
export class RuleSettingDto extends createZodDto(ruleSettingSchema) {}

export const replaySchema = z.object({
  /** Default: the facility the request acts in. */
  facilityId: z.string().uuid().nullish(),
  /** Default: the setting in force there, else the rule's starting values. */
  parameters: z.record(z.string(), z.unknown()).optional(),
  days: z.number().int().min(1).max(31).default(14),
});
export class ReplayDto extends createZodDto(replaySchema) {}

export const rulesQuerySchema = z.object({ facilityId: z.string().uuid().optional() });
export class RulesQueryDto extends createZodDto(rulesQuerySchema) {}

export const insightsQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(90) });
export class InsightsQueryDto extends createZodDto(insightsQuerySchema) {}

/** The organization's review of a rule: keep it, adjust it, or retire it (turned off everywhere in the organization). */
export const ruleReviewSchema = z.object({
  outcome: z.enum(["keep", "adjust", "retire"]),
  /** What was decided and why (shown to administrators; never a patient's details). */
  note: z.string().trim().min(3).max(1000),
  /** The false positives the review found, in the reviewer's words. */
  falsePositives: z.string().trim().min(3).max(1000).optional(),
  reviewedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
});
export class RuleReviewDto extends createZodDto(ruleReviewSchema) {}
