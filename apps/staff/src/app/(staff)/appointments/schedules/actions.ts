"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionResult, type ActionResult } from "@/lib/api/action-result";
import { api } from "@/lib/api/client";
import type { ClinicRoom, PractitionerDetail, PractitionerScheduleRow, ScheduleExceptionRow } from "@/lib/api/types";
import { PROFESSIONS, ROOM_TYPES } from "./labels";

// Shapes are checked here only to fail fast; the API validates and authorizes every call (clinic.configure).

const PATH = "/appointments/schedules";
const done = <T>(result: ActionResult<T>) => {
  if (result.ok) revalidatePath(PATH);
  return result;
};
const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Check the details.";
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || undefined);
const optionalDate = z
  .string()
  .trim()
  .transform((v) => v || undefined)
  .refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a valid date.");

const practitionerSchema = z.object({
  displayName: z.string().trim().min(1, "Enter the practitioner's name as patients should see it.").max(200),
  profession: z.enum(PROFESSIONS.map((p) => p.value) as [string, ...string[]]),
  specialty: optionalText(120),
  licenseNumber: optionalText(40),
  licenseValidUntil: optionalDate,
  userId: z
    .string()
    .transform((v) => v || undefined)
    .pipe(z.uuid().optional()),
});
export type PractitionerInput = z.input<typeof practitionerSchema>;

export async function addPractitioner(input: PractitionerInput): Promise<ActionResult<PractitionerDetail>> {
  const parsed = practitionerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  return done(await actionResult(() => api<PractitionerDetail>("/clinic/practitioners", { method: "POST", body: parsed.data })));
}

export async function updatePractitioner(
  practitionerId: string,
  input: PractitionerInput & { status: "active" | "inactive"; version: number },
): Promise<ActionResult<PractitionerDetail>> {
  const parsed = practitionerSchema.extend({ status: z.enum(["active", "inactive"]), version: z.number().int().positive() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  const result = await actionResult(() => api<PractitionerDetail>(`/clinic/practitioners/${practitionerId}`, { method: "PATCH", body: parsed.data }));
  revalidatePath(PATH);
  return result;
}

const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Codes use 2–49 lower-case letters, digits or hyphens.");

export async function addRoom(input: { facilityId: string; code: string; name: string; roomType: string }): Promise<ActionResult<ClinicRoom>> {
  const parsed = z
    .object({
      facilityId: z.uuid(),
      code,
      name: z.string().trim().min(1, "Name the room.").max(120),
      roomType: z.enum(ROOM_TYPES.map((r) => r.value) as [string, ...string[]]),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  return done(await actionResult(() => api<ClinicRoom>("/clinic/rooms", { method: "POST", body: parsed.data })));
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 08:00.");
const scheduleSchema = z
  .object({
    practitionerId: z.uuid("Choose a practitioner."),
    facilityId: z.uuid(),
    roomId: z
      .string()
      .transform((v) => v || undefined)
      .pipe(z.uuid().optional()),
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    startTime: time,
    endTime: time,
    slotMinutes: z.coerce.number().int().min(5, "Slots are at least 5 minutes.").max(240),
    validFrom: z.iso.date("Choose when the schedule starts."),
    validUntil: optionalDate,
  })
  .refine((v) => v.endTime > v.startTime, { message: "The end time must be after the start time." })
  .refine((v) => !v.validUntil || v.validUntil >= v.validFrom, { message: "The last day cannot be before the first day." });

export async function addSchedule(input: z.input<typeof scheduleSchema>): Promise<ActionResult<PractitionerScheduleRow>> {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  return done(await actionResult(() => api<PractitionerScheduleRow>("/clinic/schedules", { method: "POST", body: parsed.data })));
}

export async function retireSchedule(scheduleId: string): Promise<ActionResult<PractitionerScheduleRow>> {
  if (!z.uuid().safeParse(scheduleId).success) return { ok: false, message: "Invalid request." };
  return done(await actionResult(() => api<PractitionerScheduleRow>(`/clinic/schedules/${scheduleId}/retire`, { method: "POST" })));
}

const exceptionSchema = z
  .object({
    facilityId: z.uuid(),
    practitionerId: z
      .string()
      .transform((v) => v || undefined)
      .pipe(z.uuid().optional()),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(1, "Say why (e.g. a declared holiday, leave).").max(300),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { message: "The closure must end after it starts." });

export async function addClosure(input: z.input<typeof exceptionSchema>): Promise<ActionResult<ScheduleExceptionRow>> {
  const parsed = exceptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  return done(await actionResult(() => api<ScheduleExceptionRow>("/clinic/schedule-exceptions", { method: "POST", body: parsed.data })));
}
