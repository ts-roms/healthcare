import { date, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0093_management_reports.sql (the migration is the source of truth). These tables belong
// to the API's management-dashboard composition, not to a domain library (ADR-0011).

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const REPORT_CADENCES = ["weekly", "monthly"] as const;
export type ReportCadence = (typeof REPORT_CADENCES)[number];
export type ReportScheduleStatus = "active" | "paused";
export type ReportRunStatus = "producing" | "produced" | "partial" | "failed";

export interface WithheldTable {
  table: string;
  reason: string;
}

export const managementReportSchedule = pgTable("management_report_schedule", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id"),
  name: text("name").notNull(),
  cadence: text("cadence").$type<ReportCadence>().notNull(),
  tables: text("tables").array().notNull(),
  recipientUserIds: uuid("recipient_user_ids").array().notNull(),
  ownerUserId: uuid("owner_user_id").notNull(),
  status: text("status").$type<ReportScheduleStatus>().notNull().default("active"),
  version: integer("version").notNull().default(1),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
});
export type ManagementReportScheduleRecord = typeof managementReportSchedule.$inferSelect;

export const managementReport = pgTable("management_report", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  scheduleId: uuid("schedule_id").notNull(),
  periodFrom: date("period_from").notNull(),
  periodTo: date("period_to").notNull(),
  facilityId: uuid("facility_id"),
  status: text("status").$type<ReportRunStatus>().notNull().default("producing"),
  withheld: jsonb("withheld").$type<WithheldTable[]>().notNull().default([]),
  error: text("error"),
  startedAt: ts("started_at").notNull().defaultNow(),
  producedAt: ts("produced_at"),
  notifiedUserIds: uuid("notified_user_ids").array().notNull().default([]),
});
export type ManagementReportRecord = typeof managementReport.$inferSelect;

export const managementReportFile = pgTable(
  "management_report_file",
  {
    reportId: uuid("report_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    table: text("table").notNull(),
    documentId: uuid("document_id"),
    storedAt: ts("stored_at"),
  },
  (t) => [primaryKey({ columns: [t.reportId, t.table] })],
);
export type ManagementReportFileRecord = typeof managementReportFile.$inferSelect;
