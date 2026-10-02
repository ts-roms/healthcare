"use server";

import { revalidatePath } from "next/cache";
import { portalApi } from "@/lib/api/client";
import { type Result, run, UUID } from "@/lib/api/result";
import type { BookedAppointment, BookingSlots, WaitlistAllowance } from "@/lib/api/types";

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

/** Checks in for an in-person appointment, where the clinic offers online check-in and within its window. */
export async function checkInOnline(appointmentId: string): Promise<Result<{ ticket: string }>> {
  if (!UUID.test(appointmentId)) return { ok: false, message: "Invalid request." };
  const result = await run(() => portalApi<{ ticket: string }>(`/portal/appointments/${appointmentId}/check-in`, { method: "POST", body: {} }));
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

/** Whether the clinic takes a waiting-list request for this visit type and doctor (its rules per visit type or doctor decide). */
export async function loadWaitlistAllowance(input: { facilityId: string; visitTypeId: string; practitionerId?: string }): Promise<Result<WaitlistAllowance>> {
  if (!UUID.test(input.facilityId) || !UUID.test(input.visitTypeId) || (input.practitionerId && !UUID.test(input.practitionerId)))
    return { ok: false, message: "Invalid request." };
  const query = new URLSearchParams({
    facilityId: input.facilityId,
    visitTypeId: input.visitTypeId,
    ...(input.practitionerId ? { practitionerId: input.practitionerId } : {}),
  });
  return run(() => portalApi<WaitlistAllowance>(`/portal/booking/waitlist-allowance?${query.toString()}`));
}

/** Accepts a time the clinic is holding: booked like any online booking (the first acceptance wins). */
export async function acceptOffer(offerId: string): Promise<Result<BookedAppointment>> {
  if (!UUID.test(offerId)) return { ok: false, message: "Invalid request." };
  const result = await run(() => portalApi<BookedAppointment>(`/portal/booking/offers/${offerId}/accept`, { method: "POST" }));
  if (result.ok) revalidatePath("/appointments");
  return result;
}

/** Declines a held time; the request stays on the waiting list. */
export async function declineOffer(offerId: string): Promise<Result<null>> {
  if (!UUID.test(offerId)) return { ok: false, message: "Invalid request." };
  const result = await run(() => portalApi<null>(`/portal/booking/offers/${offerId}/decline`, { method: "POST" }));
  if (result.ok) revalidatePath("/appointments");
  return result;
}
