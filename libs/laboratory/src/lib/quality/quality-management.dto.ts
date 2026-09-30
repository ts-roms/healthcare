import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import {
  COMPETENCY_METHODS,
  EQA_EVALUATIONS,
  NONCONFORMANCE_CATEGORIES,
  NONCONFORMANCE_ENTRY_KINDS,
  NONCONFORMANCE_SEVERITIES,
  STORAGE_UNIT_KINDS,
} from "./quality-management.schema";

const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Use 2–49 lowercase letters, digits or hyphens");
const text = (max: number) => z.string().trim().min(1).max(max);
const longText = (max: number) => z.string().trim().min(3).max(max);
const celsius = z.number().finite().min(-273.15).max(1000);
const version = z.number().int().positive();

// ---- Temperature monitoring --------------------------------------------------------------------

export const createStorageUnitSchema = z
  .object({
    code,
    name: text(120),
    kind: z.enum(STORAGE_UNIT_KINDS),
    departmentId: z.uuid().optional(),
    /** The acceptable range the laboratory set for this unit (°C). */
    minCelsius: celsius,
    maxCelsius: celsius,
    /** How often a reading is expected (hours); left out: no schedule. */
    readingIntervalHours: z.number().int().min(1).max(168).optional(),
  })
  .refine((v) => v.maxCelsius > v.minCelsius, { message: "The upper limit must be above the lower limit", path: ["maxCelsius"] });
export class CreateStorageUnitDto extends createZodDto(createStorageUnitSchema) {}

export const updateStorageUnitSchema = z.object({
  name: text(120).optional(),
  minCelsius: celsius.optional(),
  maxCelsius: celsius.optional(),
  readingIntervalHours: z.number().int().min(1).max(168).nullable().optional(),
  status: z.enum(["active", "retired"]).optional(),
  /** Why the unit changes (audited). */
  reason: longText(500),
  version,
});
export class UpdateStorageUnitDto extends createZodDto(updateStorageUnitSchema) {}

export const recordReadingSchema = z.object({
  celsius,
  /** When it was read; defaults to now. */
  readAt: z.iso.datetime({ offset: true }).optional(),
  /** Required when the reading is outside the range: what was seen and what was done immediately. */
  note: longText(1000).optional(),
});
export class RecordReadingDto extends createZodDto(recordReadingSchema) {}

export const storageUnitQuerySchema = z.object({ includeRetired: z.enum(["true", "false"]).optional() });
export class StorageUnitQueryDto extends createZodDto(storageUnitQuerySchema) {}

export const readingQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(366).default(31) });
export class ReadingQueryDto extends createZodDto(readingQuerySchema) {}

// ---- Nonconformance --------------------------------------------------------------------------------

export const createNonconformanceSchema = z.object({
  category: z.enum(NONCONFORMANCE_CATEGORIES),
  severity: z.enum(NONCONFORMANCE_SEVERITIES),
  title: longText(200),
  description: longText(4000),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  instrumentId: z.uuid().optional(),
  qcRunId: z.uuid().optional(),
  /** A specimen involved, by its accession number at the selected facility. */
  specimenAccession: text(40).optional(),
});
export class CreateNonconformanceDto extends createZodDto(createNonconformanceSchema) {}

export const nonconformanceEntrySchema = z.object({ kind: z.enum(NONCONFORMANCE_ENTRY_KINDS), body: longText(4000) });
export class NonconformanceEntryDto extends createZodDto(nonconformanceEntrySchema) {}

export const reclassifySchema = z.object({
  category: z.enum(NONCONFORMANCE_CATEGORIES).optional(),
  severity: z.enum(NONCONFORMANCE_SEVERITIES).optional(),
  reason: longText(500),
  version,
});
export class ReclassifyDto extends createZodDto(reclassifySchema) {}

export const closeNonconformanceSchema = z.object({ summary: longText(2000), version });
export class CloseNonconformanceDto extends createZodDto(closeNonconformanceSchema) {}

export const nonconformanceQuerySchema = z.object({ status: z.enum(["open", "closed", "all"]).default("open") });
export class NonconformanceQueryDto extends createZodDto(nonconformanceQuerySchema) {}

// ---- EQA ---------------------------------------------------------------------------------------------

export const createEqaSchemeSchema = z.object({ code, provider: text(200), name: text(200) });
export class CreateEqaSchemeDto extends createZodDto(createEqaSchemeSchema) {}

export const createEqaSurveySchema = z.object({ schemeId: z.uuid(), roundCode: text(60), receivedOn: z.iso.date(), dueOn: z.iso.date().optional() });
export class CreateEqaSurveyDto extends createZodDto(createEqaSurveySchema) {}

export const reportEqaResultSchema = z.object({ testId: z.uuid(), sampleCode: text(60), reportedValue: text(200) });
export class ReportEqaResultDto extends createZodDto(reportEqaResultSchema) {}

export const eqaEvaluationSchema = z.object({
  evaluation: z.enum(EQA_EVALUATIONS),
  targetValue: text(200).optional(),
  providerScore: text(60).optional(),
  note: text(1000).optional(),
});
export class EqaEvaluationDto extends createZodDto(eqaEvaluationSchema) {}

// ---- Competency ------------------------------------------------------------------------------------

export const recordCompetencySchema = z
  .object({
    userId: z.uuid(),
    /** One area: a test, or a whole department. */
    testId: z.uuid().optional(),
    departmentId: z.uuid().optional(),
    method: z.enum(COMPETENCY_METHODS),
    outcome: z.enum(["competent", "not_yet_competent"]),
    assessedOn: z.iso.date(),
    nextDueOn: z.iso.date().optional(),
    notes: text(2000).optional(),
  })
  .refine((v) => !v.testId !== !v.departmentId, { message: "Choose a test or a department", path: ["testId"] })
  .refine((v) => !v.nextDueOn || v.nextDueOn > v.assessedOn, { message: "The next assessment is due after this one", path: ["nextDueOn"] })
  .refine((v) => v.outcome === "competent" || !!v.notes, { message: "Say what is still needed (notes)", path: ["notes"] });
export class RecordCompetencyDto extends createZodDto(recordCompetencySchema) {}

// ---- Laboratory licence (0074) ------------------------------------------------------------------------------------

const optionalText = (min: number, max: number) => z.string().trim().min(min).max(max).optional();

export const recordLicenceSchema = z.object({
  /** As printed on the licence. */
  licenceNumber: z.string().trim().min(1).max(60),
  /** The classification and issuing office as written on the licence (not validated by the platform). */
  classification: optionalText(1, 120),
  issuedBy: optionalText(2, 160),
  validFrom: z.iso.date(),
  validUntil: z.iso.date(),
  headName: optionalText(2, 160),
  headLicenceNumber: optionalText(1, 40),
  /** Days before expiry the dashboard reminds (the organization's choice). */
  reminderDays: z.number().int().min(0).max(365).default(60),
});
export class RecordLicenceDto extends createZodDto(recordLicenceSchema) {}
