"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { KioskDevice, KioskPrintJob } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.
const id = z.uuid();

const registerSchema = z.object({
  kind: z.enum(["kiosk", "display"]),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{2,39}$/, "A code is 3-40 lower-case letters, digits or hyphens."),
  name: z.string().trim().min(2, "Give the device a name.").max(100),
  userId: id,
  printsTickets: z.boolean().optional(),
});

/** Registers a kiosk or a waiting-room display: the staff account it signs in with must hold that device's role at this facility. */
export async function registerDevice(input: z.input<typeof registerSchema>): Promise<ActionResult<KioskDevice>> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const result = await actionResult(() => api<KioskDevice>("/kiosk/admin/devices", { method: "POST", body: parsed.data }));
  revalidatePath("/queue/devices");
  return result;
}

const updateSchema = z.object({
  deviceId: id,
  name: z.string().trim().min(2, "Give the device a name.").max(100).optional(),
  status: z.enum(["active", "maintenance", "disabled"]).optional(),
  printsTickets: z.boolean().optional(),
  printAgentUserId: id.nullable().optional(),
  version: z.number().int().positive(),
});

/** Renames a device, or puts it into maintenance, back into service, or out of service. */
export async function updateDevice(input: z.input<typeof updateSchema>): Promise<ActionResult<KioskDevice>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { deviceId, ...body } = parsed.data;
  const result = await actionResult(() => api<KioskDevice>(`/kiosk/admin/devices/${deviceId}`, { method: "PATCH", body }));
  revalidatePath("/queue/devices");
  return result;
}

const reprintSchema = z.object({ jobId: id, reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(500) });

/** Prints a kiosk ticket again (limited, audited, only while the visit is open). */
export async function reprintTicket(input: z.input<typeof reprintSchema>): Promise<ActionResult<KioskPrintJob>> {
  const parsed = reprintSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { jobId, ...body } = parsed.data;
  const result = await actionResult(() => api<KioskPrintJob>(`/kiosk/admin/print-jobs/${jobId}/reprint`, { method: "POST", body }));
  revalidatePath("/queue/devices");
  return result;
}
