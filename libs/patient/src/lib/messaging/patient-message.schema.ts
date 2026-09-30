import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { MessageSender, MessageTopic, ThreadStatus } from "./patient-message.rules";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Mirrors database/migrations/0076_patient_messaging.sql (the migration is the source of truth). */
export const patientMessageThread = pgTable("patient_message_thread", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  topic: text("topic").$type<MessageTopic>().notNull(),
  subject: text("subject").notNull(),
  startedBy: text("started_by").$type<MessageSender>().notNull(),
  status: text("status").$type<ThreadStatus>().notNull().default("open"),
  assignedTo: uuid("assigned_to"),
  messageCount: integer("message_count").notNull().default(0),
  lastMessageAt: ts("last_message_at").notNull().defaultNow(),
  lastMessageFrom: text("last_message_from").$type<MessageSender>().notNull(),
  patientReadThrough: ts("patient_read_through"),
  closedAt: ts("closed_at"),
  closedBy: uuid("closed_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const patientMessage = pgTable("patient_message", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  threadId: uuid("thread_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  senderType: text("sender_type").$type<MessageSender>().notNull(),
  senderPortalAccountId: uuid("sender_portal_account_id"),
  senderUserId: uuid("sender_user_id"),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type PatientMessageThreadRecord = typeof patientMessageThread.$inferSelect;
export type PatientMessageRecord = typeof patientMessage.$inferSelect;
