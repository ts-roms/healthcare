import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const NOTIFICATION_CHANNELS = ["sms", "email", "push", "in_app"] as const;
export const NOTIFICATION_CATEGORIES = ["clinical", "administrative", "outreach", "security"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export const NOTIFICATION_STATUSES = ["queued", "sending", "sent", "delivered", "failed", "cancelled", "suppressed"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const notification = pgTable("notification", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  recipientType: text("recipient_type").$type<"patient" | "user">().notNull(),
  recipientPatientId: uuid("recipient_patient_id"),
  recipientUserId: uuid("recipient_user_id"),
  channel: text("channel").$type<NotificationChannel>().notNull(),
  category: text("category").$type<NotificationCategory>().notNull(),
  templateKey: text("template_key").notNull(),
  templateVersion: integer("template_version").notNull(),
  destination: text("destination"),
  variables: jsonb("variables").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").$type<NotificationStatus>().notNull(),
  suppressionReason: text("suppression_reason"),
  idempotencyKey: text("idempotency_key"),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  lastError: text("last_error"),
  provider: text("provider"),
  providerMessageId: text("provider_message_id"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** The notification this one is a resend of (migration 0099); the original row never changes. */
  resentFrom: uuid("resent_from"),
  /** The facility the requesting actor was acting in (migration 0106); null before it, or outside any facility. */
  facilityId: uuid("facility_id"),
});

/** What a staff in-app notice is about, for the member's own push preferences (migration 0106). */
export const STAFF_PUSH_KINDS = [
  "records_requests",
  "patient_messages",
  "referrals",
  "laboratory_results",
  "laboratory_quality",
  "documents",
  "management_reports",
] as const;
export type StaffPushKind = (typeof STAFF_PUSH_KINDS)[number];

/** A kind of notice a member turned off (or on again) in their browsers; absent means on. */
export const staffPushPreference = pgTable(
  "staff_push_preference",
  {
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
    kind: text("kind").$type<StaffPushKind>().notNull(),
    enabled: boolean("enabled").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId, t.kind] })],
);

export const notificationAttempt = pgTable("notification_attempt", {
  id: uuid("id").primaryKey().defaultRandom(),
  notificationId: uuid("notification_id").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  outcome: text("outcome").$type<"sent" | "failed">(),
  error: text("error"),
  provider: text("provider"),
});

export type NotificationRecord = typeof notification.$inferSelect;
