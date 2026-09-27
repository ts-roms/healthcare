import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const listEligibilitySchema = z.object({ patientId: z.uuid(), serviceDate: isoDate.optional() });
export class ListEligibilityDto extends createZodDto(listEligibilitySchema) {}

export const recordEligibilitySchema = z.object({
  patientId: z.uuid(),
  serviceDate: isoDate,
  /** PhilHealth's answer as staff read it from PhilHealth's own channel. */
  answer: z.enum(["eligible", "not_eligible", "undetermined"]),
  /** The reference PhilHealth's channel gave for the check. */
  reference: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).optional(),
});
export class RecordEligibilityDto extends createZodDto(recordEligibilitySchema) {}

export const requestEligibilitySchema = z.object({ patientId: z.uuid(), serviceDate: isoDate, idempotencyKey: z.string().trim().min(8).max(100) });
export class RequestEligibilityDto extends createZodDto(requestEligibilitySchema) {}
