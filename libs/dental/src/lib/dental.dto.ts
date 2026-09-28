import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { isTooth } from "./dental.rules";
import { CHART_EFFECTS, IMAGE_KINDS, NOTATIONS, ORAL_HYGIENE, PROCEDURE_SITES, SURFACES, TOOTH_CONDITIONS } from "./dental.schema";

const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Lowercase letters, digits and dashes");
const tooth = z.string().refine(isTooth, "An FDI tooth code (11–48 permanent, 51–85 primary)");
const surfaces = z.array(z.enum(SURFACES)).max(6).default([]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const reason = z.string().trim().min(5).max(500);

// ---- settings and catalog ---------------------------------------------------------------------------

export const notationSchema = z.object({ notation: z.enum(NOTATIONS) });
export class NotationDto extends createZodDto(notationSchema) {}

export const createProcedureTypeSchema = z.object({
  code,
  name: z.string().trim().min(1).max(160),
  site: z.enum(PROCEDURE_SITES),
  chartEffect: z.enum(CHART_EFFECTS).nullable().default(null),
});
export class CreateProcedureTypeDto extends createZodDto(createProcedureTypeSchema) {}

export const updateProcedureTypeSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  version: z.number().int().positive(),
});
export class UpdateProcedureTypeDto extends createZodDto(updateProcedureTypeSchema) {}

// ---- examinations -----------------------------------------------------------------------------------

export const recordExaminationSchema = z.object({
  encounterId: z.uuid(),
  oralHygiene: z.enum(ORAL_HYGIENE).optional(),
  notes: z.string().trim().max(4000).optional(),
  /** Teeth charted in this examination; teeth not listed keep their previous state. No findings means sound. */
  teeth: z
    .array(
      z.object({
        tooth,
        findings: z.array(z.object({ condition: z.enum(TOOTH_CONDITIONS), surfaces })).max(12),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .max(52),
});
export class RecordExaminationDto extends createZodDto(recordExaminationSchema) {}

export const enteredInErrorSchema = z.object({ reason });
export class EnteredInErrorDto extends createZodDto(enteredInErrorSchema) {}

// ---- treatment plans --------------------------------------------------------------------------------

const planItem = z.object({
  phase: z.number().int().min(1).max(9).default(1),
  procedureTypeId: z.uuid(),
  tooth: tooth.optional(),
  surfaces,
  note: z.string().trim().max(500).optional(),
});

export const createPlanSchema = z.object({
  patientId: z.uuid(),
  title: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(2000).optional(),
  items: z.array(planItem).min(1).max(60),
});
export class CreatePlanDto extends createZodDto(createPlanSchema) {}

export const addPlanItemSchema = planItem.extend({ version: z.number().int().positive() });
export class AddPlanItemDto extends createZodDto(addPlanItemSchema) {}

export const decidePlanSchema = z.object({
  /** Items the patient accepted; every other item awaiting a decision is declined. */
  acceptedItemIds: z.array(z.uuid()).max(60),
  /** How the patient decided (e.g. "options and fees explained; signed consent form"). */
  note: z.string().trim().min(3).max(1000),
  version: z.number().int().positive(),
});
export class DecidePlanDto extends createZodDto(decidePlanSchema) {}

export const cancelPlanItemSchema = z.object({ version: z.number().int().positive() });
export class CancelPlanItemDto extends createZodDto(cancelPlanItemSchema) {}

export const discontinuePlanSchema = z.object({ reason, version: z.number().int().positive() });
export class DiscontinuePlanDto extends createZodDto(discontinuePlanSchema) {}

// ---- procedures -------------------------------------------------------------------------------------

export const recordProcedureSchema = z.object({
  encounterId: z.uuid(),
  procedureTypeId: z.uuid(),
  tooth: tooth.optional(),
  surfaces,
  notes: z.string().trim().max(2000).optional(),
  /** The accepted treatment plan item this procedure carries out. */
  planItemId: z.uuid().optional(),
});
export class RecordProcedureDto extends createZodDto(recordProcedureSchema) {}

// ---- imaging ----------------------------------------------------------------------------------------

export const addImageSchema = z.object({
  /** An uploaded imaging document of this patient (POST /documents, category "imaging"). */
  documentId: z.uuid(),
  kind: z.enum(IMAGE_KINDS),
  teeth: z.array(tooth).max(52).default([]),
  takenOn: isoDate,
  encounterId: z.uuid().optional(),
  notes: z.string().trim().max(1000).optional(),
});
export class AddImageDto extends createZodDto(addImageSchema) {}

export const visitsQuerySchema = z.object({ date: isoDate.optional() });
export class VisitsQueryDto extends createZodDto(visitsQuerySchema) {}
