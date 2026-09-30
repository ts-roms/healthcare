"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { LabInstrumentInterfaceSettings } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const id = z.uuid();
const invalid = (error: z.ZodError) => ({ ok: false as const, message: error.issues[0]?.message ?? "Invalid request." });

export async function loadInterfaceSettings(instrumentId: string): Promise<ActionResult<LabInstrumentInterfaceSettings>> {
  const parsed = id.safeParse(instrumentId);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<LabInstrumentInterfaceSettings>(`/laboratory/instruments/${parsed.data}/interface`));
}

const configureSchema = z.object({
  instrumentId: id,
  protocol: z.enum(["hl7v2", "astm"]),
  specimenIdField: z.enum(["OBR-2", "OBR-3", "SPM-2", "O-3", "O-4"]),
  enabled: z.boolean(),
  version: z.number().int().positive().optional(),
});

export async function configureInterface(input: z.input<typeof configureSchema>): Promise<ActionResult<LabInstrumentInterfaceSettings>> {
  const parsed = configureSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { instrumentId, ...body } = parsed.data;
  return actionResult(() => api<LabInstrumentInterfaceSettings>(`/laboratory/instruments/${instrumentId}/interface`, { method: "PUT", body }));
}

const codeSchema = z.object({
  instrumentId: id,
  analyzerCode: z.string().trim().min(1, "Enter the analyzer's test code.").max(60),
  testId: id.nullable(),
});

export async function setAnalyzerCode(input: z.input<typeof codeSchema>): Promise<ActionResult<LabInstrumentInterfaceSettings>> {
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { instrumentId, ...body } = parsed.data;
  return actionResult(() => api<LabInstrumentInterfaceSettings>(`/laboratory/instruments/${instrumentId}/interface/test-codes`, { method: "PUT", body }));
}

export async function acceptInstrumentResult(resultId: string): Promise<ActionResult<{ id: string; resultId: string }>> {
  const parsed = id.safeParse(resultId);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<{ id: string; resultId: string }>(`/laboratory/instrument-results/${parsed.data}/accept`, { method: "POST" }));
}

const dismissSchema = z.object({ resultId: id, reason: z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500) });

export async function dismissInstrumentResult(input: z.input<typeof dismissSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = dismissSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() =>
    api<{ id: string }>(`/laboratory/instrument-results/${parsed.data.resultId}/dismiss`, { method: "POST", body: { reason: parsed.data.reason } }),
  );
}
