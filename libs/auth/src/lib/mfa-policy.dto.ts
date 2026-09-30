import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const reason = z.string().trim().min(3).max(500);

export const mfaPolicySchema = z.object({
  required: z.boolean(),
  /** The version last read (0 before the policy was ever set). */
  version: z.number().int().min(0),
  reason: reason.optional(),
});
export class MfaPolicyDto extends createZodDto(mfaPolicySchema) {}

export const mfaExemptionSchema = z.object({ reason });
export class MfaExemptionDto extends createZodDto(mfaExemptionSchema) {}

export const mfaResetSchema = z.object({ reason });
export class MfaResetDto extends createZodDto(mfaResetSchema) {}
