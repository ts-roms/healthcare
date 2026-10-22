import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { PRIVACY_DATA_CATEGORIES } from "./privacy.schema";

const isoDateTime = z.iso.datetime({ offset: true });
const version = z.number().int().positive();
const note = (min: number, max: number) => z.string().trim().min(min).max(max);

export const recordPrivacyIncidentSchema = z
  .object({
    title: note(3, 200),
    /** What happened, as known at the time (no patient names needed; identifiers belong in the organization's own case file). */
    description: note(10, 4000),
    discoveredAt: isoDateTime,
    occurredAt: isoDateTime.optional(),
    dataCategories: z.array(z.enum(PRIVACY_DATA_CATEGORIES)).min(1, "Say what kinds of data are involved").max(PRIVACY_DATA_CATEGORIES.length),
    /** How many people are affected, as estimated (unknown: leave out). */
    affectedEstimate: z.number().int().min(0).max(100_000_000).optional(),
  })
  .refine((v) => !v.occurredAt || new Date(v.occurredAt) <= new Date(v.discoveredAt), {
    message: "The incident cannot occur after it was discovered",
    path: ["occurredAt"],
  });
export class RecordPrivacyIncidentDto extends createZodDto(recordPrivacyIncidentSchema) {}

export const privacyIncidentQuerySchema = z.object({ status: z.enum(["open", "closed", "all"]).default("open") });
export class PrivacyIncidentQueryDto extends createZodDto(privacyIncidentQuerySchema) {}

export const addIncidentEntrySchema = z.object({
  kind: z.enum(["note", "containment"]),
  note: note(3, 4000),
  version,
});
export class AddIncidentEntryDto extends createZodDto(addIncidentEntrySchema) {}

export const assessIncidentSchema = z.object({
  assessment: z.enum(["notifiable", "not_notifiable"]),
  /** Why, in the assessor's words (what harm is likely, what data, what the organization's procedure says). */
  reason: note(10, 2000),
  version,
});
export class AssessIncidentDto extends createZodDto(assessIncidentSchema) {}

export const recordNpcNotificationSchema = z.object({
  notifiedAt: isoDateTime,
  /** The reference the NPC gave, or how it was sent. */
  reference: note(1, 200),
  note: note(3, 4000).optional(),
  version,
});
export class RecordNpcNotificationDto extends createZodDto(recordNpcNotificationSchema) {}

export const recordSubjectsNotificationSchema = z.object({
  notifiedAt: isoDateTime,
  /** How the affected people were told (letter, SMS, MyHealth notice, public notice …). */
  method: note(3, 500),
  note: note(3, 4000).optional(),
  version,
});
export class RecordSubjectsNotificationDto extends createZodDto(recordSubjectsNotificationSchema) {}

export const closeIncidentSchema = z.object({
  /** What was concluded and what changed (also when a notifiable incident was not notified: say why). */
  note: note(10, 4000),
  version,
});
export class CloseIncidentDto extends createZodDto(closeIncidentSchema) {}

export const privacySettingSchema = z.object({
  /** Hours from discovery within which the organization means to notify; its own value (the NPC's circular is the reference). */
  breachNotificationHours: z.number().int().min(1).max(720),
  dpoName: note(2, 120).nullable(),
  dpoContact: note(3, 300).nullable(),
  /** 0 when never set. */
  version: z.number().int().min(0),
});
export class PrivacySettingDto extends createZodDto(privacySettingSchema) {}
