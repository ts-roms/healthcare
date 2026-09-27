import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { NOTIFICATION_CHANNELS } from './notification.schema';
import { TEMPLATE_KEYS } from './templates';

export const sendNotificationSchema = z.object({
  recipient: z.discriminatedUnion('type', [
    z.object({ type: z.literal('patient'), patientId: z.string().uuid() }),
    z.object({ type: z.literal('user'), userId: z.string().uuid() }),
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
