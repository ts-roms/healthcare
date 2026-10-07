import { bigint, boolean, date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  /** 0073: when the sign-in email was proven with a code sent to it. */
  emailVerifiedAt: ts("email_verified_at"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaSecretEncrypted: text("mfa_secret_encrypted"),
  mfaPendingSecretEncrypted: text("mfa_pending_secret_encrypted"),
  mfaEnabledAt: ts("mfa_enabled_at"),
  mfaLastUsedStep: bigint("mfa_last_used_step", { mode: "number" }),
  /** 0107: the clinic exempted this account from a two-step verification requirement, with a reason. */
  mfaExemptReason: text("mfa_exempt_reason"),
  mfaExemptedBy: uuid("mfa_exempted_by"),
  mfaExemptedAt: ts("mfa_exempted_at"),
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

export const PASSWORD_RESET_CONSUMED_REASONS = ["reset", "superseded", "exhausted", "account_inactive"] as const;
export type PasswordResetConsumedReason = (typeof PASSWORD_RESET_CONSUMED_REASONS)[number];

/** Mirrors database/migrations/0072_portal_password_reset.sql. Only the token's hash is stored. */
export const patientPortalPasswordReset = pgTable("patient_portal_password_reset", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  accountId: uuid("account_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  consumedAt: ts("consumed_at"),
  consumedReason: text("consumed_reason").$type<PasswordResetConsumedReason>(),
  createdAt: ts("created_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});

export const EMAIL_VERIFICATION_CONSUMED_REASONS = ["verified", "superseded", "exhausted"] as const;

/** Mirrors database/migrations/0073_portal_email_verification_mfa.sql. */
export const patientPortalEmailVerification = pgTable("patient_portal_email_verification", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  accountId: uuid("account_id").notNull(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  consumedAt: ts("consumed_at"),
  consumedReason: text("consumed_reason").$type<(typeof EMAIL_VERIFICATION_CONSUMED_REASONS)[number]>(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const patientPortalRecoveryCode = pgTable("patient_portal_recovery_code", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  accountId: uuid("account_id").notNull(),
  codeHash: text("code_hash").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  usedAt: ts("used_at"),
});

/**
 * The organization's two-step verification requirement for patients (0100_patient_mfa_policy_trusted_devices.sql):
 * from `required_from` (null = at once) a patient without it can only set it up; nobody is locked out.
 */
export const patientMfaPolicy = pgTable("patient_mfa_policy", {
  organizationId: uuid("organization_id").primaryKey(),
  required: boolean("required").notNull(),
  requiredFrom: date("required_from"),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
export type PatientMfaPolicyRecord = typeof patientMfaPolicy.$inferSelect;

export const TRUSTED_DEVICE_REVOKE_REASONS = ["forgotten_by_patient", "forgotten_all", "replaced", "mfa_disabled", "mfa_reset", "sessions_ended"] as const;
export type TrustedDeviceRevokeReason = (typeof TRUSTED_DEVICE_REVOKE_REASONS)[number];

/** A browser the patient asked not to be asked for a code on again (migration 0100): only the token's hash is kept. */
export const patientTrustedDevice = pgTable("patient_trusted_device", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  accountId: uuid("account_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  label: text("label").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  revokedReason: text("revoked_reason").$type<TrustedDeviceRevokeReason>(),
});
export type PatientTrustedDeviceRecord = typeof patientTrustedDevice.$inferSelect;
