import { boolean, integer, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { MessageSender, MessageTopic, ThreadStatus } from "./patient-message.rules";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Mirrors database/migrations/0076_patient_messaging.sql and 0097_patient_messaging_attachments_routing.sql (the migrations are the source of truth). */
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
  /** When the clinic means to have answered the patient's latest message (0097); null without a target or once answered. */
  responseDueAt: ts("response_due_at"),
  overdueNotifiedAt: ts("overdue_notified_at"),
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
  /** Written by a guardian acting for the patient (migration 0080), not by the patient. */
  viaGuardian: boolean("via_guardian").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type PatientMessageThreadRecord = typeof patientMessageThread.$inferSelect;
export type PatientMessageRecord = typeof patientMessage.$inferSelect;

/** A document of the patient's record carried by a message (0097; append-only). */
export const patientMessageAttachment = pgTable("patient_message_attachment", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  threadId: uuid("thread_id").notNull(),
  messageId: uuid("message_id").notNull(),
  documentId: uuid("document_id").notNull(),
  position: smallint("position").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** A staff-only note on a conversation, never shown to the patient (0097; append-only). */
export const patientMessageNote = pgTable("patient_message_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  threadId: uuid("thread_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  authorUserId: uuid("author_user_id").notNull(),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Routing and response target for one topic at a facility (0097). */
export const patientMessageSetting = pgTable("patient_message_setting", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  topic: text("topic").$type<MessageTopic>().notNull(),
  routeRoleKey: text("route_role_key"),
  routeUserId: uuid("route_user_id"),
  autoAssign: boolean("auto_assign").notNull().default(false),
  responseTargetHours: integer("response_target_hours"),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type PatientMessageAttachmentRecord = typeof patientMessageAttachment.$inferSelect;
export type PatientMessageNoteRecord = typeof patientMessageNote.$inferSelect;
export type PatientMessageSettingRecord = typeof patientMessageSetting.$inferSelect;
