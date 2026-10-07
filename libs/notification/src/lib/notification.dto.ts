import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS, NOTIFICATION_STATUSES, STAFF_PUSH_KINDS } from "./notification.schema";
import { TEMPLATE_KEYS } from "./templates";

export const sendNotificationSchema = z.object({
  recipient: z.discriminatedUnion("type", [
    z.object({ type: z.literal("patient"), patientId: z.string().uuid() }),
    z.object({ type: z.literal("user"), userId: z.string().uuid() }),
  ]),
  channel: z.enum(NOTIFICATION_CHANNELS),
  templateKey: z.enum(TEMPLATE_KEYS),
  variables: z.record(z.string(), z.unknown()).default({}),
  scheduledFor: z.iso.datetime({ offset: true }).optional(),
  /** Deduplicates retries of the same logical message. */
  idempotencyKey: z.string().min(8).max(128).optional(),
});
export class SendNotificationDto extends createZodDto(sendNotificationSchema) {}

export const listNotificationsSchema = z.object({ patientId: z.string().uuid() });
export class ListNotificationsDto extends createZodDto(listNotificationsSchema) {}

const localDate = z.iso.date();

/**
 * The communication log over local days (Asia/Manila), at most 92 days, optionally for one facility (migration 0106).
 * `status` `not_sent` groups failed, suppressed and cancelled.
 */
export const communicationLogSchema = z
  .object({
    from: localDate,
    to: localDate,
    channel: z.enum(NOTIFICATION_CHANNELS).optional(),
    category: z.enum(NOTIFICATION_CATEGORIES).optional(),
    status: z.enum([...NOTIFICATION_STATUSES, "not_sent"]).optional(),
    templateKey: z.enum(TEMPLATE_KEYS).optional(),
    patientId: z.uuid().optional(),
    facilityId: z.uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((v) => v.from <= v.to, { message: "The period ends before it starts", path: ["to"] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 < 92, { message: "Choose at most 92 days", path: ["to"] });
export class CommunicationLogDto extends createZodDto(communicationLogSchema) {}
export type CommunicationLogQuery = z.output<typeof communicationLogSchema>;

export const communicationSummarySchema = z
  .object({ from: localDate, to: localDate, facilityId: z.uuid().optional() })
  .refine((v) => v.from <= v.to, { message: "The period ends before it starts", path: ["to"] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 < 92, { message: "Choose at most 92 days", path: ["to"] });
export class CommunicationSummaryDto extends createZodDto(communicationSummarySchema) {}

/** Why a message is cancelled or sent again from the communication log (migration 0099). */
export const communicationReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export class CommunicationReasonDto extends createZodDto(communicationReasonSchema) {}

/** A member's push preferences (migration 0106): the kinds named are set as given. */
export const staffPushPreferencesSchema = z.object({
  preferences: z
    .array(z.object({ kind: z.enum(STAFF_PUSH_KINDS), enabled: z.boolean() }))
    .min(1)
    .max(STAFF_PUSH_KINDS.length),
});
export class StaffPushPreferencesDto extends createZodDto(staffPushPreferencesSchema) {}
