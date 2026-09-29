import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { INSTRUMENT_EVENT_KINDS, MANUAL_REAGENT_USE_KINDS } from "../laboratory.schema";

const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Use 2–49 lowercase letters, digits or hyphens");
const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.iso.date();

// ---- Instruments ----------------------------------------------------------------------------

const instrumentFields = {
  name: text(120),
  departmentId: z.uuid().nullable().optional(),
  manufacturer: text(120).nullable().optional(),
  model: text(120).nullable().optional(),
  serialNumber: text(120).nullable().optional(),
};

export const createInstrumentSchema = z.object({ code, ...instrumentFields });
export class CreateInstrumentDto extends createZodDto(createInstrumentSchema) {}

export const updateInstrumentSchema = z.object({ ...z.object(instrumentFields).partial().shape, version: z.number().int().positive() });
export class UpdateInstrumentDto extends createZodDto(updateInstrumentSchema) {}

export const instrumentEventSchema = z.object({
  kind: z.enum(INSTRUMENT_EVENT_KINDS),
  outcome: z.enum(["pass", "fail"]).optional(),
  /** When the work was done; defaults to now. */
  performedAt: z.iso.datetime({ offset: true }).optional(),
  nextDueOn: isoDate.optional(),
  notes: text(2000).optional(),
});
export class InstrumentEventDto extends createZodDto(instrumentEventSchema) {}

export const instrumentQuerySchema = z.object({ includeRetired: z.enum(["true", "false"]).optional() });
export class InstrumentQueryDto extends createZodDto(instrumentQuerySchema) {}

// ---- QC materials, lots, targets ------------------------------------------------------------

export const createQcMaterialSchema = z.object({ code, name: text(120), level: text(60), manufacturer: text(120).optional() });
export class CreateQcMaterialDto extends createZodDto(createQcMaterialSchema) {}

export const createQcLotSchema = z.object({ lotNumber: text(60), expiresOn: isoDate });
export class CreateQcLotDto extends createZodDto(createQcLotSchema) {}

export const addQcTargetSchema = z.object({
  testId: z.uuid(),
  instrumentId: z.uuid(),
  mean: z.number().finite(),
  sd: z.number().finite().positive(),
  /** Where the target comes from, e.g. "Manufacturer insert" or "Own data, 20 runs". */
  source: text(200).optional(),
});
export class AddQcTargetDto extends createZodDto(addQcTargetSchema) {}

// ---- Reagent lots ---------------------------------------------------------------------------

export const loadReagentSchema = z.object({
  /** The inventory lot (a reagent item's lot) loaded on the instrument. */
  inventoryLotId: z.uuid(),
  /** Only for this test; left out: every test on the instrument. */
  testId: z.uuid().optional(),
  /** Take this quantity of the lot from a storage location of the facility (an inventory issue in the same transaction). */
  takeFromStock: z.object({ locationId: z.uuid(), quantity: z.number().int().positive().max(100_000) }).optional(),
  /** Tests the load holds; left out: the stock taken times the reagent's yield, when both are known. */
  capacityTests: z.number().int().positive().max(100_000_000).optional(),
});
export class LoadReagentDto extends createZodDto(loadReagentSchema) {}

export const unloadReagentSchema = z.object({ reason: text(500).refine((v) => v.length >= 3, "Say why the lot is unloaded") });
export class UnloadReagentDto extends createZodDto(unloadReagentSchema) {}

export const reagentQuerySchema = z.object({ instrumentId: z.uuid().optional() });
export class ReagentQueryDto extends createZodDto(reagentQuerySchema) {}

// ---- Reagent use per test run (migration 0064) ----------------------------------------------

export const recordReagentUseSchema = z.object({
  /** Patient and QC runs are counted when results and QC runs are entered. */
  kind: z.enum(MANUAL_REAGENT_USE_KINDS),
  tests: z.number().int().positive().max(100_000),
  reason: text(500).refine((v) => v.length >= 3, "Say what the reagent was used for"),
});
export class RecordReagentUseDto extends createZodDto(recordReagentUseSchema) {}

export const setReagentYieldSchema = z.object({ testsPerUnit: z.number().int().positive().max(1_000_000) });
export class SetReagentYieldDto extends createZodDto(setReagentYieldSchema) {}

/** Tests one run of a test uses from a reagent; 1 (the default) removes the setting. */
export const setTestsPerRunSchema = z.object({ testsPerRun: z.number().int().min(1).max(100) });
export class SetTestsPerRunDto extends createZodDto(setTestsPerRunSchema) {}

export const reagentUsageQuerySchema = z.object({ from: isoDate, to: isoDate, instrumentId: z.uuid().optional() });
export class ReagentUsageQueryDto extends createZodDto(reagentUsageQuerySchema) {}

// ---- QC runs --------------------------------------------------------------------------------

export const recordQcRunSchema = z.object({
  instrumentId: z.uuid(),
  testId: z.uuid(),
  qcLotId: z.uuid(),
  value: z.number().finite(),
  /** When the control was measured; defaults to now. */
  runAt: z.iso.datetime({ offset: true }).optional(),
  comment: text(1000).optional(),
});
export class RecordQcRunDto extends createZodDto(recordQcRunSchema) {}

export const qcRunQuerySchema = z.object({
  instrumentId: z.uuid(),
  testId: z.uuid(),
  qcLotId: z.uuid().optional(),
  days: z.coerce.number().int().min(1).max(365).default(31),
});
export class QcRunQueryDto extends createZodDto(qcRunQuerySchema) {}

export const qcActionSchema = z.object({ action: text(2000).refine((v) => v.length >= 3, "Describe the cause and what was done") });
export class QcActionDto extends createZodDto(qcActionSchema) {}
