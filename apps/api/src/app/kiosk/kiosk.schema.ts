import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0137_kiosk.sql, 0139_kiosk_printing_and_displays.sql, 0140_kiosk_prints_tickets.sql and 0141_kiosk_registration_claim.sql and 0142_kiosk_print_agent_binding.sql and 0143_kiosk_printer_settings.sql (the migrations are the source of truth). These tables belong to the API's
// kiosk composition, which spans the patient and clinic domains (ADR-0015), not to a domain library.

const ts = (name: string) => timestamp(name, { withTimezone: true });

export type KioskDeviceStatus = "active" | "maintenance" | "disabled";
export type KioskDeviceKind = "kiosk" | "display";
export type KioskPrintStatus = "queued" | "printing" | "printed" | "failed" | "cancelled";
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
  kind: text("kind").$type<KioskDeviceKind>().notNull().default("kiosk"),
  status: text("status").$type<KioskDeviceStatus>().notNull().default("active"),
  heartbeatAt: ts("heartbeat_at"),
  printerHeartbeatAt: ts("printer_heartbeat_at"),
  /** Staff turned ticket printing on for this kiosk (it has a printer and a print agent); off until then (migration 0140). */
  printsTickets: boolean("prints_tickets").notNull().default(false),
  /** The print agent account that serves this kiosk (migration 0142); null = any print agent of the facility. */
  printAgentUserId: uuid("print_agent_user_id"),
  /** Where the printer is (migration 0143): on the agent's own computer, or on the clinic's network at `printerHost`. */
  printerConnection: text("printer_connection").$type<"agent_local" | "network">().notNull().default("agent_local"),
  printerHost: text("printer_host"),
  printerPort: integer("printer_port"),
  /** The ticket roll's width in millimetres. */
  paperMm: integer("paper_mm").$type<58 | 80>().notNull().default(80),
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
  /** The reviewer deciding it right now (migration 0141); a claim older than two minutes is ignored. */
  claimedBy: uuid("claimed_by"),
  claimedAt: ts("claimed_at"),
});
export type KioskRegistrationRecord = typeof kioskRegistration.$inferSelect;

/** A ticket for a kiosk's printer to print (migration 0139): what is on the ticket and nothing about the patient. */
export const kioskPrintJob = pgTable("kiosk_print_job", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  deviceId: uuid("device_id").notNull(),
  visitId: uuid("visit_id").notNull(),
  kind: text("kind").notNull().default("ticket"),
  ticket: text("ticket").notNull(),
  serviceName: text("service_name").notNull(),
  facilityName: text("facility_name").notNull(),
  issuedAt: ts("issued_at").notNull(),
  instructions: text("instructions").notNull(),
  status: text("status").$type<KioskPrintStatus>().notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  leaseExpiresAt: ts("lease_expires_at"),
  lastError: text("last_error"),
  printedAt: ts("printed_at"),
  reprintOf: uuid("reprint_of"),
  reprintReason: text("reprint_reason"),
  requestedBy: uuid("requested_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
export type KioskPrintJobRecord = typeof kioskPrintJob.$inferSelect;
