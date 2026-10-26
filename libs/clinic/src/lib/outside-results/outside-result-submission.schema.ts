import { date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0130_outside_result_submissions.sql (the migration is the source of truth).

export const OUTSIDE_RESULT_SUBMISSION_STATUSES = ["submitted", "filed", "declined", "withdrawn"] as const;
export type OutsideResultSubmissionStatus = (typeof OUTSIDE_RESULT_SUBMISSION_STATUSES)[number];

/** A report a patient sent from MyHealth, waiting for the records office to file it on their record or decline it. */
export const outsideResultSubmission = pgTable("outside_result_submission", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  portalAccountId: uuid("portal_account_id").notNull(),
  documentId: uuid("document_id").notNull(),
  sourceName: text("source_name").notNull(),
  tests: text("tests").notNull(),
  performedOn: date("performed_on"),
  notes: text("notes"),
  status: text("status").$type<OutsideResultSubmissionStatus>().notNull().default("submitted"),
  outsideResultId: uuid("outside_result_id"),
  decisionReason: text("decision_reason"),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});
export type OutsideResultSubmissionRecord = typeof outsideResultSubmission.$inferSelect;
