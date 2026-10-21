import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0117_patient_qr_codes.sql; the migration is the source of truth.

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** What a QR code encodes: an opaque revocable token (default) or the patient number. Never clinical or demographic data. */
export const PATIENT_QR_CONTENTS = ["token", "patient_number", "portal_link"] as const;
export type PatientQrContent = (typeof PATIENT_QR_CONTENTS)[number];
export const PATIENT_QR_STATUSES = ["active", "revoked"] as const;
export type PatientQrStatus = (typeof PATIENT_QR_STATUSES)[number];
export const PATIENT_QR_ISSUED_VIA = ["registration", "patient_record"] as const;
export type PatientQrIssuedVia = (typeof PATIENT_QR_ISSUED_VIA)[number];

export const patientQrSetting = pgTable("patient_qr_setting", {
  organizationId: uuid("organization_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  issueAtRegistration: boolean("issue_at_registration").notNull().default(true),
  content: text("content").$type<PatientQrContent>().notNull().default("token"),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
export type PatientQrSettingRecord = typeof patientQrSetting.$inferSelect;

/** An issued code. Append-only: the one change is active → revoked. */
export const patientQrCode = pgTable("patient_qr_code", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  content: text("content").$type<PatientQrContent>().notNull(),
  token: text("token").notNull(),
  status: text("status").$type<PatientQrStatus>().notNull().default("active"),
  issuedVia: text("issued_via").$type<PatientQrIssuedVia>().notNull(),
  issuedBy: uuid("issued_by").notNull(),
  issuedAt: ts("issued_at").notNull().defaultNow(),
  revokedBy: uuid("revoked_by"),
  revokedAt: ts("revoked_at"),
  revokeReason: text("revoke_reason"),
});
export type PatientQrCodeRecord = typeof patientQrCode.$inferSelect;
