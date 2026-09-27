"use server";

import { z } from "zod";
import { ApiError } from "@healthcare/web-session";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type {
  LabCatalogEntry,
  LabCriticalAlert,
  LabOrder,
  LabPanel,
  LabPolicy,
  LabReferenceRange,
  LabResult,
  LabSpecimen,
  LabTest,
  LabTrend,
} from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call
// (permissions, separation of duties, facility, result lifecycle).

const id = z.uuid();
const reason = z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500);

function invalid(error: z.ZodError): { ok: false; message: string } {
  return { ok: false, message: error.issues[0]?.message ?? "Invalid request." };
}

// ---- Orders ------------------------------------------------------------------------------------

const orderSchema = z
  .object({
    patientId: id,
    encounterId: id.optional(),
    testIds: z.array(id).max(60),
    panelIds: z.array(id).max(20),
    priority: z.enum(["routine", "stat", "scheduled"]),
    scheduledFor: z.iso.datetime({ offset: true }).optional(),
    clinicalIndication: z.string().trim().max(1000).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.testIds.length + v.panelIds.length > 0, { message: "Choose at least one test or panel." });
export async function createLabOrder(input: z.input<typeof orderSchema>, idempotencyKey: string): Promise<ActionResult<LabOrder>> {
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const body = { ...parsed.data, clinicalIndication: parsed.data.clinicalIndication || undefined, notes: parsed.data.notes || undefined };
  return actionResult(() => api<LabOrder>("/laboratory/orders", { method: "POST", body, idempotencyKey }));
}

const cancelOrderSchema = z.object({ orderId: id, itemId: id.optional(), reason });
export async function cancelLabOrder(input: z.input<typeof cancelOrderSchema>): Promise<ActionResult<LabOrder>> {
  const parsed = cancelOrderSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { orderId, itemId, reason: why } = parsed.data;
  const path = itemId ? `/laboratory/orders/${orderId}/items/${itemId}/cancel` : `/laboratory/orders/${orderId}/cancel`;
  return actionResult(() => api<LabOrder>(path, { method: "POST", body: { reason: why } }));
}

// ---- Specimens ---------------------------------------------------------------------------------

const collectSchema = z.object({ orderId: id, specimenTypeId: id, itemIds: z.array(id).min(1) });
export async function collectSpecimen(input: z.input<typeof collectSchema>, idempotencyKey: string): Promise<ActionResult<LabOrder>> {
  const parsed = collectSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { orderId, ...body } = parsed.data;
  return actionResult(() => api<LabOrder>(`/laboratory/orders/${orderId}/specimens`, { method: "POST", body, idempotencyKey }));
}

export async function receiveSpecimen(specimenId: string): Promise<ActionResult<LabSpecimen>> {
  if (!id.safeParse(specimenId).success) return { ok: false, message: "Invalid request." };
  return actionResult(() => api<LabSpecimen>(`/laboratory/specimens/${specimenId}/receive`, { method: "POST" }));
}

const rejectSchema = z.object({ specimenId: id, reason, requestRecollection: z.boolean() });
export async function rejectSpecimen(input: z.input<typeof rejectSchema>): Promise<ActionResult<LabSpecimen>> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { specimenId, ...body } = parsed.data;
  return actionResult(() => api<LabSpecimen>(`/laboratory/specimens/${specimenId}/reject`, { method: "POST", body }));
}

/** Barcode scan: the order holding this accession number at the selected facility, or null if none. */
export async function findByAccession(accession: string): Promise<ActionResult<{ specimen: LabSpecimen; order: LabOrder } | null>> {
  const code = accession.trim();
  if (!/^\d{6,20}$/.test(code)) return { ok: false, message: "Scan or type an accession number (digits only)." };
  return actionResult(async () => {
    try {
      return await api<{ specimen: LabSpecimen; order: LabOrder }>(`/laboratory/specimens/by-accession/${code}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  });
}

// ---- Results -----------------------------------------------------------------------------------

const valueSchema = z.union([
  z.object({ valueNumeric: z.number().finite() }),
  z.object({ valueText: z.string().trim().min(1).max(4000) }),
  z.object({ valueCoded: z.string().trim().min(1).max(60) }),
]);
const enterSchema = z.object({ itemId: id, value: valueSchema, comment: z.string().trim().max(2000).optional() });
export async function enterResult(input: z.input<typeof enterSchema>): Promise<ActionResult<LabResult>> {
  const parsed = enterSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { itemId, value, comment } = parsed.data;
  return actionResult(() => api<LabResult>(`/laboratory/order-items/${itemId}/results`, { method: "POST", body: { ...value, comment: comment || undefined } }));
}

const signSchema = z.object({ resultId: id, step: z.enum(["verify", "approve", "release"]) });
export async function signResult(input: z.input<typeof signSchema>): Promise<ActionResult<LabResult>> {
  const parsed = signSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<LabResult>(`/laboratory/results/${parsed.data.resultId}/${parsed.data.step}`, { method: "POST" }));
}

export async function releaseOrder(orderId: string): Promise<ActionResult<LabResult[]>> {
  if (!id.safeParse(orderId).success) return { ok: false, message: "Invalid request." };
  return actionResult(() => api<LabResult[]>(`/laboratory/orders/${orderId}/release`, { method: "POST" }));
}

const correctSchema = z.object({ resultId: id, value: valueSchema, reason, comment: z.string().trim().max(2000).optional() });
/** A corrected version supersedes the result; the old version stays in the history. */
export async function correctResult(input: z.input<typeof correctSchema>): Promise<ActionResult<LabResult>> {
  const parsed = correctSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { resultId, value, reason: why, comment } = parsed.data;
  return actionResult(() =>
    api<LabResult>(`/laboratory/results/${resultId}/correct`, { method: "POST", body: { ...value, reason: why, comment: comment || undefined } }),
  );
}

const cancelResultSchema = z.object({ resultId: id, reason });
export async function cancelResult(input: z.input<typeof cancelResultSchema>): Promise<ActionResult<LabResult>> {
  const parsed = cancelResultSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<LabResult>(`/laboratory/results/${parsed.data.resultId}/cancel`, { method: "POST", body: { reason: parsed.data.reason } }));
}

export async function resultHistory(itemId: string): Promise<ActionResult<LabResult[]>> {
  if (!id.safeParse(itemId).success) return { ok: false, message: "Invalid request." };
  return actionResult(() => api<LabResult[]>(`/laboratory/order-items/${itemId}/results`));
}

// ---- Critical results --------------------------------------------------------------------------

const communicateSchema = z.object({
  alertId: id,
  communicatedTo: z.string().trim().min(2, "Who was told?").max(200),
  method: z.enum(["phone", "in_person", "secure_message", "other"]),
  readBackConfirmed: z.boolean(),
  note: z.string().trim().max(1000).optional(),
});
export async function communicateCritical(input: z.input<typeof communicateSchema>): Promise<ActionResult<LabCriticalAlert>> {
  const parsed = communicateSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { alertId, note, ...body } = parsed.data;
  return actionResult(() =>
    api<LabCriticalAlert>(`/laboratory/critical-results/${alertId}/communicate`, { method: "POST", body: { ...body, note: note || undefined } }),
  );
}

export async function acknowledgeCritical(alertId: string): Promise<ActionResult<LabCriticalAlert>> {
  if (!id.safeParse(alertId).success) return { ok: false, message: "Invalid request." };
  return actionResult(() => api<LabCriticalAlert>(`/laboratory/critical-results/${alertId}/acknowledge`, { method: "POST" }));
}

// ---- Catalog -----------------------------------------------------------------------------------

const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Codes use 2–49 lowercase letters, digits or hyphens.");

const entrySchema = z.object({
  kind: z.enum(["departments", "specimen-types"]),
  code,
  name: z.string().trim().min(1).max(120),
  container: z.string().trim().max(120).optional(),
});
export async function createCatalogEntry(input: z.input<typeof entrySchema>): Promise<ActionResult<LabCatalogEntry>> {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { kind, container, ...body } = parsed.data;
  return actionResult(() =>
    api<LabCatalogEntry>(`/laboratory/${kind}`, { method: "POST", body: kind === "specimen-types" ? { ...body, container: container || undefined } : body }),
  );
}

const testSchema = z.object({
  code,
  name: z.string().trim().min(1).max(160),
  departmentId: id,
  specimenTypeId: id,
  resultType: z.enum(["numeric", "text", "coded"]),
  unit: z.string().trim().max(30).optional(),
  decimalPlaces: z.number().int().min(0).max(6).optional(),
  loincCode: z.string().trim().max(10).optional(),
  codedValues: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  abnormalCodedValues: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  turnaroundMinutes: z.number().int().positive().optional(),
  requiresFasting: z.boolean(),
  patientReleasable: z.boolean(),
});
export async function createLabTest(input: z.input<typeof testSchema>): Promise<ActionResult<LabTest>> {
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const body = {
    ...v,
    unit: v.unit || undefined,
    loincCode: v.loincCode || undefined,
    codedValues: v.resultType === "coded" ? v.codedValues : undefined,
    abnormalCodedValues: v.resultType === "coded" ? v.abnormalCodedValues : undefined,
    decimalPlaces: v.resultType === "numeric" ? v.decimalPlaces : undefined,
  };
  return actionResult(() => api<LabTest>("/laboratory/tests", { method: "POST", body }));
}

const rangeSchema = z.object({
  testId: id,
  sex: z.enum(["male", "female"]).nullable(),
  ageMinDays: z.number().int().min(0),
  ageMaxDays: z.number().int().positive().nullable(),
  low: z.number().nullable(),
  high: z.number().nullable(),
  criticalLow: z.number().nullable(),
  criticalHigh: z.number().nullable(),
  textRange: z.string().trim().max(200).nullable(),
});
export async function addReferenceRange(input: z.input<typeof rangeSchema>): Promise<ActionResult<LabReferenceRange>> {
  const parsed = rangeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { testId, ...body } = parsed.data;
  return actionResult(() =>
    api<LabReferenceRange>(`/laboratory/tests/${testId}/reference-ranges`, { method: "POST", body: { ...body, textRange: body.textRange || null } }),
  );
}

const panelSchema = z.object({ code, name: z.string().trim().min(1).max(120), testIds: z.array(id).min(1, "Choose the panel's tests.") });
export async function createLabPanel(input: z.input<typeof panelSchema>): Promise<ActionResult<LabPanel>> {
  const parsed = panelSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<LabPanel>("/laboratory/panels", { method: "POST", body: parsed.data }));
}

const testStatusSchema = z.object({ testId: id, status: z.enum(["active", "inactive"]), version: z.number().int().positive() });
export async function setLabTestStatus(input: z.input<typeof testStatusSchema>): Promise<ActionResult<LabTest>> {
  const parsed = testStatusSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { testId, ...body } = parsed.data;
  return actionResult(() => api<LabTest>(`/laboratory/tests/${testId}`, { method: "PATCH", body }));
}

const policySchema = z.object({ allowSelfVerification: z.boolean(), allowSelfApproval: z.boolean(), releaseOnApproval: z.boolean(), reason });
export async function setLabPolicy(input: z.input<typeof policySchema>): Promise<ActionResult<LabPolicy>> {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return actionResult(() => api<LabPolicy>("/laboratory/policy", { method: "PUT", body: parsed.data }));
}

// ---- Trends ------------------------------------------------------------------------------------

/** Released values of one analyte for a patient (audited by the API). */
export async function loadLabTrend(patientId: string, testId: string): Promise<ActionResult<LabTrend>> {
  if (!id.safeParse(patientId).success || !id.safeParse(testId).success) return { ok: false, message: "Invalid request." };
  return actionResult(() => api<LabTrend>(`/laboratory/patients/${patientId}/trends`, { query: { testId } }));
}
