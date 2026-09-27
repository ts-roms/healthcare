import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0023_doh_reporting.sql (the migration is the source of truth).

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const dohReportableRule = pgTable("doh_reportable_rule", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  codeSystemKey: text("code_system_key").$type<"icd-10">().notNull().default("icd-10"),
  codePrefix: text("code_prefix").notNull(),
  category: text("category").notNull(),
  sourceNote: text("source_note"),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const dohFacilitySetting = pgTable("doh_facility_setting", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  facilityCode: text("facility_code").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const CASE_REPORT_STATUSES = ["pending_review", "queued", "reported", "rejected", "failed", "dismissed"] as const;
export type CaseReportStatus = (typeof CASE_REPORT_STATUSES)[number];

export const dohCaseReport = pgTable("doh_case_report", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id").notNull(),
  diagnosisId: uuid("diagnosis_id").notNull(),
  ruleId: uuid("rule_id").notNull(),
  category: text("category").notNull(),
  diagnosisCode: text("diagnosis_code").notNull(),
  diagnosisDisplay: text("diagnosis_display").notNull(),
  status: text("status").$type<CaseReportStatus>().notNull().default("pending_review"),
  reportedVia: text("reported_via").$type<"external_channel" | "adapter">(),
  externalReference: text("external_reference"),
  exchangeId: uuid("exchange_id"),
  statusReason: text("status_reason"),
  detectedAt: ts("detected_at").notNull().defaultNow(),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: ts("reviewed_at"),
  version: integer("version").notNull().default(1),
});

export type ReportableRuleRecord = typeof dohReportableRule.$inferSelect;
export type FacilitySettingRecord = typeof dohFacilitySetting.$inferSelect;
export type CaseReportRecord = typeof dohCaseReport.$inferSelect;
