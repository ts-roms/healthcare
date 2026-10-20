import { bigint, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0114_data_privacy.sql (privacy settings and the breach register); the migration is the
// source of truth.

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Kinds of personal data an incident involves, as the organization assesses them. */
export const PRIVACY_DATA_CATEGORIES = ["identifiers", "contact", "health", "financial", "credentials", "other"] as const;
export type PrivacyDataCategory = (typeof PRIVACY_DATA_CATEGORIES)[number];
export const PRIVACY_INCIDENT_STATUSES = ["open", "closed"] as const;
export type PrivacyIncidentStatus = (typeof PRIVACY_INCIDENT_STATUSES)[number];
export const PRIVACY_ASSESSMENTS = ["pending", "notifiable", "not_notifiable"] as const;
export type PrivacyAssessment = (typeof PRIVACY_ASSESSMENTS)[number];
export const PRIVACY_ENTRY_KINDS = ["reported", "note", "containment", "assessment", "npc_notified", "subjects_notified", "closed"] as const;
export type PrivacyEntryKind = (typeof PRIVACY_ENTRY_KINDS)[number];

/** The organization's own privacy settings: its breach-notification window and its Data Protection Officer as named. */
export const privacySetting = pgTable("privacy_setting", {
  organizationId: uuid("organization_id").primaryKey(),
  breachNotificationHours: integer("breach_notification_hours").notNull().default(72),
  dpoName: text("dpo_name"),
  dpoContact: text("dpo_contact"),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
export type PrivacySettingRecord = typeof privacySetting.$inferSelect;

export const privacyIncidentNumberSequence = pgTable("privacy_incident_number_sequence", {
  organizationId: uuid("organization_id").primaryKey(),
  nextValue: bigint("next_value", { mode: "number" }).notNull(),
});

/** A personal data breach or security incident in the organization's register (never deleted). */
export const privacyIncident = pgTable("privacy_incident", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  incidentNumber: text("incident_number").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  discoveredAt: ts("discovered_at").notNull(),
  occurredAt: ts("occurred_at"),
  dataCategories: text("data_categories").array().$type<PrivacyDataCategory[]>().notNull(),
  affectedEstimate: integer("affected_estimate"),
  notifyBy: ts("notify_by").notNull(),
  status: text("status").$type<PrivacyIncidentStatus>().notNull().default("open"),
  assessment: text("assessment").$type<PrivacyAssessment>().notNull().default("pending"),
  assessmentReason: text("assessment_reason"),
  assessedAt: ts("assessed_at"),
  assessedBy: uuid("assessed_by"),
  npcNotifiedAt: ts("npc_notified_at"),
  npcReference: text("npc_reference"),
  subjectsNotifiedAt: ts("subjects_notified_at"),
  subjectsNotificationMethod: text("subjects_notification_method"),
  closedAt: ts("closed_at"),
  closedBy: uuid("closed_by"),
  closureNote: text("closure_note"),
  reportedBy: uuid("reported_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
export type PrivacyIncidentRecord = typeof privacyIncident.$inferSelect;

/** What was done about an incident and when, in order (append-only). */
export const privacyIncidentEntry = pgTable("privacy_incident_entry", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  incidentId: uuid("incident_id").notNull(),
  kind: text("kind").$type<PrivacyEntryKind>().notNull(),
  note: text("note").notNull(),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});
export type PrivacyIncidentEntryRecord = typeof privacyIncidentEntry.$inferSelect;
