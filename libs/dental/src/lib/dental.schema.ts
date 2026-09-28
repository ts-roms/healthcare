import { bigint, boolean, date, integer, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0027_dental.sql, 0041_dental_periodontal.sql and 0056_dental_portal.sql (the migrations are
// the source of truth).

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const NOTATIONS = ["fdi", "universal", "palmer"] as const;
export type Notation = (typeof NOTATIONS)[number];
export const PROCEDURE_SITES = ["mouth", "tooth", "surface"] as const;
export type ProcedureSite = (typeof PROCEDURE_SITES)[number];
export const CHART_EFFECTS = ["restoration", "sealant", "crown", "root_canal", "missing", "implant", "pontic"] as const;
export type ChartEffect = (typeof CHART_EFFECTS)[number];
export const TOOTH_CONDITIONS = [
  "caries",
  "restoration",
  "sealant",
  "fracture",
  "crown",
  "root_canal",
  "missing",
  "implant",
  "pontic",
  "impacted",
  "unerupted",
  "watch",
] as const;
export type ToothCondition = (typeof TOOTH_CONDITIONS)[number];
export const SURFACES = ["M", "D", "O", "I", "B", "L"] as const;
export type Surface = (typeof SURFACES)[number];
export const ORAL_HYGIENE = ["good", "fair", "poor"] as const;
export const PLAN_STATUSES = ["proposed", "accepted", "in_progress", "completed", "declined", "discontinued"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const PLAN_ITEM_STATUSES = ["proposed", "accepted", "declined", "completed", "cancelled"] as const;
export type PlanItemStatus = (typeof PLAN_ITEM_STATUSES)[number];
export const IMAGE_KINDS = ["periapical", "bitewing", "panoramic", "cephalometric", "occlusal", "cbct", "intraoral_photo", "extraoral_photo", "other"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];
/** Periodontal probing sites: mesio-, mid- and disto-buccal; mesio-, mid- and disto-lingual (palatal on upper teeth). */
export const PERIO_SITES = ["MB", "B", "DB", "ML", "L", "DL"] as const;
export type PerioSite = (typeof PERIO_SITES)[number];
type RecordStatus = "recorded" | "entered_in_error";

export const dentalFacilitySetting = pgTable("dental_facility_setting", {
  facilityId: uuid("facility_id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  notation: text("notation").$type<Notation>().notNull().default("fdi"),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const dentalProcedureType = pgTable("dental_procedure_type", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  site: text("site").$type<ProcedureSite>().notNull(),
  chartEffect: text("chart_effect").$type<ChartEffect>(),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
export type DentalProcedureTypeRecord = typeof dentalProcedureType.$inferSelect;

export const dentalExamination = pgTable("dental_examination", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id").notNull(),
  practitionerId: uuid("practitioner_id").notNull(),
  oralHygiene: text("oral_hygiene").$type<(typeof ORAL_HYGIENE)[number]>(),
  notes: text("notes"),
  status: text("status").$type<RecordStatus>().notNull().default("recorded"),
  enteredInErrorReason: text("entered_in_error_reason"),
  enteredInErrorAt: ts("entered_in_error_at"),
  enteredInErrorBy: uuid("entered_in_error_by"),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});
export type DentalExaminationRecord = typeof dentalExamination.$inferSelect;

export const dentalTreatmentPlan = pgTable("dental_treatment_plan", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  practitionerId: uuid("practitioner_id").notNull(),
  title: text("title").notNull(),
  notes: text("notes"),
  status: text("status").$type<PlanStatus>().notNull().default("proposed"),
  decisionNote: text("decision_note"),
  decidedAt: ts("decided_at"),
  decidedBy: uuid("decided_by"),
  discontinuedReason: text("discontinued_reason"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
export type DentalTreatmentPlanRecord = typeof dentalTreatmentPlan.$inferSelect;

export const dentalTreatmentPlanItem = pgTable("dental_treatment_plan_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  planId: uuid("plan_id").notNull(),
  phase: smallint("phase").notNull().default(1),
  procedureTypeId: uuid("procedure_type_id").notNull(),
  tooth: text("tooth"),
  surfaces: text("surfaces").array().$type<Surface[]>().notNull().default([]),
  note: text("note"),
  status: text("status").$type<PlanItemStatus>().notNull().default("proposed"),
  procedureId: uuid("procedure_id"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
export type DentalTreatmentPlanItemRecord = typeof dentalTreatmentPlanItem.$inferSelect;

export const dentalProcedure = pgTable("dental_procedure", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id").notNull(),
  practitionerId: uuid("practitioner_id").notNull(),
  procedureTypeId: uuid("procedure_type_id").notNull(),
  tooth: text("tooth"),
  surfaces: text("surfaces").array().$type<Surface[]>().notNull().default([]),
  notes: text("notes"),
  planItemId: uuid("plan_item_id"),
  status: text("status").$type<RecordStatus>().notNull().default("recorded"),
  enteredInErrorReason: text("entered_in_error_reason"),
  enteredInErrorAt: ts("entered_in_error_at"),
  enteredInErrorBy: uuid("entered_in_error_by"),
  performedAt: ts("performed_at").notNull().defaultNow(),
  recordedBy: uuid("recorded_by").notNull(),
});
export type DentalProcedureRecord = typeof dentalProcedure.$inferSelect;

export const dentalToothState = pgTable("dental_tooth_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  sequence: bigint("sequence", { mode: "number" }).generatedAlwaysAsIdentity(),
  tooth: text("tooth").notNull(),
  sourceType: text("source_type").$type<"examination" | "procedure">().notNull(),
  examinationId: uuid("examination_id"),
  procedureId: uuid("procedure_id"),
  note: text("note"),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});

export const dentalToothFinding = pgTable("dental_tooth_finding", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  stateId: uuid("state_id").notNull(),
  condition: text("condition").$type<ToothCondition>().notNull(),
  surfaces: text("surfaces").array().$type<Surface[]>().notNull().default([]),
});

export const dentalImage = pgTable("dental_image", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  documentId: uuid("document_id").notNull(),
  encounterId: uuid("encounter_id"),
  kind: text("kind").$type<ImageKind>().notNull(),
  teeth: text("teeth").array().notNull().default([]),
  takenOn: date("taken_on", { mode: "string" }).notNull(),
  notes: text("notes"),
  status: text("status").$type<RecordStatus>().notNull().default("recorded"),
  enteredInErrorReason: text("entered_in_error_reason"),
  enteredInErrorAt: ts("entered_in_error_at"),
  enteredInErrorBy: uuid("entered_in_error_by"),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});
export type DentalImageRecord = typeof dentalImage.$inferSelect;

// ---- periodontal charting (0041) ------------------------------------------------------------------------

export const dentalPerioChart = pgTable("dental_perio_chart", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id").notNull(),
  practitionerId: uuid("practitioner_id").notNull(),
  notes: text("notes"),
  status: text("status").$type<RecordStatus>().notNull().default("recorded"),
  enteredInErrorReason: text("entered_in_error_reason"),
  enteredInErrorAt: ts("entered_in_error_at"),
  enteredInErrorBy: uuid("entered_in_error_by"),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});

export const dentalPerioTooth = pgTable("dental_perio_tooth", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  chartId: uuid("chart_id").notNull(),
  tooth: text("tooth").notNull(),
  mobility: smallint("mobility"),
  furcation: smallint("furcation"),
});

export const dentalPerioSite = pgTable("dental_perio_site", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  toothId: uuid("tooth_id").notNull(),
  site: text("site").$type<PerioSite>().notNull(),
  probingDepth: smallint("probing_depth"),
  gingivalMargin: smallint("gingival_margin"),
  bleeding: boolean("bleeding").notNull().default(false),
  suppuration: boolean("suppuration").notNull().default(false),
  plaque: boolean("plaque").notNull().default(false),
});

export type DentalPerioChartRecord = typeof dentalPerioChart.$inferSelect;

// ---- MyHealth dental records (0056) ---------------------------------------------------------------------

/** The organization's choice to show patients their dental records in MyHealth (off by default). */
export const dentalOrganizationSetting = pgTable("dental_organization_setting", {
  organizationId: uuid("organization_id").primaryKey(),
  portalDentalRecords: boolean("portal_dental_records").notNull().default(false),
  version: integer("version").notNull().default(1),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
