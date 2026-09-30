"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import { uploadPatientDocument } from "@/lib/api/documents";
import { checkConsentFile } from "@/lib/consent-form";
import type { ImmunizationRecord, Vaccine, VaccineStockLot } from "@/lib/api/types";
import { givenFormSchema, givenPayload, type GivenForm, reportedFormSchema, reportedPayload, type ReportedForm, splitOptions } from "@/lib/immunization-form";

const uuid = z.uuid();

function refresh(patientId: string, encounterId?: string) {
  revalidatePath(`/patients/${patientId}`);
  revalidatePath(`/patients/${patientId}/immunizations`);
  if (encounterId) revalidatePath(`/clinic/encounters/${encounterId}`);
}

/** Records a dose given (or not given) at the selected facility (immunization.record); the API audits it and takes stock if chosen. */
export async function recordGivenDose(patientId: string, form: GivenForm): Promise<ActionResult<ImmunizationRecord>> {
  const parsed = givenFormSchema.safeParse(form);
  if (!uuid.safeParse(patientId).success) return { ok: false, message: "Invalid request." };
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the dose details." };
  let lots: VaccineStockLot[] = [];
  if (parsed.data.given && parsed.data.stockLotId) {
    const stock = await actionResult(() => api<VaccineStockLot[]>("/immunizations/stock"));
    if (!stock.ok) return stock;
    lots = stock.data.filter((l) => l.lotId === parsed.data.stockLotId);
    if (!lots.length) return { ok: false, message: "That lot is no longer in stock. Choose another lot or enter the lot number." };
  }
  const result = await actionResult(() =>
    api<ImmunizationRecord>(`/patients/${patientId}/immunizations`, { method: "POST", body: givenPayload(parsed.data, lots) }),
  );
  if (result.ok) refresh(patientId, parsed.data.encounterId);
  return result;
}

/** Records a dose reported by the patient or another provider. */
export async function recordReportedDose(patientId: string, form: ReportedForm): Promise<ActionResult<ImmunizationRecord>> {
  const parsed = reportedFormSchema.safeParse(form);
  if (!uuid.safeParse(patientId).success) return { ok: false, message: "Invalid request." };
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the dose details." };
  const result = await actionResult(() =>
    api<ImmunizationRecord>(`/patients/${patientId}/immunizations/historical`, { method: "POST", body: reportedPayload(parsed.data) }),
  );
  if (result.ok) refresh(patientId);
  return result;
}

/** Uploads a scan of the patient's vaccination record (a clinical attachment of the patient) to link to a reported dose. */
export async function uploadVaccinationScan(patientId: string, data: FormData): Promise<ActionResult<{ id: string; title: string }>> {
  if (!uuid.safeParse(patientId).success) return { ok: false, message: "Invalid request." };
  const file = data.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a file." };
  const problem = checkConsentFile(file);
  if (problem) return { ok: false, message: problem };
  const title = "Vaccination record (scan)";
  const result = await actionResult(() =>
    uploadPatientDocument({
      patientId,
      category: "clinical_attachment",
      title,
      file,
      idempotencyKey: String(data.get("idempotencyKey") ?? crypto.randomUUID()),
    }),
  );
  return result.ok ? { ok: true, data: { id: result.data, title } } : result;
}

const correctionSchema = z.object({
  patientId: z.uuid(),
  immunizationId: z.uuid(),
  encounterId: z.uuid().optional(),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500),
});
/** Marks a record entered in error with a reason (stock taken for it goes back); nothing is deleted. */
export async function markImmunizationInError(input: z.input<typeof correctionSchema>): Promise<ActionResult<ImmunizationRecord>> {
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { patientId, immunizationId, encounterId, reason } = parsed.data;
  const result = await actionResult(() => api<ImmunizationRecord>(`/immunizations/${immunizationId}/entered-in-error`, { method: "POST", body: { reason } }));
  if (result.ok) refresh(patientId, encounterId);
  return result;
}

const reactionSchema = z.object({
  patientId: z.uuid(),
  immunizationId: z.uuid(),
  encounterId: z.uuid().optional(),
  adverseReaction: z.string().trim().min(1, "Describe the reaction").max(1000),
});
/** Adds a reaction noticed after the dose (once). Recording an allergy is a separate decision on the patient record. */
export async function addImmunizationReaction(input: z.input<typeof reactionSchema>): Promise<ActionResult<ImmunizationRecord>> {
  const parsed = reactionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { patientId, immunizationId, encounterId, adverseReaction } = parsed.data;
  const result = await actionResult(() => api<ImmunizationRecord>(`/immunizations/${immunizationId}/reaction`, { method: "POST", body: { adverseReaction } }));
  if (result.ok) refresh(patientId, encounterId);
  return result;
}

// ---- the vaccine catalogue (clinic.configure) -------------------------------------------------------------------

const vaccineSchema = z.object({
  name: z.string().trim().min(2, "Name the vaccine").max(200),
  productName: z.string().trim().max(200),
  manufacturer: z.string().trim().max(200),
  codeSystem: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => v === "" || /^[a-z0-9][a-z0-9._-]{0,39}$/.test(v), "Use lower-case letters, digits, dots, hyphens or underscores"),
  code: z.string().trim().max(40),
  routes: z.string().max(1000),
  sites: z.string().max(2000),
  dosesInSeries: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 20), "1 to 20, or leave empty"),
});
export type VaccineForm = z.input<typeof vaccineSchema>;

function vaccineBody(v: z.output<typeof vaccineSchema>) {
  return {
    name: v.name,
    productName: v.productName || null,
    manufacturer: v.manufacturer || null,
    code: v.code || null,
    codeSystem: v.code ? v.codeSystem || "vaccine" : null,
    routes: splitOptions(v.routes),
    sites: splitOptions(v.sites),
    dosesInSeries: v.dosesInSeries ? Number(v.dosesInSeries) : null,
  };
}

export async function createVaccine(form: VaccineForm): Promise<ActionResult<Vaccine>> {
  const parsed = vaccineSchema.safeParse(form);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the vaccine details." };
  const { productName, manufacturer, code, codeSystem, dosesInSeries, ...rest } = vaccineBody(parsed.data);
  const body = {
    ...rest,
    ...(productName ? { productName } : {}),
    ...(manufacturer ? { manufacturer } : {}),
    ...(code ? { code, codeSystem } : {}),
    ...(dosesInSeries ? { dosesInSeries } : {}),
  };
  const result = await actionResult(() => api<Vaccine>("/immunizations/catalog", { method: "POST", body }));
  if (result.ok) revalidatePath("/clinic/vaccines");
  return result;
}

export async function updateVaccine(vaccineId: string, form: VaccineForm, version: number): Promise<ActionResult<Vaccine>> {
  const parsed = vaccineSchema.safeParse(form);
  if (!uuid.safeParse(vaccineId).success) return { ok: false, message: "Invalid request." };
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the vaccine details." };
  const result = await actionResult(() =>
    api<Vaccine>(`/immunizations/catalog/${vaccineId}`, { method: "PATCH", body: { ...vaccineBody(parsed.data), version } }),
  );
  revalidatePath("/clinic/vaccines");
  return result;
}

export async function setVaccineStatus(vaccineId: string, status: "active" | "inactive", version: number): Promise<ActionResult<Vaccine>> {
  if (!uuid.safeParse(vaccineId).success) return { ok: false, message: "Invalid request." };
  const result = await actionResult(() => api<Vaccine>(`/immunizations/catalog/${vaccineId}`, { method: "PATCH", body: { status, version } }));
  revalidatePath("/clinic/vaccines");
  return result;
}
