import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0152_assistant.sql (the migration is the source of truth). These tables belong to the API's
// assistant composition, which reads several domains (ADR-0018), not to a domain library.

const ts = (name: string) => timestamp(name, { withTimezone: true });

export type AssistantOutcome = "accepted" | "dismissed" | "not_useful";

export const assistantRuleSetting = pgTable("assistant_rule_setting", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id"),
  ruleId: text("rule_id").notNull(),
  version: integer("version").notNull(),
  enabled: boolean("enabled").notNull(),
  parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const assistantFeedback = pgTable("assistant_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id"),
  userId: uuid("user_id").notNull(),
  ruleId: text("rule_id").notNull(),
  ruleVersion: integer("rule_version").notNull(),
  subjectKey: text("subject_key").notNull(),
  outcome: text("outcome").$type<AssistantOutcome>().notNull(),
  reason: text("reason"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
