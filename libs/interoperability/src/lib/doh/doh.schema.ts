import { date, integer, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0023_doh_reporting.sql, 0045_doh_rescan.sql and 0073 (reporting deadlines); the migrations
// are the source of truth.

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
  // 0073: the organization's own "report within N days of the diagnosis" (none encoded by the platform).
  reportWithinDays: smallint("report_within_days"),
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
  /** The check of earlier diagnoses that opened it; null when opened as the diagnosis was recorded. */
  rescanId: uuid("rescan_id"),
  /** 0073: when the report is due under the rule's own deadline (the diagnosis time plus its days); null: none set. */
  dueAt: ts("due_at"),
});

export const RESCAN_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type RescanStatus = (typeof RESCAN_STATUSES)[number];

/** A check of earlier diagnoses against the organization's active rules (run in the background by DohRescans). */
export const dohRescan = pgTable("doh_rescan", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date").notNull(),
  timeZone: text("time_zone").notNull(),
  status: text("status").$type<RescanStatus>().notNull().default("queued"),
  scanned: integer("scanned").notNull().default(0),
  matched: integer("matched").notNull().default(0),
  opened: integer("opened").notNull().default(0),
  // Full (microsecond) precision is kept as text: the cursor must not re-read or skip a diagnosis.
  cursorRecordedAt: timestamp("cursor_recorded_at", { withTimezone: true, mode: "string" }),
  cursorDiagnosisId: uuid("cursor_diagnosis_id"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  requestedBy: uuid("requested_by").notNull(),
  requestedAt: ts("requested_at").notNull().defaultNow(),
  startedAt: ts("started_at"),
  heartbeatAt: ts("heartbeat_at"),
  completedAt: ts("completed_at"),
});

export type ReportableRuleRecord = typeof dohReportableRule.$inferSelect;
export type FacilitySettingRecord = typeof dohFacilitySetting.$inferSelect;
export type CaseReportRecord = typeof dohCaseReport.$inferSelect;
export type RescanRecord = typeof dohRescan.$inferSelect;
