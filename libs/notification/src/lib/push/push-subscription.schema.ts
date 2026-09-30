import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const PUSH_REVOKED_REASONS = ["removed_by_patient", "gone", "failing", "moved_to_another_account"] as const;
export type PushRevokedReason = (typeof PUSH_REVOKED_REASONS)[number];

/** Mirrors database/migrations/0079_push_subscriptions.sql (the migration is the source of truth). */
export const pushSubscription = pgTable("push_subscription", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  portalAccountId: uuid("portal_account_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  failureCount: integer("failure_count").notNull().default(0),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason").$type<PushRevokedReason>(),
});

export type PushSubscriptionRecord = typeof pushSubscription.$inferSelect;
