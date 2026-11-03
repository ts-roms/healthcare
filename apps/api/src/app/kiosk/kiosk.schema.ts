import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0137_kiosk.sql (the migration is the source of truth). These tables belong to the API's
// kiosk composition, which spans the patient and clinic domains (ADR-0015), not to a domain library.

const ts = (name: string) => timestamp(name, { withTimezone: true });

export type KioskDeviceStatus = "active" | "maintenance" | "disabled";
export type KioskPrinterStatus = "unknown" | "none" | "ok" | "paper_out" | "offline" | "error";
export type KioskSessionStatus = "active" | "ended" | "expired" | "locked";
export type KioskRegistrationStatus = "pending" | "approved" | "linked" | "rejected" | "expired";

export const kioskDevice = pgTable("kiosk_device", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  userId: uuid("user_id").notNull(),
  status: text("status").$type<KioskDeviceStatus>().notNull().default("active"),
  heartbeatAt: ts("heartbeat_at"),
  appVersion: text("app_version"),
  printerStatus: text("printer_status").$type<KioskPrinterStatus>().notNull().default("unknown"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
export type KioskDeviceRecord = typeof kioskDevice.$inferSelect;

export const kioskSession = pgTable("kiosk_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  deviceId: uuid("device_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  status: text("status").$type<KioskSessionStatus>().notNull().default("active"),
  patientId: uuid("patient_id"),
  identifiedAt: ts("identified_at"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastActivityAt: ts("last_activity_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  endedAt: ts("ended_at"),
});
export type KioskSessionRecord = typeof kioskSession.$inferSelect;

export const kioskRegistration = pgTable("kiosk_registration", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  deviceId: uuid("device_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  reference: text("reference").notNull(),
  status: text("status").$type<KioskRegistrationStatus>().notNull().default("pending"),
  payloadSealed: text("payload_sealed"),
  payloadKeyId: text("payload_key_id"),
  duplicateCandidateIds: uuid("duplicate_candidate_ids").array().notNull().default([]),
  submittedAt: ts("submitted_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: ts("reviewed_at"),
  decisionReason: text("decision_reason"),
  patientId: uuid("patient_id"),
  visitId: uuid("visit_id"),
});
export type KioskRegistrationRecord = typeof kioskRegistration.$inferSelect;
