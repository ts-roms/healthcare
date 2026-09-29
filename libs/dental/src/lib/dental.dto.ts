import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { isTooth } from "./dental.rules";
import { CHART_EFFECTS, IMAGE_KINDS, NOTATIONS, ORAL_HYGIENE, PERIO_SITES, PROCEDURE_SITES, SURFACES, TOOTH_CONDITIONS } from "./dental.schema";

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

/** Whether patients see their dental records in MyHealth; `version` is the current setting's (0 when never set). */
export const portalSettingSchema = z.object({
  portalDentalRecords: z.boolean(),
  /** Patients decide plan items in MyHealth (left out: unchanged). */
  portalPlanDecisions: z.boolean().optional(),
  /** The organization's own text patients confirm before deciding online (left out: unchanged). */
  portalPlanAcknowledgement: z.string().trim().min(20).max(1000).nullable().optional(),
  /** MyHealth shows fee estimates on plans (left out: unchanged). */
  portalPlanEstimates: z.boolean().optional(),
  /** The organization's own note under fee estimates (left out: unchanged; empty or null removes it). */
  feeEstimateNote: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .refine((v) => !v || v.length >= 10, "Write at least 10 characters, or leave it empty"),
  version: z.number().int().min(0),
});
export class PortalSettingDto extends createZodDto(portalSettingSchema) {}

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

// ---- periodontal charting ---------------------------------------------------------------------------

const mm = (min: number, max: number) => z.number().int().min(min).max(max).nullable().optional();

export const recordPerioChartSchema = z.object({
  encounterId: z.uuid(),
  notes: z.string().trim().max(4000).optional(),
  /** Examined teeth (teeth not listed were not examined; missing teeth belong on the odontogram). */
  teeth: z
    .array(
      z.object({
        tooth,
        mobility: mm(0, 3),
        furcation: mm(0, 3),
        sites: z
          .array(
            z.object({
              site: z.enum(PERIO_SITES),
              probingDepth: mm(0, 20),
              gingivalMargin: mm(-10, 20),
              bleeding: z.boolean().default(false),
              suppuration: z.boolean().default(false),
              plaque: z.boolean().default(false),
            }),
          )
          .max(6),
      }),
    )
    .min(1)
    .max(52),
});
export class RecordPerioChartDto extends createZodDto(recordPerioChartSchema) {}

// ---- supplies used (inventory) ------------------------------------------------------------------------

const supplyQuantity = z.number().int().min(1).max(1000);
const idempotencyKey = z.string().trim().min(8).max(100);
const supplyReference = z.string().trim().min(1).max(80);

export const supplyTemplateSchema = z.object({
  /** The supplies this procedure usually uses, in order; an empty list clears the template. */
  items: z.array(z.object({ itemId: z.uuid(), quantity: supplyQuantity })).max(30),
});
export class SupplyTemplateDto extends createZodDto(supplyTemplateSchema) {}

export const supplyLocationSchema = z.object({ locationId: z.uuid().nullable() });
export class SupplyLocationDto extends createZodDto(supplyLocationSchema) {}

export const recordSuppliesSchema = z.object({
  /** A stock location of the procedure's facility (the selected facility). */
  locationId: z.uuid(),
  lines: z
    .array(
      z.object({
        itemId: z.uuid(),
        quantity: supplyQuantity,
        /** Required with the reference for a controlled item (inventory enforces it). */
        reason: z.string().trim().min(3).max(500).optional(),
        reference: supplyReference.optional(),
      }),
    )
    .min(1)
    .max(30),
  idempotencyKey,
});
export class RecordSuppliesDto extends createZodDto(recordSuppliesSchema) {}

export const returnSuppliesSchema = z.object({
  /** Issued lines of this procedure and how much of each comes back unused. */
  lines: z
    .array(z.object({ lineId: z.uuid(), quantity: supplyQuantity }))
    .min(1)
    .max(60),
  reason: z.string().trim().min(3).max(500),
  /** Required for a controlled item (inventory enforces it). */
  reference: supplyReference.optional(),
  idempotencyKey,
});
export class ReturnSuppliesDto extends createZodDto(returnSuppliesSchema) {}

// ---- MyHealth ---------------------------------------------------------------------------------------

export const withdrawImageSchema = z.object({ reason });
export class WithdrawImageDto extends createZodDto(withdrawImageSchema) {}

export const patientPlanDecisionSchema = z.object({
  /** Items the patient accepts; every other item awaiting a decision is declined. */
  acceptedItemIds: z.array(z.uuid()).max(60),
  /** The items that were awaiting a decision when the patient looked (the plan must not have changed since). */
  awaitingItemIds: z.array(z.uuid()).min(1).max(60),
  /** The patient confirmed the organization's acknowledgement. */
  acknowledged: z.literal(true, { message: "Confirm the acknowledgement to continue" }),
  /**
   * The estimate (centavos) of the items awaiting a decision the patient was shown, when the clinic shows estimates;
   * a different current estimate means the prices changed since and nothing is decided.
   */
  estimateAwaitingDecision: z.number().int().min(0).nullable().optional(),
});
export class PatientPlanDecisionDto extends createZodDto(patientPlanDecisionSchema) {}
