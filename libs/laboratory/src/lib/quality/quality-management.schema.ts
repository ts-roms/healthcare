import { boolean, date, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0055_lab_quality_management.sql (the migration is the source of truth).

const decimal = (name: string) => numeric(name, { mode: "number" });
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const STORAGE_UNIT_KINDS = ["refrigerator", "freezer", "incubator", "water_bath", "room", "other"] as const;
export type StorageUnitKind = (typeof STORAGE_UNIT_KINDS)[number];
export const NONCONFORMANCE_CATEGORIES = [
  "pre_analytical",
  "analytical",
  "post_analytical",
  "equipment",
  "temperature_excursion",
  "qc_failure",
  "eqa_failure",
  "safety",
  "complaint",
  "other",
] as const;
export type NonconformanceCategory = (typeof NONCONFORMANCE_CATEGORIES)[number];
export const NONCONFORMANCE_SEVERITIES = ["minor", "major", "critical"] as const;
export type NonconformanceSeverity = (typeof NONCONFORMANCE_SEVERITIES)[number];
export type NonconformanceStatus = "open" | "investigating" | "closed";
export const NONCONFORMANCE_ENTRY_KINDS = ["note", "correction", "root_cause", "corrective_action", "preventive_action", "effectiveness_check"] as const;
export type NonconformanceEntryKind = (typeof NONCONFORMANCE_ENTRY_KINDS)[number] | "reclassified" | "closed";
export const EQA_EVALUATIONS = ["acceptable", "unacceptable", "not_graded"] as const;
export type EqaEvaluation = (typeof EQA_EVALUATIONS)[number];
export const COMPETENCY_METHODS = ["direct_observation", "blind_sample", "record_review", "written_assessment", "other"] as const;
export type CompetencyMethod = (typeof COMPETENCY_METHODS)[number];
export type CompetencyOutcome = "competent" | "not_yet_competent";

export const labStorageUnit = pgTable("lab_storage_unit", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  departmentId: uuid("department_id"),
  code: text("code").notNull(),
  name: text("name").notNull(),
  kind: text("kind").$type<StorageUnitKind>().notNull(),
  minCelsius: decimal("min_celsius").notNull(),
  maxCelsius: decimal("max_celsius").notNull(),
  readingIntervalHours: integer("reading_interval_hours"),
  status: text("status").$type<"active" | "retired">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const labTemperatureReading = pgTable("lab_temperature_reading", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  storageUnitId: uuid("storage_unit_id").notNull(),
  celsius: decimal("celsius").notNull(),
  minCelsius: decimal("min_celsius").notNull(),
  maxCelsius: decimal("max_celsius").notNull(),
  outOfRange: boolean("out_of_range").notNull(),
  readAt: ts("read_at").notNull(),
  note: text("note"),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
  recordedBy: uuid("recorded_by").notNull(),
});

export const labNonconformanceNumberSequence = pgTable("lab_nonconformance_number_sequence", {
  organizationId: uuid("organization_id").primaryKey(),
  nextValue: integer("next_value").notNull(),
});

export const labNonconformance = pgTable("lab_nonconformance", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  number: text("number").notNull(),
  category: text("category").$type<NonconformanceCategory>().notNull(),
  severity: text("severity").$type<NonconformanceSeverity>().notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  occurredAt: ts("occurred_at").notNull(),
  instrumentId: uuid("instrument_id"),
  qcRunId: uuid("qc_run_id"),
  temperatureReadingId: uuid("temperature_reading_id"),
  eqaResultId: uuid("eqa_result_id"),
  specimenId: uuid("specimen_id"),
  status: text("status").$type<NonconformanceStatus>().notNull().default("open"),
  reportedAt: ts("reported_at").notNull().defaultNow(),
  reportedBy: uuid("reported_by"),
  closedAt: ts("closed_at"),
  closedBy: uuid("closed_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const labNonconformanceEntry = pgTable("lab_nonconformance_entry", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  nonconformanceId: uuid("nonconformance_id").notNull(),
  kind: text("kind").$type<NonconformanceEntryKind>().notNull(),
  body: text("body").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
  recordedBy: uuid("recorded_by").notNull(),
});

export const labEqaScheme = pgTable("lab_eqa_scheme", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  provider: text("provider").notNull(),
  name: text("name").notNull(),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const labEqaSurvey = pgTable("lab_eqa_survey", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  schemeId: uuid("scheme_id").notNull(),
  roundCode: text("round_code").notNull(),
  receivedOn: date("received_on").notNull(),
  dueOn: date("due_on"),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export const labEqaResult = pgTable("lab_eqa_result", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  surveyId: uuid("survey_id").notNull(),
  testId: uuid("test_id").notNull(),
  sampleCode: text("sample_code").notNull(),
  reportedValue: text("reported_value").notNull(),
  reportedAt: ts("reported_at").notNull().defaultNow(),
  reportedBy: uuid("reported_by").notNull(),
  evaluation: text("evaluation").$type<EqaEvaluation>(),
  targetValue: text("target_value"),
  providerScore: text("provider_score"),
  evaluationNote: text("evaluation_note"),
  evaluatedAt: ts("evaluated_at"),
  evaluatedBy: uuid("evaluated_by"),
});

export const labCompetencyAssessment = pgTable("lab_competency_assessment", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  userId: uuid("user_id").notNull(),
  testId: uuid("test_id"),
  departmentId: uuid("department_id"),
  method: text("method").$type<CompetencyMethod>().notNull(),
  outcome: text("outcome").$type<CompetencyOutcome>().notNull(),
  assessedOn: date("assessed_on").notNull(),
  nextDueOn: date("next_due_on"),
  notes: text("notes"),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
  assessedBy: uuid("assessed_by").notNull(),
});

export type LabStorageUnitRecord = typeof labStorageUnit.$inferSelect;
export type LabTemperatureReadingRecord = typeof labTemperatureReading.$inferSelect;
export type LabNonconformanceRecord = typeof labNonconformance.$inferSelect;
export type LabNonconformanceEntryRecord = typeof labNonconformanceEntry.$inferSelect;
export type LabEqaSurveyRecord = typeof labEqaSurvey.$inferSelect;
export type LabEqaResultRecord = typeof labEqaResult.$inferSelect;
export type LabCompetencyAssessmentRecord = typeof labCompetencyAssessment.$inferSelect;
