import { SUGGESTION_SURFACES } from "@healthcare/core";
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
});
export class SuggestionsQueryDto extends createZodDto(suggestionsQuerySchema) {}

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
