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

/** Moves the visit to another open time; `practitionerId` names another doctor at the same clinic (the same doctor when omitted). */
export async function rescheduleAppointment(
  appointmentId: string,
  startsAt: string,
  version: number,
  practitionerId?: string,
): Promise<Result<BookedAppointment>> {
  if (!UUID.test(appointmentId) || (practitionerId && !UUID.test(practitionerId))) return { ok: false, message: "Invalid request." };
  const result = await run(() =>
    portalApi<BookedAppointment>(`/portal/appointments/${appointmentId}/reschedule`, { method: "POST", body: { startsAt, version, practitionerId } }),
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

/** Asks to be told when a time opens on days with no open times (where the clinic allows it). Nothing is booked. */
export async function joinWaitlist(input: {
  facilityId: string;
  visitTypeId: string;
  practitionerId?: string;
  earliestDate: string;
  latestDate: string;
}): Promise<Result<{ id: string }>> {
  if (!UUID.test(input.facilityId) || !UUID.test(input.visitTypeId) || (input.practitionerId && !UUID.test(input.practitionerId)))
    return { ok: false, message: "Invalid request." };
  if (!DATE.test(input.earliestDate) || !DATE.test(input.latestDate)) return { ok: false, message: "Invalid request." };
  const result = await run(() => portalApi<{ id: string }>("/portal/booking/waitlist", { method: "POST", body: input }));
  if (result.ok) revalidatePath("/appointments");
  return result;
}

export async function leaveWaitlist(entryId: string): Promise<Result<null>> {
  if (!UUID.test(entryId)) return { ok: false, message: "Invalid request." };
  const result = await run(async () => {
    await portalApi<void>(`/portal/booking/waitlist/${entryId}/leave`, { method: "POST" });
    return null;
  });
  if (result.ok) revalidatePath("/appointments");
  return result;
}
