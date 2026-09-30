import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const PUSH_REVOKED_REASONS = ["removed_by_patient", "gone", "failing", "moved_to_another_account"] as const;
export const PUSH_DEVICE_KINDS = ["web", "expo"] as const;
export type PushDeviceKind = (typeof PUSH_DEVICE_KINDS)[number];

export type PushRevokedReason = (typeof PUSH_REVOKED_REASONS)[number];

/** Mirrors database/migrations/0079_push_subscriptions.sql and 0081_mobile_push_devices.sql (the migrations are the source of truth). */
export const pushSubscription = pgTable("push_subscription", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  portalAccountId: uuid("portal_account_id").notNull(),
  /** A browser's push address, or (kind "expo") the app's Expo push token. */
  endpoint: text("endpoint").notNull(),
  kind: text("kind").$type<PushDeviceKind>().notNull().default("web"),
  p256dh: text("p256dh"),
  auth: text("auth"),
  deviceLabel: text("device_label"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  failureCount: integer("failure_count").notNull().default(0),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason").$type<PushRevokedReason>(),
});

export type PushSubscriptionRecord = typeof pushSubscription.$inferSelect;

/** Mirrors database/migrations/0083_expo_push_receipts.sql: an Expo ticket waiting for, or answered by, its receipt. */
export const pushTicket = pgTable("push_ticket", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  pushSubscriptionId: uuid("push_subscription_id").notNull(),
  notificationId: uuid("notification_id"),
  ticketId: text("ticket_id").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  receiptStatus: text("receipt_status").$type<"ok" | "error" | "expired">(),
  receiptError: text("receipt_error"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  checkCount: integer("check_count").notNull().default(0),
});

export type PushTicketRecord = typeof pushTicket.$inferSelect;
