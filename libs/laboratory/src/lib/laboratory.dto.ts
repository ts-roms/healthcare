import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { COMMUNICATION_METHODS, ORDER_PRIORITIES, ORDER_SOURCES, QC_REJECT_RULES, RESULT_TYPES } from "./laboratory.schema";

const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Use 2–49 lowercase letters, digits or hyphens");
const text = (max: number) => z.string().trim().min(1).max(max);
const reason = z.string().trim().min(3).max(500);
const status = z.enum(["active", "inactive"]);

// ---- Catalog --------------------------------------------------------------------------------

export const createDepartmentSchema = z.object({ code, name: text(120) });
export class CreateDepartmentDto extends createZodDto(createDepartmentSchema) {}

export const updateCatalogEntrySchema = z.object({ name: text(120).optional(), status: status.optional(), version: z.number().int().positive() });
export class UpdateCatalogEntryDto extends createZodDto(updateCatalogEntrySchema) {}

export const createSpecimenTypeSchema = z.object({
  code,
  name: text(120),
  container: text(120).optional(),
  collectionInstructions: text(1000).optional(),
});
export class CreateSpecimenTypeDto extends createZodDto(createSpecimenTypeSchema) {}

const testFields = {
  name: text(160),
  departmentId: z.uuid(),
  specimenTypeId: z.uuid(),
  loincCode: z
    .string()
    .trim()
    .regex(/^[0-9]{1,7}-[0-9]$/, "LOINC codes look like 4548-4")
    .optional(),
  unit: text(30).optional(),
  decimalPlaces: z.number().int().min(0).max(6).optional(),
  codedValues: z.array(text(60)).max(30).optional(),
  abnormalCodedValues: z.array(text(60)).max(30).optional(),
  turnaroundMinutes: z
    .number()
    .int()
    .positive()
    .max(60 * 24 * 90)
    .optional(),
  requiresFasting: z.boolean().optional(),
  patientReleasable: z.boolean().optional(),
  collectionInstructions: text(1000).optional(),
};

export const createTestSchema = z
  .object({ code, resultType: z.enum(RESULT_TYPES), ...testFields })
  .refine((v) => v.resultType !== "coded" || (v.codedValues?.length ?? 0) > 0, { message: "List the allowed coded values", path: ["codedValues"] })
  .refine((v) => v.resultType === "coded" || !v.codedValues?.length, { message: "Only coded tests have coded values", path: ["codedValues"] })
  .refine((v) => (v.abnormalCodedValues ?? []).every((a) => v.codedValues?.includes(a)), {
    message: "Abnormal values must be among the coded values",
    path: ["abnormalCodedValues"],
  })
  .refine((v) => v.resultType === "numeric" || v.decimalPlaces === undefined, { message: "Only numeric tests have decimal places", path: ["decimalPlaces"] });
export class CreateTestDto extends createZodDto(createTestSchema) {}

export const updateTestSchema = z.object({
  name: testFields.name.optional(),
  loincCode: testFields.loincCode.nullable(),
  unit: testFields.unit.nullable(),
  turnaroundMinutes: testFields.turnaroundMinutes.nullable(),
  requiresFasting: z.boolean().optional(),
  patientReleasable: z.boolean().optional(),
  collectionInstructions: testFields.collectionInstructions.nullable(),
  status: status.optional(),
  version: z.number().int().positive(),
});
export class UpdateTestDto extends createZodDto(updateTestSchema) {}

export const addReferenceRangeSchema = z
  .object({
    sex: z.enum(["male", "female"]).nullable().default(null),
    ageMinDays: z.number().int().min(0).default(0),
    ageMaxDays: z.number().int().positive().nullable().default(null),
    low: z.number().nullable().default(null),
    high: z.number().nullable().default(null),
    criticalLow: z.number().nullable().default(null),
    criticalHigh: z.number().nullable().default(null),
    textRange: text(200).nullable().default(null),
    /** Defaults to now. Ranges cannot start in the past: history keeps the range that applied. */
    effectiveFrom: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((v) => v.ageMaxDays === null || v.ageMaxDays > v.ageMinDays, { message: "The age band is empty", path: ["ageMaxDays"] })
  .refine((v) => v.low === null || v.high === null || v.low <= v.high, { message: "Low must not exceed high", path: ["high"] })
  .refine((v) => v.criticalLow === null || v.low === null || v.criticalLow <= v.low, { message: "Critical low must be at or below low", path: ["criticalLow"] })
  .refine((v) => v.criticalHigh === null || v.high === null || v.criticalHigh >= v.high, {
    message: "Critical high must be at or above high",
    path: ["criticalHigh"],
  })
  .refine((v) => v.low !== null || v.high !== null || v.criticalLow !== null || v.criticalHigh !== null || v.textRange !== null, {
    message: "Give limits or a text range",
  });
export class AddReferenceRangeDto extends createZodDto(addReferenceRangeSchema) {}

export const createPanelSchema = z.object({ code, name: text(120), testIds: z.array(z.uuid()).min(1).max(60) });
export class CreatePanelDto extends createZodDto(createPanelSchema) {}

export const facilityPolicySchema = z.object({
  allowSelfVerification: z.boolean(),
  allowSelfApproval: z.boolean(),
  releaseOnApproval: z.boolean(),
  /** Quality control (left out: unchanged). Which Westgard rules reject a run; 1_2s is always a warning. */
  qcRejectRules: z
    .array(z.enum(QC_REJECT_RULES))
    .max(QC_REJECT_RULES.length)
    .transform((rules) => [...new Set(rules)])
    .optional(),
  /** How long a QC run covers patient results on its instrument and test. */
  qcValidHours: z.number().int().min(1).max(168).optional(),
  /** Results entered on an instrument need QC within the window whose latest run is not rejected. */
  qcRequired: z.boolean().optional(),
  /** Why the policy changes (audited). */
  reason,
});
export class FacilityPolicyDto extends createZodDto(facilityPolicySchema) {}

export const catalogQuerySchema = z.object({ includeInactive: z.enum(["true", "false"]).optional() });
export class CatalogQueryDto extends createZodDto(catalogQuerySchema) {}

// ---- Orders and specimens -------------------------------------------------------------------

export const createOrderSchema = z
  .object({
    patientId: z.uuid(),
    /** Orders from a consultation reference its (in-progress) encounter. */
    encounterId: z.uuid().optional(),
    source: z.enum(ORDER_SOURCES).optional(),
    externalOrderer: text(200).optional(),
    testIds: z.array(z.uuid()).max(60).default([]),
    panelIds: z.array(z.uuid()).max(20).default([]),
    priority: z.enum(ORDER_PRIORITIES).default("routine"),
    scheduledFor: z.iso.datetime({ offset: true }).optional(),
    clinicalIndication: text(1000).optional(),
    notes: text(2000).optional(),
  })
  .refine((v) => v.testIds.length + v.panelIds.length > 0, { message: "Choose at least one test or panel", path: ["testIds"] })
  .refine((v) => v.priority !== "scheduled" || v.scheduledFor, { message: "Give the scheduled time", path: ["scheduledFor"] });
export class CreateOrderDto extends createZodDto(createOrderSchema) {}

export const listOrdersSchema = z
  .object({
    patientId: z.uuid().optional(),
    encounterId: z.uuid().optional(),
    status: z.enum(["active", "completed", "cancelled"]).optional(),
  })
  .refine((v) => v.patientId || v.encounterId, { message: "Provide patientId or encounterId" });
export class ListOrdersDto extends createZodDto(listOrdersSchema) {}

export const cancelSchema = z.object({ reason });
export class CancelDto extends createZodDto(cancelSchema) {}

export const collectSpecimenSchema = z.object({
  specimenTypeId: z.uuid(),
  itemIds: z.array(z.uuid()).min(1).max(60),
  /** When the specimen was taken, if not now (e.g. recorded after a home collection). Not in the future. */
  collectedAt: z.iso.datetime({ offset: true }).optional(),
});
export class CollectSpecimenDto extends createZodDto(collectSpecimenSchema) {}

export const rejectSpecimenSchema = z.object({ reason, requestRecollection: z.boolean().default(true) });
export class RejectSpecimenDto extends createZodDto(rejectSpecimenSchema) {}

export const WORKLIST_STAGES = ["collect", "receive", "enter", "verify", "approve", "release"] as const;
export const worklistSchema = z.object({
  stage: z.enum(WORKLIST_STAGES),
  departmentId: z.uuid().optional(),
});
export class WorklistDto extends createZodDto(worklistSchema) {}

// ---- Results --------------------------------------------------------------------------------

const resultValue = {
  valueNumeric: z.number().finite().optional(),
  valueText: text(4000).optional(),
  valueCoded: text(60).optional(),
  comment: text(2000).optional(),
  method: text(120).optional(),
  instrument: text(120).optional(),
  /** The registered instrument that produced the value: links the QC in force (and may be refused by the QC policy). */
  instrumentId: z.uuid().optional(),
};

export const enterResultSchema = z.object({ ...resultValue });
export class EnterResultDto extends createZodDto(enterResultSchema) {}

export const correctResultSchema = z.object({ ...resultValue, reason });
export class CorrectResultDto extends createZodDto(correctResultSchema) {}

export const communicateCriticalSchema = z.object({
  communicatedTo: text(200),
  method: z.enum(COMMUNICATION_METHODS),
  readBackConfirmed: z.boolean(),
  note: text(1000).optional(),
});
export class CommunicateCriticalDto extends createZodDto(communicateCriticalSchema) {}

export const criticalQuerySchema = z.object({ status: z.enum(["open", "communicated", "acknowledged", "unacknowledged"]).default("unacknowledged") });
export class CriticalQueryDto extends createZodDto(criticalQuerySchema) {}

export const trendQuerySchema = z.object({ testId: z.uuid() });
export class TrendQueryDto extends createZodDto(trendQuerySchema) {}

export type ResultValueInput = z.infer<typeof enterResultSchema>;

// ---- Labels ---------------------------------------------------------------------------------

export const labelQuerySchema = z.object({ copies: z.coerce.number().int().min(1).max(10).default(1) });
export class LabelQueryDto extends createZodDto(labelQuerySchema) {}
