"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { CalendarEventItem } from "@/lib/api/types";

// Shapes are checked here only to fail fast; the API validates and authorizes every call.
const eventFields = {
  title: z.string().trim().min(2, "Give the event a title").max(200),
  kind: z.enum(["meeting", "event", "blocked", "training", "reminder"]),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  allDay: z.boolean(),
  location: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  visibility: z.enum(["facility", "invitees"]),
  attendeeUserIds: z.array(z.uuid()).max(50),
};

const createSchema = z.object({ facilityId: z.uuid(), ...eventFields });
/** Adds an event to the facility calendar; the caller becomes its organizer. */
export async function createCalendarEvent(input: z.input<typeof createSchema>): Promise<ActionResult<CalendarEventItem>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const body = { ...parsed.data, location: parsed.data.location || undefined, description: parsed.data.description || undefined };
  const result = await actionResult(() => api<CalendarEventItem>("/calendar/events", { method: "POST", body }));
  if (result.ok) revalidatePath("/calendar");
  return result;
}

const updateSchema = z.object({ eventId: z.uuid(), version: z.number().int().positive(), ...eventFields });
export async function updateCalendarEvent(input: z.input<typeof updateSchema>): Promise<ActionResult<CalendarEventItem>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { eventId, ...rest } = parsed.data;
  const body = { ...rest, location: rest.location || undefined, description: rest.description || undefined };
  const result = await actionResult(() => api<CalendarEventItem>(`/calendar/events/${eventId}`, { method: "PUT", body }));
  if (result.ok) revalidatePath("/calendar");
  return result;
}

const cancelSchema = z.object({ eventId: z.uuid(), version: z.number().int().positive(), reason: z.string().trim().min(3, "Give a reason").max(500) });
export async function cancelCalendarEvent(input: z.input<typeof cancelSchema>): Promise<ActionResult<CalendarEventItem>> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { eventId, ...body } = parsed.data;
  const result = await actionResult(() => api<CalendarEventItem>(`/calendar/events/${eventId}/cancel`, { method: "POST", body }));
  if (result.ok) revalidatePath("/calendar");
  return result;
}
