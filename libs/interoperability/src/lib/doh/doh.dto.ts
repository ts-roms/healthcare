import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { CASE_REPORT_STATUSES } from "./doh.schema";

const version = z.number().int().positive();
const reason = z.string().trim().min(3).max(500);

export const createRuleSchema = z.object({
  codePrefix: z
    .string()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .pipe(z.string().regex(/^[A-Z][0-9A-Z]{1,2}(\.[0-9A-Z]{0,4})?$/, "An ICD-10 code or code prefix, e.g. A90 or A01.0")),
  category: z.string().trim().min(1).max(120),
  /** Where the rule comes from (the issuance the organization follows). */
  sourceNote: z.string().trim().max(500).optional(),
});
export class CreateRuleDto extends createZodDto(createRuleSchema) {}

export const facilityCodeSchema = z.object({ facilityCode: z.string().trim().min(1).max(40), version: version.optional() });
export class FacilityCodeDto extends createZodDto(facilityCodeSchema) {}

export const listCasesSchema = z.object({ status: z.enum(CASE_REPORT_STATUSES).optional() });
export class ListCasesDto extends createZodDto(listCasesSchema) {}

export const recordExternalSchema = z.object({
  /** The reference the official DOH channel gave (e.g. a case or transmittal number). */
  reference: z.string().trim().min(1).max(80),
  version,
});
export class RecordExternalDto extends createZodDto(recordExternalSchema) {}

export const dismissSchema = z.object({ reason, version });
export class DismissDto extends createZodDto(dismissSchema) {}

export const submitCaseSchema = z.object({ idempotencyKey: z.string().trim().min(8).max(100), version });
export class SubmitCaseDto extends createZodDto(submitCaseSchema) {}
