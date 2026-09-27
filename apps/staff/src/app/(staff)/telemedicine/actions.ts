"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { TelemedicineConsultation } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.
const id = z.uuid();
const instructions = z.string().trim().max(4000);

/** Starts the consultation for a waiting patient; returns the encounter to document in. */
export async function startConsultation(appointmentId: string): Promise<ActionResult<TelemedicineConsultation>> {
  if (!id.safeParse(appointmentId).success) return { ok: false, message: "Invalid request." };
  return actionResult(() => api<TelemedicineConsultation>(`/telemedicine/consultations/${appointmentId}/start`, { method: "POST" }));
}

/** A fresh video token for a running consultation. */
export async function joinConsultation(appointmentId: string): Promise<ActionResult<TelemedicineConsultation>> {
  if (!id.safeParse(appointmentId).success) return { ok: false, message: "Invalid request." };
  return actionResult(() => api<TelemedicineConsultation>(`/telemedicine/consultations/${appointmentId}/join`, { method: "POST" }));
}

const endSchema = z.object({ appointmentId: id, patientInstructions: instructions.optional() });
export async function endConsultation(input: z.input<typeof endSchema>): Promise<ActionResult<TelemedicineConsultation>> {
  const parsed = endSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { appointmentId, patientInstructions } = parsed.data;
  return actionResult(() =>
    api<TelemedicineConsultation>(`/telemedicine/consultations/${appointmentId}/end`, {
      method: "POST",
      body: { patientInstructions: patientInstructions || undefined },
    }),
  );
}

const escalateSchema = z.object({
  appointmentId: id,
  reason: z.string().trim().min(5, "Say why the patient needs in-person care (at least 5 characters).").max(1000),
  patientInstructions: instructions.optional(),
});
export async function escalateConsultation(input: z.input<typeof escalateSchema>): Promise<ActionResult<TelemedicineConsultation>> {
  const parsed = escalateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { appointmentId, reason, patientInstructions } = parsed.data;
  return actionResult(() =>
    api<TelemedicineConsultation>(`/telemedicine/consultations/${appointmentId}/escalate`, {
      method: "POST",
      body: { reason, patientInstructions: patientInstructions || undefined },
    }),
  );
}

const instructionsSchema = z.object({ appointmentId: id, patientInstructions: instructions.min(1, "Write the instructions.") });
export async function saveInstructions(input: z.input<typeof instructionsSchema>): Promise<ActionResult<TelemedicineConsultation>> {
  const parsed = instructionsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  return actionResult(() =>
    api<TelemedicineConsultation>(`/telemedicine/consultations/${parsed.data.appointmentId}/instructions`, {
      method: "PUT",
      body: { patientInstructions: parsed.data.patientInstructions },
    }),
  );
}
