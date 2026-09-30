import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { CALENDAR_EVENT_KINDS, CALENDAR_VISIBILITIES } from "./calendar.schema";

const isoDateTime = z.iso.datetime({ offset: true });
const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

export const CALENDAR_MAX_RANGE_DAYS = 42;

export const calendarRangeSchema = z
  .object({ facilityId: z.string().uuid(), from: isoDateTime, to: isoDateTime })
  .refine((v) => new Date(v.to) > new Date(v.from), { message: "The range must end after it starts", path: ["to"] })
  .refine((v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= CALENDAR_MAX_RANGE_DAYS * 86_400_000, {
    message: `Ask for at most ${CALENDAR_MAX_RANGE_DAYS} days at a time`,
    path: ["to"],
  });
export class CalendarRangeDto extends createZodDto(calendarRangeSchema) {}

const eventFields = {
  title: z.string().trim().min(2, "Give the event a title").max(200),
  kind: z.enum(CALENDAR_EVENT_KINDS),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  allDay: z.boolean().default(false),
  location: optionalText(200),
  description: optionalText(2000),
  visibility: z.enum(CALENDAR_VISIBILITIES).default("facility"),
  /** Users of the organization's clinicians (practitioners linked to a user). */
  attendeeUserIds: z.array(z.string().uuid()).max(50).default([]),
};
const endsAfterStart = (v: { startsAt: string; endsAt: string }) => new Date(v.endsAt) > new Date(v.startsAt);
const endsMessage = { message: "The event must end after it starts", path: ["endsAt"] };

export const createCalendarEventSchema = z.object({ facilityId: z.string().uuid(), ...eventFields }).refine(endsAfterStart, endsMessage);
export class CreateCalendarEventDto extends createZodDto(createCalendarEventSchema) {}

export const updateCalendarEventSchema = z.object({ ...eventFields, version: z.number().int().positive() }).refine(endsAfterStart, endsMessage);
export class UpdateCalendarEventDto extends createZodDto(updateCalendarEventSchema) {}

export const cancelCalendarEventSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason").max(500),
  version: z.number().int().positive(),
});
export class CancelCalendarEventDto extends createZodDto(cancelCalendarEventSchema) {}
