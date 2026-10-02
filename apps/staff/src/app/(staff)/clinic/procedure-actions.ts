"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { ClinicProcedure, ProcedureConsentWording, ProcedureDefinition, SupplyUse } from "@/lib/api/types";
import {
  type ConsentWordingForm,
  consentPayload,
  consentWordingFormSchema,
  type DefinitionForm,
  definitionFormSchema,
  procedureFormSchema,
  procedurePayload,
  type ProcedureForm,
} from "@/lib/procedure-form";

const uuid = z.uuid();

function refresh(encounterId: string | null, patientId?: string, visitId?: string | null) {
  if (encounterId) revalidatePath(`/clinic/encounters/${encounterId}`);
  if (visitId) revalidatePath(`/queue/visits/${visitId}/procedures`);
  if (patientId) {
    revalidatePath(`/patients/${patientId}`);
    revalidatePath(`/patients/${patientId}/procedures`);
    revalidatePath(`/patients/${patientId}/360`);
  }
}

/** Records a procedure performed in the consultation (encounter.write; after signing, encounter.amend and a reason). */
export async function recordProcedure(encounterId: string, patientId: string, form: ProcedureForm): Promise<ActionResult<ClinicProcedure>> {
  if (!uuid.safeParse(encounterId).success || !uuid.safeParse(patientId).success) return { ok: false, message: "Invalid request." };
  const parsed = procedureFormSchema.safeParse(form);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the procedure." };
  const result = await actionResult(() =>
    api<ClinicProcedure>(`/encounters/${encounterId}/procedures`, { method: "POST", body: procedurePayload(parsed.data) }),
  );
  if (result.ok) refresh(encounterId, patientId);
  return result;
}

/** Records a procedure performed under a queue visit without a consultation (procedure.record; entries the catalogue allows). */
export async function recordVisitProcedure(visitId: string, patientId: string, form: ProcedureForm): Promise<ActionResult<ClinicProcedure>> {
  if (!uuid.safeParse(visitId).success || !uuid.safeParse(patientId).success) return { ok: false, message: "Invalid request." };
  const parsed = procedureFormSchema.safeParse({ ...form, signed: false });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the procedure." };
  const result = await actionResult(() => api<ClinicProcedure>(`/visits/${visitId}/procedures`, { method: "POST", body: procedurePayload(parsed.data) }));
  if (result.ok) refresh(null, patientId, visitId);
  return result;
}

const inErrorSchema = z.object({
  procedureId: z.uuid(),
  encounterId: z.uuid().nullable(),
  visitId: z.uuid().nullable().optional(),
  patientId: z.uuid(),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500),
});
/** Marks a procedure entered in error with a reason; its charge, if not yet invoiced, is cancelled. */
export async function markProcedureInError(input: z.input<typeof inErrorSchema>): Promise<ActionResult<ClinicProcedure>> {
  const parsed = inErrorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { procedureId, encounterId, visitId, patientId, reason } = parsed.data;
  const result = await actionResult(() => api<ClinicProcedure>(`/procedures/${procedureId}/entered-in-error`, { method: "POST", body: { reason } }));
  if (result.ok) refresh(encounterId, patientId, visitId);
  return result;
}

const consentSchema = z.object({ procedureId: z.uuid(), encounterId: z.uuid().nullable(), visitId: z.uuid().nullable().optional(), patientId: z.uuid() });
/** Records the consent obtained for a procedure recorded without one (once). */
export async function recordProcedureConsent(input: z.input<typeof consentSchema>, form: ProcedureForm): Promise<ActionResult<ClinicProcedure>> {
  const parsed = consentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const consent = procedureFormSchema.safeParse({ ...form, definitionId: parsed.data.procedureId, consentGiven: true, consentRequired: true, signed: false });
  if (!consent.success) return { ok: false, message: consent.error.issues[0]?.message ?? "Check the consent." };
  const { procedureId, encounterId, visitId, patientId } = parsed.data;
  const result = await actionResult(() =>
    api<ClinicProcedure>(`/procedures/${procedureId}/consent`, { method: "POST", body: consentPayload(consent.data).consent }),
  );
  if (result.ok) refresh(encounterId, patientId, visitId);
  return result;
}

/** Publishes the next version of the organization's consent wording for a catalogue entry (clinic.configure). */
export async function publishConsentWording(definitionId: string, form: ConsentWordingForm): Promise<ActionResult<ProcedureConsentWording>> {
  if (!uuid.safeParse(definitionId).success) return { ok: false, message: "Invalid request." };
  const parsed = consentWordingFormSchema.safeParse(form);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the wording." };
  const result = await actionResult(() =>
    api<ProcedureConsentWording>(`/clinic/procedure-definitions/${definitionId}/consent-wordings`, { method: "POST", body: parsed.data }),
  );
  if (result.ok) revalidatePath("/clinic/procedures");
  return result;
}

/** Adds a procedure to the organization's catalogue (clinic.configure). */
export async function createProcedureDefinition(form: DefinitionForm): Promise<ActionResult<ProcedureDefinition>> {
  const parsed = definitionFormSchema.safeParse(form);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the procedure." };
  const { codeSystem, externalCode, noteTemplate, ...rest } = parsed.data;
  const result = await actionResult(() =>
    api<ProcedureDefinition>("/clinic/procedure-definitions", {
      method: "POST",
      body: { ...rest, ...(externalCode ? { codeSystem, externalCode } : {}), ...(noteTemplate ? { noteTemplate } : {}) },
    }),
  );
  if (result.ok) revalidatePath("/clinic/procedures");
  return result;
}

const updateSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  name: z.string().trim().min(2).max(200).optional(),
  codeSystem: z.string().trim().toLowerCase().max(40).nullable().optional(),
  externalCode: z.string().trim().max(40).nullable().optional(),
  requiresBodySite: z.boolean().optional(),
  consentRequired: z.boolean().optional(),
  allowedOutsideConsultation: z.boolean().optional(),
  noteTemplate: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
/** Changes a catalogue entry (its code never changes). */
export async function updateProcedureDefinition(input: z.input<typeof updateSchema>): Promise<ActionResult<ProcedureDefinition>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the procedure." };
  const { id, ...body } = parsed.data;
  const result = await actionResult(() => api<ProcedureDefinition>(`/clinic/procedure-definitions/${id}`, { method: "PATCH", body }));
  if (result.ok) revalidatePath("/clinic/procedures");
  return result;
}

// ---- supplies used (inventory) -----------------------------------------------------------------------------------

const supplyQuantity = z.number().int("Whole units only.").min(1, "Quantity of at least 1.").max(1000);
const supplyReference = z.string().trim().min(1).max(80);
const idempotencyKey = z.string().trim().min(8).max(100);

const issueSchema = z.object({
  locationId: z.uuid("Choose the stock location."),
  lines: z
    .array(
      z.object({
        itemId: z.uuid(),
        quantity: supplyQuantity,
        reason: z.string().trim().min(3, "A reason needs at least 3 characters.").max(500).optional(),
        reference: supplyReference.optional(),
      }),
    )
    .min(1, "Add at least one supply.")
    .max(30),
  idempotencyKey,
});

/** Confirms the supplies a procedure used; the API issues them from stock (FEFO, never expired lots) or refuses all. */
export async function issueProcedureSupplies(encounterId: string, procedureId: string, input: z.input<typeof issueSchema>): Promise<ActionResult<SupplyUse>> {
  const parsed = issueSchema.safeParse(input);
  if (!uuid.safeParse(encounterId).success || !uuid.safeParse(procedureId).success) return { ok: false, message: "Invalid request." };
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the supplies." };
  const result = await actionResult(() => api<SupplyUse>(`/procedures/${procedureId}/supplies`, { method: "POST", body: parsed.data }));
  if (result.ok) refresh(encounterId);
  return result;
}

const returnSchema = z.object({
  lines: z
    .array(z.object({ lineId: z.uuid(), quantity: supplyQuantity }))
    .min(1, "Choose what comes back.")
    .max(60),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500),
  reference: supplyReference.optional(),
  idempotencyKey,
});

/** Returns unused supplies of a procedure to the lots they came from. */
export async function returnProcedureSupplies(encounterId: string, procedureId: string, input: z.input<typeof returnSchema>): Promise<ActionResult<SupplyUse>> {
  const parsed = returnSchema.safeParse(input);
  if (!uuid.safeParse(encounterId).success || !uuid.safeParse(procedureId).success) return { ok: false, message: "Invalid request." };
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check what is returned." };
  const result = await actionResult(() => api<SupplyUse>(`/procedures/${procedureId}/supplies/returns`, { method: "POST", body: parsed.data }));
  if (result.ok) refresh(encounterId);
  return result;
}

const templateSchema = z.object({ items: z.array(z.object({ itemId: z.uuid("Choose a supply."), quantity: supplyQuantity })).max(30) });

/** The supplies a catalogue entry usually uses (an empty list clears the template; clinic.configure). */
export async function saveProcedureSupplyTemplate(definitionId: string, items: z.input<typeof templateSchema>["items"]): Promise<ActionResult<unknown>> {
  const parsed = templateSchema.safeParse({ items });
  if (!uuid.safeParse(definitionId).success) return { ok: false, message: "Invalid request." };
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the supplies." };
  const result = await actionResult(() => api(`/clinic/procedure-definitions/${definitionId}/supplies`, { method: "PUT", body: parsed.data }));
  if (result.ok) revalidatePath("/clinic/procedures");
  return result;
}
