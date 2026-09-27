"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { Visit } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.
const moveSchema = z.object({
  visitId: z.uuid(),
  status: z.enum(["in_triage", "awaiting_consultation", "cancelled", "left_without_being_seen"]),
  reason: z.string().trim().max(500).optional(),
  version: z.number().int().positive(),
});

export async function moveVisit(input: z.input<typeof moveSchema>): Promise<ActionResult<Visit>> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { visitId, ...body } = parsed.data;
  return actionResult(() => api<Visit>(`/queue/visits/${visitId}/move`, { method: "POST", body: { ...body, reason: body.reason || undefined } }));
}

const callSchema = z.object({
  visitId: z.uuid(),
  calledTo: z.string().trim().min(1, "Where should the patient go?").max(60),
  version: z.number().int().positive(),
});

export async function callVisit(input: z.input<typeof callSchema>): Promise<ActionResult<Visit>> {
  const parsed = callSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { visitId, ...body } = parsed.data;
  return actionResult(() => api<Visit>(`/queue/visits/${visitId}/call`, { method: "POST", body }));
}

const walkInSchema = z.object({
  patientId: z.uuid(),
  visitTypeId: z.uuid("Choose a visit type"),
  priority: z.enum(["routine", "urgent", "emergency"]),
  chiefComplaint: z.string().trim().max(500).optional(),
  assignedPractitionerId: z.uuid().optional(),
});

/** Adds a walk-in to today's queue at the selected facility. The idempotency key makes a double submit safe. */
export async function registerWalkIn(input: z.input<typeof walkInSchema>, idempotencyKey: string): Promise<ActionResult<Visit>> {
  const parsed = walkInSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const body = { ...parsed.data, chiefComplaint: parsed.data.chiefComplaint || undefined };
  return actionResult(() => api<Visit>("/queue/walk-ins", { method: "POST", body, idempotencyKey }));
}
