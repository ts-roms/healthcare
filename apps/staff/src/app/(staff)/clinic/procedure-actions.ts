"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { ClinicProcedure, ProcedureDefinition } from "@/lib/api/types";
import { type DefinitionForm, definitionFormSchema, procedureFormSchema, procedurePayload, type ProcedureForm } from "@/lib/procedure-form";

const uuid = z.uuid();

function refresh(encounterId: string, patientId?: string) {
  revalidatePath(`/clinic/encounters/${encounterId}`);
  if (patientId) {
    revalidatePath(`/patients/${patientId}`);
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

const inErrorSchema = z.object({
  procedureId: z.uuid(),
  encounterId: z.uuid(),
  patientId: z.uuid(),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters).").max(500),
});
/** Marks a procedure entered in error with a reason; its charge, if not yet invoiced, is cancelled. */
export async function markProcedureInError(input: z.input<typeof inErrorSchema>): Promise<ActionResult<ClinicProcedure>> {
  const parsed = inErrorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { procedureId, encounterId, patientId, reason } = parsed.data;
  const result = await actionResult(() => api<ClinicProcedure>(`/procedures/${procedureId}/entered-in-error`, { method: "POST", body: { reason } }));
  if (result.ok) refresh(encounterId, patientId);
  return result;
}

/** Adds a procedure to the organization's catalogue (clinic.configure). */
export async function createProcedureDefinition(form: DefinitionForm): Promise<ActionResult<ProcedureDefinition>> {
  const parsed = definitionFormSchema.safeParse(form);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the procedure." };
  const { codeSystem, externalCode, ...rest } = parsed.data;
  const result = await actionResult(() =>
    api<ProcedureDefinition>("/clinic/procedure-definitions", {
      method: "POST",
      body: { ...rest, ...(externalCode ? { codeSystem, externalCode } : {}) },
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
