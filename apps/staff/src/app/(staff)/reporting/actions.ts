"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { CaseReportDetail, DohFacilityCode, DohRescan, ReportableRule } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const id = z.uuid();
const version = z.number().int().positive();

async function run<T>(schema: z.ZodType, input: unknown, call: () => Promise<T>, paths: string[]): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const result = await actionResult(call);
  if (result.ok) for (const path of paths) revalidatePath(path);
  return result;
}

const reportedSchema = z.object({ caseReportId: id, reference: z.string().trim().min(1, "Enter the reference DOH's channel gave.").max(80), version });
export async function recordReported(input: z.input<typeof reportedSchema>) {
  const { caseReportId, ...body } = input;
  return run(reportedSchema, input, () => api<CaseReportDetail>(`/doh/case-reports/${caseReportId}/reported`, { method: "POST", body }), [
    "/reporting",
    `/reporting/${caseReportId}`,
  ]);
}

const dismissSchema = z.object({ caseReportId: id, reason: z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500), version });
export async function dismissCase(input: z.input<typeof dismissSchema>) {
  const { caseReportId, ...body } = input;
  return run(dismissSchema, input, () => api<CaseReportDetail>(`/doh/case-reports/${caseReportId}/dismiss`, { method: "POST", body }), [
    "/reporting",
    `/reporting/${caseReportId}`,
  ]);
}

const submitSchema = z.object({ caseReportId: id, idempotencyKey: z.string().min(8).max(100), version });
/** Refused by the API while DOH reporting is an integration dependency (no official specification). */
export async function submitCase(input: z.input<typeof submitSchema>) {
  const { caseReportId, ...body } = input;
  return run(submitSchema, input, () => api<CaseReportDetail>(`/doh/case-reports/${caseReportId}/submissions`, { method: "POST", body }), [
    "/reporting",
    `/reporting/${caseReportId}`,
  ]);
}

const ruleSchema = z.object({
  codePrefix: z.string().trim().min(2, "Enter an ICD-10 code or prefix, e.g. A90.").max(8),
  category: z.string().trim().min(1, "Name the category.").max(120),
  sourceNote: z.string().trim().max(500).optional(),
  reportWithinDays: z.number().int().min(1, "Report within at least 1 day.").max(365).optional(),
});
export async function createRule(input: z.input<typeof ruleSchema>) {
  return run(ruleSchema, input, () => api<ReportableRule>("/doh/rules", { method: "POST", body: input }), ["/reporting/settings"]);
}

const ruleIdSchema = z.object({ ruleId: id });
export async function deactivateRule(input: z.input<typeof ruleIdSchema>) {
  return run(ruleIdSchema, input, () => api<ReportableRule>(`/doh/rules/${input.ruleId}/deactivate`, { method: "POST" }), ["/reporting/settings"]);
}

const facilityCodeSchema = z.object({ facilityId: id, facilityCode: z.string().trim().min(1, "Enter the code.").max(40), version: version.optional() });
export async function recordFacilityCode(input: z.input<typeof facilityCodeSchema>) {
  const { facilityId, ...body } = input;
  return run(facilityCodeSchema, input, () => api<DohFacilityCode>(`/doh/facilities/${facilityId}/facility-code`, { method: "PUT", body }), [
    "/reporting/settings",
  ]);
}

const calendarDate = z.iso.date("Choose a date.");
const rescanSchema = z.object({ from: calendarDate, to: calendarDate });
/** Checks diagnoses recorded in the range (at most 90 days) against the active rules; the API runs it in the background. */
export async function requestRescan(input: z.input<typeof rescanSchema>) {
  return run(rescanSchema, input, () => api<DohRescan>("/doh/rescans", { method: "POST", body: input }), ["/reporting/settings", "/reporting"]);
}
