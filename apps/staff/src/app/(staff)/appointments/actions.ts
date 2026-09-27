"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { AppointmentItem, Visit, VisitType } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.
const idVersion = { appointmentId: z.uuid(), version: z.number().int().positive() };

const confirmSchema = z.object(idVersion);
export async function confirmAppointment(input: z.input<typeof confirmSchema>): Promise<ActionResult<AppointmentItem>> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { appointmentId, version } = parsed.data;
  return actionResult(() => api<AppointmentItem>(`/appointments/${appointmentId}/confirm`, { method: "POST", body: { version } }));
}

const noShowSchema = z.object(idVersion);
export async function markNoShow(input: z.input<typeof noShowSchema>): Promise<ActionResult<AppointmentItem>> {
  const parsed = noShowSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { appointmentId, version } = parsed.data;
  return actionResult(() => api<AppointmentItem>(`/appointments/${appointmentId}/no-show`, { method: "POST", body: { version } }));
}

const cancelSchema = z.object({ ...idVersion, reason: z.string().trim().min(3, "Give a reason").max(500) });
export async function cancelAppointment(input: z.input<typeof cancelSchema>): Promise<ActionResult<AppointmentItem>> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { appointmentId, ...body } = parsed.data;
  return actionResult(() => api<AppointmentItem>(`/appointments/${appointmentId}/cancel`, { method: "POST", body }));
}

const checkInSchema = z.object({
  appointmentId: z.uuid(),
  priority: z.enum(["routine", "urgent", "emergency"]).default("routine"),
  chiefComplaint: z.string().trim().max(500).optional(),
});
/** Checks the patient in at the selected facility: the appointment becomes a queue ticket. */
export async function checkInAppointment(input: z.input<typeof checkInSchema>): Promise<ActionResult<Visit>> {
  const parsed = checkInSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { appointmentId, chiefComplaint, priority } = parsed.data;
  return actionResult(() =>
    api<Visit>(`/appointments/${appointmentId}/check-in`, { method: "POST", body: { priority, chiefComplaint: chiefComplaint || undefined } }),
  );
}

const bookSchema = z.object({
  patientId: z.uuid(),
  practitionerId: z.uuid(),
  facilityId: z.uuid(),
  visitTypeId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  bookingChannel: z.enum(["front_desk", "phone"]),
  reason: z.string().trim().max(500).optional(),
});
/** Books one appointment in a published slot. The API refuses double-booking (409) and times outside the schedule. */
export async function bookAppointment(input: z.input<typeof bookSchema>, idempotencyKey: string): Promise<ActionResult<AppointmentItem[]>> {
  const parsed = bookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const body = { ...parsed.data, reason: parsed.data.reason || undefined };
  return actionResult(() => api<AppointmentItem[]>("/appointments", { method: "POST", body, idempotencyKey }));
}

const onlineBookingSchema = z.object({ visitTypeId: z.uuid(), onlineBooking: z.boolean(), version: z.number().int().positive() });
/** Opens or closes a visit type for patients to book in MyHealth (needs clinic.configure; audited). */
export async function setOnlineBooking(input: z.input<typeof onlineBookingSchema>): Promise<ActionResult<VisitType>> {
  const parsed = onlineBookingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const { visitTypeId, ...body } = parsed.data;
  const result = await actionResult(() => api<VisitType>(`/clinic/visit-types/${visitTypeId}`, { method: "PATCH", body }));
  if (result.ok) revalidatePath("/appointments/visit-types");
  return result;
}
