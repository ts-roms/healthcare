import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { YAKAP_REGISTRATION_STATUSES } from "./philhealth.schema";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const yakapParticipationSchema = z
  .object({
    /** As issued by PhilHealth (its format is not known to the platform). */
    participationReference: z.string().trim().min(1).max(60),
    validFrom: isoDate.optional(),
    validUntil: isoDate.optional(),
    /** Required when replacing a recorded reference (optimistic locking). */
    version: z.number().int().positive().optional(),
  })
  .refine((v) => !v.validFrom || !v.validUntil || v.validUntil >= v.validFrom, { message: "Valid until is before valid from", path: ["validUntil"] });
export class YakapParticipationDto extends createZodDto(yakapParticipationSchema) {}

export const listYakapRegistrationsSchema = z.object({ patientId: z.uuid() });
export class ListYakapRegistrationsDto extends createZodDto(listYakapRegistrationsSchema) {}

export const recordYakapRegistrationSchema = z
  .object({
    patientId: z.uuid(),
    /** PhilHealth's answer as staff read it from PhilHealth's own channel, in the platform's neutral vocabulary. */
    status: z.enum(YAKAP_REGISTRATION_STATUSES),
    /** The effective date PhilHealth gave, if any. */
    effectiveDate: isoDate.optional(),
    /** The reference PhilHealth's channel gave (required unless the answer is "unknown"). */
    reference: z.string().trim().min(1).max(80).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status === "unknown" || !!v.reference, { message: "Enter the reference PhilHealth's channel gave", path: ["reference"] });
export class RecordYakapRegistrationDto extends createZodDto(recordYakapRegistrationSchema) {}

export const submitYakapSchema = z.object({
  /** One per submission attempt the user makes, so a retried request is one exchange. */
  idempotencyKey: z.string().trim().min(8).max(100),
});
export class SubmitYakapDto extends createZodDto(submitYakapSchema) {}
