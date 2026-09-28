import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const accreditationSchema = z
  .object({
    accreditationNumber: z.string().trim().min(1).max(40),
    validFrom: isoDate.optional(),
    validUntil: isoDate.optional(),
    /** Required when replacing a recorded number (optimistic locking). */
    version: z.number().int().positive().optional(),
  })
  .refine((v) => !v.validFrom || !v.validUntil || v.validUntil >= v.validFrom, { message: "Valid until is before valid from", path: ["validUntil"] });
export class AccreditationDto extends createZodDto(accreditationSchema) {}

export const submitClaimSchema = z.object({
  /** One per submission attempt the user makes, so a retried request is one exchange. */
  idempotencyKey: z.string().trim().min(8).max(100),
});
export class SubmitClaimDto extends createZodDto(submitClaimSchema) {}
