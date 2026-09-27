"use server";

import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { CarePlanDetail } from "@/lib/api/types";
import { carePlanPayloadSchema } from "@/lib/care-plan-form";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.

const createSchema = z.object({ patientId: z.uuid(), sourceEncounterId: z.uuid().optional(), plan: carePlanPayloadSchema });
/** Creates an active care plan (problems, goals, activities) from the encounter. */
export async function createCarePlan(input: z.input<typeof createSchema>, idempotencyKey: string): Promise<ActionResult<CarePlanDetail>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { patientId, sourceEncounterId, plan } = parsed.data;
  return actionResult(() =>
    api<CarePlanDetail>("/care-plans", { method: "POST", body: { ...plan, patientId, sourceEncounterId, status: "active" }, idempotencyKey }),
  );
}

const activitySchema = z.object({
  carePlanId: z.uuid(),
  activityId: z.uuid(),
  status: z.enum(["scheduled", "completed", "cancelled"]),
  appointmentId: z.uuid().optional(),
  reason: z.string().trim().max(500).optional(),
});
/** Completes or cancels an activity, or links a booked follow-up appointment ("scheduled"). */
export async function updateCareActivity(input: z.input<typeof activitySchema>): Promise<ActionResult<CarePlanDetail>> {
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { carePlanId, activityId, ...body } = parsed.data;
  if (body.status === "cancelled" && (body.reason ?? "").length < 3) return { ok: false, message: "Give a reason for cancelling." };
  return actionResult(() =>
    api<CarePlanDetail>(`/care-plans/${carePlanId}/activities/${activityId}`, { method: "PATCH", body: { ...body, reason: body.reason || undefined } }),
  );
}

const statusSchema = z.object({
  carePlanId: z.uuid(),
  status: z.enum(["active", "on_hold", "completed", "cancelled"]),
  reason: z.string().trim().max(500).optional(),
  version: z.number().int().positive(),
});
export async function changeCarePlanStatus(input: z.input<typeof statusSchema>): Promise<ActionResult<unknown>> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { carePlanId, ...body } = parsed.data;
  return actionResult(() => api(`/care-plans/${carePlanId}/status`, { method: "POST", body: { ...body, reason: body.reason || undefined } }));
}

const goalSchema = z.object({
  carePlanId: z.uuid(),
  goalId: z.uuid(),
  status: z.enum(["proposed", "active", "achieved", "not_achieved", "cancelled"]),
});
export async function updateCareGoal(input: z.input<typeof goalSchema>): Promise<ActionResult<unknown>> {
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { carePlanId, goalId, status } = parsed.data;
  return actionResult(() => api(`/care-plans/${carePlanId}/goals/${goalId}`, { method: "PATCH", body: { status } }));
}

const noteSchema = z.object({ carePlanId: z.uuid(), note: z.string().trim().min(1, "Write the note").max(4000) });
export async function addProgressNote(input: z.input<typeof noteSchema>): Promise<ActionResult<unknown>> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { carePlanId, note } = parsed.data;
  return actionResult(() => api(`/care-plans/${carePlanId}/progress-notes`, { method: "POST", body: { note } }));
}

const addActivitySchema = z.object({
  carePlanId: z.uuid(),
  kind: z.enum(["follow_up_appointment", "laboratory_monitoring", "medication", "lifestyle", "education", "referral", "patient_task", "provider_task"]),
  description: z.string().trim().min(1, "Describe the activity").max(500),
  assignee: z.enum(["patient", "care_team"]),
  dueDate: z.iso.date().optional(),
  recurrenceIntervalDays: z.number().int().min(1).max(730).optional(),
  goalId: z.uuid().optional(),
});
export async function addCareActivity(input: z.input<typeof addActivitySchema>): Promise<ActionResult<unknown>> {
  const parsed = addActivitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { carePlanId, ...body } = parsed.data;
  return actionResult(() => api(`/care-plans/${carePlanId}/activities`, { method: "POST", body }));
}
