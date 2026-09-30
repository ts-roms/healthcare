import { bigint, boolean, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const appUser = pgTable("app_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").$type<"staff" | "patient">().notNull().default("staff"),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  status: text("status").$type<"active" | "disabled">().notNull().default("active"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaSecretEncrypted: text("mfa_secret_encrypted"),
  mfaPendingSecretEncrypted: text("mfa_pending_secret_encrypted"),
  /** The last accepted TOTP time step: a code works once (migration 0087). */
  mfaLastUsedStep: bigint("mfa_last_used_step", { mode: "number" }),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const permission = pgTable("permission", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
});

export const role = pgTable("role", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id"),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermission = pgTable(
  "role_permission",
  {
    roleId: uuid("role_id").notNull(),
    permissionKey: text("permission_key").notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionKey] })],
);

export const organizationMembership = pgTable("organization_membership", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  userId: uuid("user_id").notNull(),
  status: text("status").$type<"active" | "suspended">().notNull().default("active"),
  mfaExemptReason: text("mfa_exempt_reason"),
  mfaExemptedBy: uuid("mfa_exempted_by"),
  mfaExemptedAt: timestamp("mfa_exempted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The organization's two-step verification policy for staff (migration 0086); no row means not required. */
export const staffMfaPolicy = pgTable("staff_mfa_policy", {
  organizationId: uuid("organization_id").primaryKey(),
  required: boolean("required").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const roleAssignment = pgTable("role_assignment", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  userId: uuid("user_id").notNull(),
  roleId: uuid("role_id").notNull(),
  facilityId: uuid("facility_id"),
  departmentId: uuid("department_id"),
  grantedBy: uuid("granted_by"),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  revokedBy: uuid("revoked_by"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const authSession = pgTable("auth_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  organizationId: uuid("organization_id"),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  previousRefreshTokenHash: text("previous_refresh_token_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});

export type AppUserRecord = typeof appUser.$inferSelect;
export type RoleRecord = typeof role.$inferSelect;
export type AuthSessionRecord = typeof authSession.$inferSelect;

/** Single-use codes for signing in without the authenticator app; only hashes are kept (migration 0087). */
export const staffRecoveryCode = pgTable("staff_recovery_code", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  codeHash: text("code_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});
