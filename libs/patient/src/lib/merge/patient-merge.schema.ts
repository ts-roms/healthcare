import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { MergeHistoryAction } from "./patient-merge.rules";

/** Mirrors database/migrations/0068_patient_merge.sql (the migration is the source of truth). Append-only. */
export const patientMerge = pgTable("patient_merge", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  retiredPatientId: uuid("retired_patient_id").notNull(),
  survivorPatientId: uuid("survivor_patient_id").notNull(),
  action: text("action").$type<MergeHistoryAction>().notNull(),
  previousStatus: text("previous_status").$type<"active" | "inactive" | "deceased">(),
  reason: text("reason").notNull(),
  relatedMergeId: uuid("related_merge_id"),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
  performedBy: uuid("performed_by").notNull(),
  performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PatientMergeRecord = typeof patientMerge.$inferSelect;
