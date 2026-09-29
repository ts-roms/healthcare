"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type {
  LabInstrument,
  LabInstrumentLogEntry,
  LabQcLot,
  LabQcMaterial,
  LabQcRun,
  LabQcTarget,
  LabReagentLoad,
  LabReagentUse,
  LabReagentTestsPerRun,
  LabReagentYield,
} from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const id = z.uuid();
const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Code: 2–49 lowercase letters, digits or hyphens.");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

function invalid(error: z.ZodError): { ok: false; message: string } {
  return { ok: false, message: error.issues[0]?.message ?? "Invalid request." };
}

// ---- Instruments -------------------------------------------------------------------------------

const instrumentSchema = z.object({
  code,
  name: z.string().trim().min(1, "Name the instrument.").max(120),
  departmentId: id.optional(),
  manufacturer: optionalText(120),
  model: optionalText(120),
  serialNumber: optionalText(120),
});
export async function createInstrument(input: z.input<typeof instrumentSchema>): Promise<ActionResult<LabInstrument>> {
  const parsed = instrumentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<LabInstrument>("/laboratory/instruments", { method: "POST", body: parsed.data }));
}

const logSchema = z.object({
  instrumentId: id,
  kind: z.enum(["maintenance", "calibration", "repair", "verification", "out_of_service", "returned_to_service", "retired"]),
  outcome: z.enum(["pass", "fail"]).optional(),
  nextDueOn: z.iso.date().optional(),
  notes: optionalText(2000),
});
export async function logInstrument(input: z.input<typeof logSchema>): Promise<ActionResult<LabInstrumentLogEntry>> {
  const parsed = logSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { instrumentId, ...body } = parsed.data;
  return actionResult(() => api<LabInstrumentLogEntry>(`/laboratory/instruments/${instrumentId}/log`, { method: "POST", body }));
}

export async function loadInstrumentLog(instrumentId: string): Promise<ActionResult<LabInstrumentLogEntry[]>> {
  if (!id.safeParse(instrumentId).success) return { ok: false, message: "Invalid request." };
  return actionResult(() => api<LabInstrumentLogEntry[]>(`/laboratory/instruments/${instrumentId}/log`));
}

// ---- Reagent lots ------------------------------------------------------------------------------

const loadSchema = z.object({
  instrumentId: id,
  inventoryLotId: id,
  testId: id.optional(),
  takeFromStock: z.object({ locationId: id, quantity: z.number().int().positive("Enter how much is taken.") }).optional(),
  capacityTests: z.number().int().positive("Enter how many tests the lot holds.").optional(),
});
export async function loadReagentLot(input: z.input<typeof loadSchema>): Promise<ActionResult<LabReagentLoad>> {
  const parsed = loadSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { instrumentId, ...body } = parsed.data;
  return actionResult(() => api<LabReagentLoad>(`/laboratory/instruments/${instrumentId}/reagents`, { method: "POST", body }));
}

const unloadSchema = z.object({ loadId: id, reason: z.string().trim().min(3, "Say why the lot is unloaded.").max(500) });
export async function unloadReagentLot(input: z.input<typeof unloadSchema>): Promise<ActionResult<LabReagentLoad>> {
  const parsed = unloadSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<LabReagentLoad>(`/laboratory/reagents/${parsed.data.loadId}/unload`, { method: "POST", body: { reason: parsed.data.reason } }));
}

export async function loadReagentHistory(instrumentId: string): Promise<ActionResult<LabReagentLoad[]>> {
  if (!id.safeParse(instrumentId).success) return { ok: false, message: "Invalid request." };
  return actionResult(() => api<LabReagentLoad[]>(`/laboratory/instruments/${instrumentId}/reagents`));
}

// ---- Reagent use per test run ------------------------------------------------------------------

const useSchema = z.object({
  loadId: id,
  kind: z.enum(["repeat", "calibration", "priming", "waste", "other"]),
  tests: z.number().int().positive("Enter how many tests were used.").max(100_000),
  reason: z.string().trim().min(3, "Say what the reagent was used for.").max(500),
});
export async function recordReagentUse(input: z.input<typeof useSchema>): Promise<ActionResult<LabReagentLoad>> {
  const parsed = useSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { loadId, ...body } = parsed.data;
  return actionResult(() => api<LabReagentLoad>(`/laboratory/reagents/${loadId}/uses`, { method: "POST", body }));
}

export async function loadReagentUses(loadId: string): Promise<ActionResult<LabReagentUse[]>> {
  if (!id.safeParse(loadId).success) return { ok: false, message: "Invalid request." };
  return actionResult(() => api<LabReagentUse[]>(`/laboratory/reagents/${loadId}/uses`));
}

const yieldSchema = z.object({ itemId: id, testsPerUnit: z.number().int().positive("Enter the tests one unit holds.").max(1_000_000) });
export async function setReagentYield(input: z.input<typeof yieldSchema>): Promise<ActionResult<LabReagentYield>> {
  const parsed = yieldSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() =>
    api<LabReagentYield>(`/laboratory/reagents/yields/${parsed.data.itemId}`, { method: "PUT", body: { testsPerUnit: parsed.data.testsPerUnit } }),
  );
}

const testsPerRunSchema = z.object({ itemId: id, testId: id, testsPerRun: z.number().int().min(1, "At least 1.").max(100, "At most 100.") });
/** Sets how many tests one run of a test uses from a reagent; 1 (the default) removes the setting. */
export async function setReagentTestsPerRun(input: z.input<typeof testsPerRunSchema>): Promise<ActionResult<LabReagentTestsPerRun[]>> {
  const parsed = testsPerRunSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { itemId, testId, testsPerRun } = parsed.data;
  return actionResult(() => api<LabReagentTestsPerRun[]>(`/laboratory/reagents/yields/${itemId}/tests/${testId}`, { method: "PUT", body: { testsPerRun } }));
}

// ---- QC setup ----------------------------------------------------------------------------------

const materialSchema = z.object({
  code,
  name: z.string().trim().min(1).max(120),
  level: z.string().trim().min(1, "Give the level.").max(60),
  manufacturer: optionalText(120),
});
export async function createQcMaterial(input: z.input<typeof materialSchema>): Promise<ActionResult<LabQcMaterial>> {
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<LabQcMaterial>("/laboratory/qc/materials", { method: "POST", body: parsed.data }));
}

const lotSchema = z.object({
  materialId: id,
  lotNumber: z.string().trim().min(1, "Give the lot number.").max(60),
  expiresOn: z.iso.date("Give the expiry date."),
});
export async function createQcLot(input: z.input<typeof lotSchema>): Promise<ActionResult<LabQcLot>> {
  const parsed = lotSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { materialId, ...body } = parsed.data;
  return actionResult(() => api<LabQcLot>(`/laboratory/qc/materials/${materialId}/lots`, { method: "POST", body }));
}

export async function retireQcLot(lotId: string): Promise<ActionResult<LabQcLot>> {
  if (!id.safeParse(lotId).success) return { ok: false, message: "Invalid request." };
  return actionResult(() => api<LabQcLot>(`/laboratory/qc/lots/${lotId}/retire`, { method: "POST" }));
}

const targetSchema = z.object({
  qcLotId: id,
  testId: id,
  instrumentId: id,
  mean: z.number({ error: "Give the target mean." }).finite(),
  sd: z.number({ error: "Give the target SD." }).finite().positive("The SD must be above zero."),
  source: optionalText(200),
});
export async function setQcTarget(input: z.input<typeof targetSchema>): Promise<ActionResult<LabQcTarget>> {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { qcLotId, ...body } = parsed.data;
  return actionResult(() => api<LabQcTarget>(`/laboratory/qc/lots/${qcLotId}/targets`, { method: "POST", body }));
}

// ---- QC runs -----------------------------------------------------------------------------------

const runSchema = z.object({
  instrumentId: id,
  testId: id,
  qcLotId: id,
  value: z.number({ error: "Give the control value." }).finite(),
  comment: optionalText(1000),
});
export async function recordQcRun(input: z.input<typeof runSchema>): Promise<ActionResult<LabQcRun>> {
  const parsed = runSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<LabQcRun>("/laboratory/qc/runs", { method: "POST", body: parsed.data }));
}

export async function loadQcRuns(instrumentId: string, testId: string, days = 31): Promise<ActionResult<LabQcRun[]>> {
  if (!id.safeParse(instrumentId).success || !id.safeParse(testId).success) return { ok: false, message: "Invalid request." };
  return actionResult(() => api<LabQcRun[]>("/laboratory/qc/runs", { query: { instrumentId, testId, days: String(days) } }));
}

const actionSchema = z.object({ runId: id, action: z.string().trim().min(3, "Describe the cause and what was done.").max(2000) });
export async function recordQcAction(input: z.input<typeof actionSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<{ id: string }>(`/laboratory/qc/runs/${parsed.data.runId}/actions`, { method: "POST", body: { action: parsed.data.action } }));
}
