"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { Visit, VisitRouteResult } from "@/lib/api/types";

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

const routeSchema = z.object({
  visitId: z.uuid(),
  servicePointId: z.uuid("Choose a service point"),
  reason: z.string().trim().max(500).optional(),
  version: z.number().int().positive(),
});

/** Sends the visit to a service point of the facility (migration 0113); the API checks the status and records the move. */
export async function routeVisit(input: z.input<typeof routeSchema>): Promise<ActionResult<Visit>> {
  const parsed = routeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { visitId, ...body } = parsed.data;
  return actionResult(() => api<Visit>(`/queue/visits/${visitId}/route`, { method: "POST", body: { ...body, reason: body.reason || undefined } }));
}

const planRouteSchema = z.object({
  visitId: z.uuid(),
  servicePointIds: z.array(z.uuid()).min(1, "Choose at least one stop").max(10),
  version: z.number().int().positive(),
});

/** Sets the stops still ahead of the visit (migration 0115); the API checks each one and keeps the finished steps. */
export async function planRoute(input: z.input<typeof planRouteSchema>): Promise<ActionResult<VisitRouteResult>> {
  const parsed = planRouteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { visitId, ...body } = parsed.data;
  return actionResult(() => api<VisitRouteResult>(`/queue/visits/${visitId}/route-plan`, { method: "PUT", body }));
}

const advanceRouteSchema = z.object({ visitId: z.uuid(), note: z.string().trim().max(500).optional(), version: z.number().int().positive() });

/** "Done here, send on": the API finishes the current step, routes the visit and calls the patient when the facility asks. */
export async function advanceRoute(input: z.input<typeof advanceRouteSchema>): Promise<ActionResult<VisitRouteResult>> {
  const parsed = advanceRouteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { visitId, ...body } = parsed.data;
  return actionResult(() => api<VisitRouteResult>(`/queue/visits/${visitId}/route/next`, { method: "POST", body: { ...body, note: body.note || undefined } }));
}

const skipRouteStepSchema = z.object({
  visitId: z.uuid(),
  stepId: z.uuid("Choose the step to skip"),
  reason: z.string().trim().min(3, "Give a reason").max(500),
  version: z.number().int().positive(),
});

/** Skips a step of the route with a reason (the current one sends the patient on). */
export async function skipRouteStep(input: z.input<typeof skipRouteStepSchema>): Promise<ActionResult<VisitRouteResult>> {
  const parsed = skipRouteStepSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { visitId, ...body } = parsed.data;
  return actionResult(() => api<VisitRouteResult>(`/queue/visits/${visitId}/route/skip`, { method: "POST", body }));
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
