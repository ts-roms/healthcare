"use server";

import { revalidatePath } from "next/cache";
import { portalApi } from "@/lib/api/client";
import { type Result, run, UUID } from "@/lib/api/result";
import type { BookedAppointment, BookingSlots } from "@/lib/api/types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function loadSlots(query: { facilityId: string; visitTypeId: string; date: string; practitionerId?: string }): Promise<Result<BookingSlots>> {
  if (!UUID.test(query.facilityId) || !UUID.test(query.visitTypeId) || !DATE.test(query.date) || (query.practitionerId && !UUID.test(query.practitionerId))) {
    return { ok: false, message: "Invalid request." };
  }
  const params = new URLSearchParams({ facilityId: query.facilityId, visitTypeId: query.visitTypeId, date: query.date });
  if (query.practitionerId) params.set("practitionerId", query.practitionerId);
  return run(() => portalApi<BookingSlots>(`/portal/booking/slots?${params}`));
}

export async function bookAppointment(input: {
  facilityId: string;
  visitTypeId: string;
  practitionerId: string;
  startsAt: string;
  reason?: string;
}): Promise<Result<BookedAppointment>> {
  const reason = input.reason?.trim() || undefined;
  const result = await run(() => portalApi<BookedAppointment>("/portal/appointments", { method: "POST", body: { ...input, reason } }));
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function rescheduleAppointment(appointmentId: string, startsAt: string, version: number): Promise<Result<BookedAppointment>> {
  if (!UUID.test(appointmentId)) return { ok: false, message: "Invalid request." };
  const result = await run(() =>
    portalApi<BookedAppointment>(`/portal/appointments/${appointmentId}/reschedule`, { method: "POST", body: { startsAt, version } }),
  );
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function cancelAppointment(appointmentId: string, version: number, reason?: string): Promise<Result<BookedAppointment>> {
  if (!UUID.test(appointmentId)) return { ok: false, message: "Invalid request." };
  const body = { version, reason: reason?.trim() || undefined };
  const result = await run(() => portalApi<BookedAppointment>(`/portal/appointments/${appointmentId}/cancel`, { method: "POST", body }));
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
