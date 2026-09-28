"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { LabEqaScheme, LabEqaSurvey, LabNonconformanceDetail, LabStorageUnit, LabTemperatureReading } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const id = z.uuid();
const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Code: 2–49 lowercase letters, digits or hyphens.");
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);
const text = (max: number, message: string) => z.string().trim().min(3, message).max(max);
const celsius = z.number({ error: "Give the temperature in °C." }).finite();

function invalid(error: z.ZodError): { ok: false; message: string } {
  return { ok: false, message: error.issues[0]?.message ?? "Invalid request." };
}

// ---- Temperatures ------------------------------------------------------------------------------

const unitSchema = z.object({
  code,
  name: z.string().trim().min(1, "Name the unit.").max(120),
  kind: z.enum(["refrigerator", "freezer", "incubator", "water_bath", "room", "other"]),
  minCelsius: celsius,
  maxCelsius: celsius,
  readingIntervalHours: z.number().int().min(1).max(168).optional(),
});
export async function createStorageUnit(input: z.input<typeof unitSchema>): Promise<ActionResult<LabStorageUnit>> {
  const parsed = unitSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<LabStorageUnit>("/laboratory/storage-units", { method: "POST", body: parsed.data }));
}

const unitStatusSchema = z.object({ unitId: id, status: z.enum(["active", "retired"]), reason: text(500, "Say why."), version: z.number().int().positive() });
export async function setStorageUnitStatus(input: z.input<typeof unitStatusSchema>): Promise<ActionResult<LabStorageUnit>> {
  const parsed = unitStatusSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { unitId, ...body } = parsed.data;
  return actionResult(() => api<LabStorageUnit>(`/laboratory/storage-units/${unitId}`, { method: "PATCH", body }));
}

const readingSchema = z.object({ unitId: id, celsius, note: optional(1000) });
export async function recordTemperature(input: z.input<typeof readingSchema>): Promise<ActionResult<LabTemperatureReading>> {
  const parsed = readingSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { unitId, ...body } = parsed.data;
  return actionResult(() => api<LabTemperatureReading>(`/laboratory/storage-units/${unitId}/readings`, { method: "POST", body }));
}

export async function loadTemperatureReadings(unitId: string, days = 31): Promise<ActionResult<LabTemperatureReading[]>> {
  if (!id.safeParse(unitId).success) return { ok: false, message: "Invalid request." };
  return actionResult(() => api<LabTemperatureReading[]>(`/laboratory/storage-units/${unitId}/readings`, { query: { days } }));
}

// ---- Nonconformance -------------------------------------------------------------------------------

const categories = [
  "pre_analytical",
  "analytical",
  "post_analytical",
  "equipment",
  "temperature_excursion",
  "qc_failure",
  "eqa_failure",
  "safety",
  "complaint",
  "other",
] as const;
const reportSchema = z.object({
  category: z.enum(categories),
  severity: z.enum(["minor", "major", "critical"]),
  title: text(200, "Give a short title."),
  description: text(4000, "Describe what happened."),
  instrumentId: id.optional(),
  specimenAccession: optional(40),
});
export async function reportNonconformance(input: z.input<typeof reportSchema>): Promise<ActionResult<LabNonconformanceDetail>> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<LabNonconformanceDetail>("/laboratory/nonconformances", { method: "POST", body: parsed.data }));
}

const entrySchema = z.object({
  id,
  kind: z.enum(["note", "correction", "root_cause", "corrective_action", "preventive_action", "effectiveness_check"]),
  body: text(4000, "Write at least a few words."),
});
export async function addNonconformanceEntry(input: z.input<typeof entrySchema>): Promise<ActionResult<LabNonconformanceDetail>> {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { id: ncId, ...body } = parsed.data;
  return actionResult(() => api<LabNonconformanceDetail>(`/laboratory/nonconformances/${ncId}/entries`, { method: "POST", body }));
}

const reclassifySchema = z.object({
  id,
  category: z.enum(categories).optional(),
  severity: z.enum(["minor", "major", "critical"]).optional(),
  reason: text(500, "Say why."),
  version: z.number().int().positive(),
});
export async function reclassifyNonconformance(input: z.input<typeof reclassifySchema>): Promise<ActionResult<LabNonconformanceDetail>> {
  const parsed = reclassifySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { id: ncId, ...body } = parsed.data;
  return actionResult(() => api<LabNonconformanceDetail>(`/laboratory/nonconformances/${ncId}/reclassify`, { method: "POST", body }));
}

const closeSchema = z.object({ id, summary: text(2000, "Summarize the outcome."), version: z.number().int().positive() });
export async function closeNonconformance(input: z.input<typeof closeSchema>): Promise<ActionResult<LabNonconformanceDetail>> {
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { id: ncId, ...body } = parsed.data;
  return actionResult(() => api<LabNonconformanceDetail>(`/laboratory/nonconformances/${ncId}/close`, { method: "POST", body }));
}

// ---- EQA -------------------------------------------------------------------------------------------

const schemeSchema = z.object({
  code,
  provider: z.string().trim().min(1, "Name the provider.").max(200),
  name: z.string().trim().min(1, "Name the scheme.").max(200),
});
export async function createEqaScheme(input: z.input<typeof schemeSchema>): Promise<ActionResult<LabEqaScheme>> {
  const parsed = schemeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<LabEqaScheme>("/laboratory/eqa/schemes", { method: "POST", body: parsed.data }));
}

const surveySchema = z.object({
  schemeId: id,
  roundCode: z.string().trim().min(1, "Give the round.").max(60),
  receivedOn: z.iso.date("Give the date received."),
  dueOn: z.iso.date().optional(),
});
export async function createEqaSurvey(input: z.input<typeof surveySchema>): Promise<ActionResult<LabEqaSurvey>> {
  const parsed = surveySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<LabEqaSurvey>("/laboratory/eqa/surveys", { method: "POST", body: parsed.data }));
}

const eqaResultSchema = z.object({
  surveyId: id,
  testId: id,
  sampleCode: z.string().trim().min(1, "Give the sample code.").max(60),
  reportedValue: z.string().trim().min(1, "Give the value reported.").max(200),
});
export async function reportEqaResult(input: z.input<typeof eqaResultSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = eqaResultSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { surveyId, ...body } = parsed.data;
  return actionResult(() => api<{ id: string }>(`/laboratory/eqa/surveys/${surveyId}/results`, { method: "POST", body }));
}

const evaluationSchema = z.object({
  resultId: id,
  evaluation: z.enum(["acceptable", "unacceptable", "not_graded"]),
  targetValue: optional(200),
  providerScore: optional(60),
  note: optional(1000),
});
export async function recordEqaEvaluation(input: z.input<typeof evaluationSchema>): Promise<ActionResult<{ nonconformanceId: string | null }>> {
  const parsed = evaluationSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { resultId, ...body } = parsed.data;
  return actionResult(() => api<{ nonconformanceId: string | null }>(`/laboratory/eqa/results/${resultId}/evaluation`, { method: "POST", body }));
}

// ---- Competency ------------------------------------------------------------------------------------

const competencySchema = z.object({
  userId: id,
  testId: id.optional(),
  departmentId: id.optional(),
  method: z.enum(["direct_observation", "blind_sample", "record_review", "written_assessment", "other"]),
  outcome: z.enum(["competent", "not_yet_competent"]),
  assessedOn: z.iso.date("Give the assessment date."),
  nextDueOn: z.iso.date().optional(),
  notes: optional(2000),
});
export async function recordCompetency(input: z.input<typeof competencySchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = competencySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<{ id: string }>("/laboratory/competency", { method: "POST", body: parsed.data }));
}
