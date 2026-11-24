import { boolean, date, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0152_assistant.sql and 0159_assistant_governance.sql (the migrations are the source of
// truth). These tables belong to the API's assistant composition, which reads several domains (ADR-0018), not to a domain
// library.

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

/** Times each rule's suggestions were shown, per facility and local day (0159; a counter, updated in place). */
export const assistantRuleShown = pgTable(
  "assistant_rule_shown",
  {
    organizationId: uuid("organization_id").notNull(),
    facilityId: uuid("facility_id").notNull(),
    ruleId: text("rule_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    shown: integer("shown").notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.facilityId, t.ruleId, t.day] })],
);

export const RULE_REVIEW_OUTCOMES = ["keep", "adjust", "retire"] as const;
export type RuleReviewOutcome = (typeof RULE_REVIEW_OUTCOMES)[number];

/** An organization's review of a rule (0159; append-only). */
export const assistantRuleReview = pgTable("assistant_rule_review", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  ruleId: text("rule_id").notNull(),
  ruleVersion: integer("rule_version").notNull(),
  outcome: text("outcome").$type<RuleReviewOutcome>().notNull(),
  note: text("note").notNull(),
  falsePositives: text("false_positives"),
  reviewedOn: date("reviewed_on", { mode: "string" }).notNull(),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});
