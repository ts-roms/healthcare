import { date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0128_outside_results.sql (the migration is the source of truth).

export const OUTSIDE_RESULT_SOURCE_KINDS = ["laboratory", "hospital", "clinic", "other"] as const;
export type OutsideResultSourceKind = (typeof OUTSIDE_RESULT_SOURCE_KINDS)[number];
export const OUTSIDE_RESULT_RECEIVED_FROM = ["patient", "provider", "other"] as const;
export type OutsideResultReceivedFrom = (typeof OUTSIDE_RESULT_RECEIVED_FROM)[number];

/** A result from an outside laboratory or hospital filed on a patient's record: the report and what it says about itself. */
export const outsideResult = pgTable("outside_result", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  facilityId: uuid("facility_id"),
  documentId: uuid("document_id").notNull(),
  sourceName: text("source_name").notNull(),
  sourceKind: text("source_kind").$type<OutsideResultSourceKind>().notNull(),
  performedOn: date("performed_on").notNull(),
  tests: text("tests").notNull(),
  receivedFrom: text("received_from").$type<OutsideResultReceivedFrom>().notNull(),
  notes: text("notes"),
  enteredInErrorReason: text("entered_in_error_reason"),
  enteredInErrorBy: uuid("entered_in_error_by"),
  enteredInErrorAt: timestamp("entered_in_error_at", { withTimezone: true }),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});
export type OutsideResultRecord = typeof outsideResult.$inferSelect;
