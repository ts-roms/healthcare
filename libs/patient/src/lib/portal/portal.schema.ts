import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const PORTAL_ACCOUNT_STATUSES = ["invited", "active", "disabled"] as const;
export type PortalAccountStatus = (typeof PORTAL_ACCOUNT_STATUSES)[number];

/** Why the latest activation attempt against an invitation failed (shown to staff only). */
export const PORTAL_ACTIVATION_FAILURES = ["expired", "birth_date_mismatch", "code_mismatch"] as const;
export type PortalActivationFailure = (typeof PORTAL_ACTIVATION_FAILURES)[number];

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Mirrors database/migrations/0013_patient_portal.sql and 0052 (the migrations are the source of truth). */
export const patientPortalAccount = pgTable("patient_portal_account", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  status: text("status").$type<PortalAccountStatus>().notNull(),
  email: text("email"),
  passwordHash: text("password_hash"),
  activationCodeHash: text("activation_code_hash"),
  activationExpiresAt: ts("activation_expires_at"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  lastActivationFailure: text("last_activation_failure").$type<PortalActivationFailure>(),
  lastActivationFailureAt: ts("last_activation_failure_at"),
  invitedBy: uuid("invited_by").notNull(),
  invitedAt: ts("invited_at").notNull().defaultNow(),
  activatedAt: ts("activated_at"),
  lastLoginAt: ts("last_login_at"),
  disabledAt: ts("disabled_at"),
  disabledBy: uuid("disabled_by"),
  disabledReason: text("disabled_reason"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const patientPortalSession = pgTable("patient_portal_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  accountId: uuid("account_id").notNull(),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  previousRefreshTokenHash: text("previous_refresh_token_hash"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  revokedReason: text("revoked_reason"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});

export type PatientPortalAccountRecord = typeof patientPortalAccount.$inferSelect;
export type PatientPortalSessionRecord = typeof patientPortalSession.$inferSelect;
