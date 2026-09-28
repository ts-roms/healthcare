import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { FHIR_IMPORT_STATUSES } from "./fhir-import.schema";

const version = z.number().int().positive();
const reason = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500);

export const listImportsSchema = z.object({ status: z.enum(FHIR_IMPORT_STATUSES).optional() });
export class ListImportsDto extends createZodDto(listImportsSchema) {}

export const matchPatientSchema = z.object({ patientId: z.uuid(), version });
export class MatchPatientDto extends createZodDto(matchPatientSchema) {}

export const registerFromImportSchema = z.object({
  version,
  /** As on the registration form: the candidates that were shown and why this is a different person. */
  duplicateOverride: z.object({ reviewedCandidateIds: z.array(z.uuid()).min(1).max(20), reason: z.string().trim().min(5).max(500) }).optional(),
});
export class RegisterFromImportDto extends createZodDto(registerFromImportSchema) {}

export const rejectEntrySchema = z.object({ reason });
export class RejectEntryDto extends createZodDto(rejectEntrySchema) {}

export const rejectImportSchema = z.object({ reason, version });
export class RejectImportDto extends createZodDto(rejectImportSchema) {}
