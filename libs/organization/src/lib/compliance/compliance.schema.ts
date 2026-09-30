import { date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0073_compliance_configuration.sql (compliance reviews; the migration is the source of truth).

/** Areas whose configuration the organization has validated against current official requirements. */
export const COMPLIANCE_AREAS = [
  "billing_tax",
  "procurement",
  "controlled_drugs",
  "laboratory_licensing",
  "doh_reporting",
  "data_privacy",
  "dental_estimates",
] as const;
export type ComplianceArea = (typeof COMPLIANCE_AREAS)[number];
export const COMPLIANCE_OUTCOMES = ["validated", "changes_needed"] as const;
export type ComplianceOutcome = (typeof COMPLIANCE_OUTCOMES)[number];

export const complianceReview = pgTable("compliance_review", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  area: text("area").$type<ComplianceArea>().notNull(),
  outcome: text("outcome").$type<ComplianceOutcome>().notNull(),
  reviewerName: text("reviewer_name").notNull(),
  reviewerRole: text("reviewer_role").notNull(),
  reference: text("reference").notNull(),
  reviewedOn: date("reviewed_on", { mode: "string" }).notNull(),
  note: text("note"),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ComplianceReviewRecord = typeof complianceReview.$inferSelect;
