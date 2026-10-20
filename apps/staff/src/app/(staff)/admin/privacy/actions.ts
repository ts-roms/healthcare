"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { PrivacyIncident, PrivacySetting } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call (privacy.incident.manage).

const id = z.uuid();
const version = z.number().int().positive();
const CATEGORIES = ["identifiers", "contact", "health", "financial", "credentials", "other"] as const;

function refresh(incidentId?: string) {
  revalidatePath("/admin/privacy");
  if (incidentId) revalidatePath(`/admin/privacy/${incidentId}`);
}

const recordSchema = z.object({
  title: z.string().trim().min(3, "Give the incident a short title.").max(200),
  description: z.string().trim().min(10, "Describe what happened (at least 10 characters).").max(4000),
  discoveredAt: z.iso.datetime({ offset: true }),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  dataCategories: z.array(z.enum(CATEGORIES)).min(1, "Tick what kinds of data are involved."),
  affectedEstimate: z.number().int().min(0).optional(),
});
export async function recordIncident(input: z.input<typeof recordSchema>): Promise<ActionResult<PrivacyIncident>> {
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the incident." };
  const result = await actionResult(() => api<PrivacyIncident>("/privacy/incidents", { method: "POST", body: parsed.data }));
  if (result.ok) refresh();
  return result;
}

async function post(incidentId: string, path: string, body: object): Promise<ActionResult<PrivacyIncident>> {
  const result = await actionResult(() => api<PrivacyIncident>(`/privacy/incidents/${incidentId}/${path}`, { method: "POST", body }));
  refresh(incidentId);
  return result;
}

export async function addIncidentEntry(input: { incidentId: string; kind: "note" | "containment"; note: string; version: number }) {
  const parsed = z
    .object({ incidentId: id, kind: z.enum(["note", "containment"]), note: z.string().trim().min(3, "Write the note.").max(4000), version })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { incidentId, ...body } = parsed.data;
  return post(incidentId, "entries", body);
}

export async function assessIncident(input: { incidentId: string; assessment: "notifiable" | "not_notifiable"; reason: string; version: number }) {
  const parsed = z
    .object({
      incidentId: id,
      assessment: z.enum(["notifiable", "not_notifiable"]),
      reason: z.string().trim().min(10, "Give the reason (at least 10 characters).").max(2000),
      version,
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { incidentId, ...body } = parsed.data;
  return post(incidentId, "assess", body);
}

export async function recordNpcNotification(input: { incidentId: string; notifiedAt: string; reference: string; note?: string; version: number }) {
  const parsed = z
    .object({
      incidentId: id,
      notifiedAt: z.iso.datetime({ offset: true }),
      reference: z.string().trim().min(1, "Give the NPC's reference or how it was sent.").max(200),
      note: z.string().trim().max(4000).optional(),
      version,
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { incidentId, note, ...body } = parsed.data;
  return post(incidentId, "npc-notification", { ...body, note: note && note.length >= 3 ? note : undefined });
}

export async function recordSubjectsNotification(input: { incidentId: string; notifiedAt: string; method: string; note?: string; version: number }) {
  const parsed = z
    .object({
      incidentId: id,
      notifiedAt: z.iso.datetime({ offset: true }),
      method: z.string().trim().min(3, "Say how the affected people were told.").max(500),
      note: z.string().trim().max(4000).optional(),
      version,
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { incidentId, note, ...body } = parsed.data;
  return post(incidentId, "subjects-notification", { ...body, note: note && note.length >= 3 ? note : undefined });
}

export async function closeIncident(input: { incidentId: string; note: string; version: number }) {
  const parsed = z
    .object({ incidentId: id, note: z.string().trim().min(10, "Say what was concluded (at least 10 characters).").max(4000), version })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { incidentId, ...body } = parsed.data;
  return post(incidentId, "close", body);
}

const settingSchema = z.object({
  breachNotificationHours: z.number().int().min(1).max(720),
  dpoName: z
    .string()
    .trim()
    .max(120)
    .transform((v) => v || null),
  dpoContact: z
    .string()
    .trim()
    .max(300)
    .transform((v) => v || null),
  version: z.number().int().min(0),
});
export async function savePrivacySetting(input: z.input<typeof settingSchema>): Promise<ActionResult<PrivacySetting>> {
  const parsed = settingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the settings." };
  const result = await actionResult(() => api<PrivacySetting>("/privacy/setting", { method: "PUT", body: parsed.data }));
  refresh();
  return result;
}
