import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Questionnaire } from "./questionnaire";

// Mirrors database/migrations/0016_telemedicine.sql.

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
