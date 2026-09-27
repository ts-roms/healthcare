import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const NOTIFICATION_CHANNELS = ['sms', 'email', 'push', 'in_app'] as const;
export const NOTIFICATION_CATEGORIES = ['clinical', 'administrative', 'outreach', 'security'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'cancelled' | 'suppressed';

export const notification = pgTable('notification', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  recipientType: text('recipient_type').$type<'patient' | 'user'>().notNull(),
  recipientPatientId: uuid('recipient_patient_id'),
  recipientUserId: uuid('recipient_user_id'),
  channel: text('channel').$type<NotificationChannel>().notNull(),
  category: text('category').$type<NotificationCategory>().notNull(),
  templateKey: text('template_key').notNull(),
  templateVersion: integer('template_version').notNull(),
  destination: text('destination'),
  variables: jsonb('variables').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').$type<NotificationStatus>().notNull(),
  suppressionReason: text('suppression_reason'),
  idempotencyKey: text('idempotency_key'),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  lastError: text('last_error'),
  provider: text('provider'),
  providerMessageId: text('provider_message_id'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notificationAttempt = pgTable('notification_attempt', {
  id: uuid('id').primaryKey().defaultRandom(),
  notificationId: uuid('notification_id').notNull(),
  attemptNumber: integer('attempt_number').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  outcome: text('outcome').$type<'sent' | 'failed'>(),
  error: text('error'),
  provider: text('provider'),
});

export type NotificationRecord = typeof notification.$inferSelect;
