import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Questionnaire } from "./questionnaire";

// Mirrors database/migrations/0016_telemedicine.sql and 0125_telemedicine_extras.sql.

export const SESSION_STATUSES = ["scheduled", "waiting", "in_consultation", "ended", "escalated"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const telemedicineSession = pgTable("telemedicine_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  appointmentId: uuid("appointment_id").notNull(),
  visitId: uuid("visit_id"),
  encounterId: uuid("encounter_id"),
  roomName: text("room_name").notNull(),
  status: text("status").$type<SessionStatus>().notNull().default("scheduled"),
  questionnaire: jsonb("questionnaire").$type<Questionnaire>(),
  questionnaireSubmittedAt: ts("questionnaire_submitted_at"),
  redFlags: text("red_flags").array().notNull().default([]),
  consentAcknowledgedAt: ts("consent_acknowledged_at"),
  /** The version of the organization's `telemedicine` wording the patient saw; null = the platform's plain statement. */
  acknowledgementTextId: uuid("acknowledgement_text_id"),
  patientJoinedAt: ts("patient_joined_at"),
  clinicianJoinedAt: ts("clinician_joined_at"),
  startedAt: ts("started_at"),
  startedBy: uuid("started_by"),
  endedAt: ts("ended_at"),
  endedBy: uuid("ended_by"),
  escalationReason: text("escalation_reason"),
  patientInstructions: text("patient_instructions"),
  instructionsUpdatedAt: ts("instructions_updated_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type TelemedicineSessionRecord = typeof telemedicineSession.$inferSelect;

/** Telemedicine settings of the organization (migration 0125). No row = the defaults. */
export const telemedicineSetting = pgTable("telemedicine_setting", {
  organizationId: uuid("organization_id").primaryKey(),
  paymentRequired: boolean("payment_required").notNull().default(false),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const MESSAGE_SENDERS = ["patient", "staff"] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];

/** A chat message during an online consultation (append-only; migration 0125). */
export const telemedicineMessage = pgTable("telemedicine_message", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  senderType: text("sender_type").$type<MessageSender>().notNull(),
  senderUserId: uuid("sender_user_id"),
  senderName: text("sender_name").notNull(),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type TelemedicineMessageRecord = typeof telemedicineMessage.$inferSelect;
