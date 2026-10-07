import { boolean, date, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0082_patient_history.sql, 0083_reported_medications.sql and 0103_patient_history_portal.sql
// (the migrations are the source of truth).

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** The sections of a patient's history. */
export const HISTORY_SECTIONS = ["procedure", "condition", "medication", "family", "family_review", "social"] as const;
export type HistorySection = (typeof HISTORY_SECTIONS)[number];

/** How precisely a past date is known (a year is kept as 1 January, a month as its first day). */
export const HISTORY_DATE_PRECISIONS = ["year", "month", "day"] as const;
export type HistoryDatePrecision = (typeof HISTORY_DATE_PRECISIONS)[number];

/** Who told the organization (source `reported`). */
export const HISTORY_INFORMANTS = ["patient", "relative", "other_provider"] as const;
export type HistoryInformant = (typeof HISTORY_INFORMANTS)[number];

export const PAST_PROCEDURE_SOURCES = ["reported", "recorded_here", "external_import"] as const;
export type PastProcedureSource = (typeof PAST_PROCEDURE_SOURCES)[number];
export const PAST_CONDITION_SOURCES = ["reported", "recorded_here"] as const;
export type PastConditionSource = (typeof PAST_CONDITION_SOURCES)[number];
export const PAST_CONDITION_STATUSES = ["active", "resolved", "unknown"] as const;
export type PastConditionStatus = (typeof PAST_CONDITION_STATUSES)[number];

export const REPORTED_MEDICATION_SOURCES = ["reported", "recorded_here"] as const;
export type ReportedMedicationSource = (typeof REPORTED_MEDICATION_SOURCES)[number];
/** As reported when recorded: still taking, already stopped, or not known. */
export const REPORTED_MEDICATION_STATUSES = ["taking", "stopped", "unknown"] as const;
export type ReportedMedicationStatus = (typeof REPORTED_MEDICATION_STATUSES)[number];

/** The relative, from a fixed clinical list (exported as HL7 v3 RoleCode); free text adds detail or names "other". */
export const FAMILY_RELATIONSHIPS = [
  "mother",
  "father",
  "sister",
  "brother",
  "sibling",
  "half_sibling",
  "daughter",
  "son",
  "child",
  "maternal_grandmother",
  "maternal_grandfather",
  "paternal_grandmother",
  "paternal_grandfather",
  "maternal_aunt",
  "maternal_uncle",
  "paternal_aunt",
  "paternal_uncle",
  "cousin",
  "other",
] as const;
export type FamilyRelationship = (typeof FAMILY_RELATIONSHIPS)[number];
export const FAMILY_HISTORY_SOURCES = ["reported", "external_import"] as const;
export type FamilyHistorySource = (typeof FAMILY_HISTORY_SOURCES)[number];
export const FAMILY_REVIEW_OUTCOMES = ["reviewed", "none_known", "unknown"] as const;
export type FamilyReviewOutcome = (typeof FAMILY_REVIEW_OUTCOMES)[number];
export const FAMILY_UNKNOWN_REASONS = ["adopted", "not_known", "declined_to_answer"] as const;
export type FamilyUnknownReason = (typeof FAMILY_UNKNOWN_REASONS)[number];

export const USE_STATUSES = ["never", "former", "current", "unknown"] as const;
export type UseStatus = (typeof USE_STATUSES)[number];

/** Who recorded an entry: a staff user (`recordedBy`), or a MyHealth account (`portalAccountId`, with the guardian's grant when acting). */
export const HISTORY_RECORDED_VIA = ["staff", "patient_portal"] as const;
export type HistoryRecordedVia = (typeof HISTORY_RECORDED_VIA)[number];

const enteredInError = {
  enteredInErrorReason: text("entered_in_error_reason"),
  enteredInErrorBy: uuid("entered_in_error_by"),
  enteredInErrorAt: ts("entered_in_error_at"),
};

/** `recorded_by` is null for an entry recorded through MyHealth (migration 0103). */
const recordedBy = {
  recordedBy: uuid("recorded_by"),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
  recordedVia: text("recorded_via").$type<HistoryRecordedVia>().notNull().default("staff"),
  portalAccountId: uuid("portal_account_id"),
  proxyGrantId: uuid("proxy_grant_id"),
};

export const pastProcedure = pgTable("past_procedure", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id"),
  description: text("description").notNull(),
  codeSystem: text("code_system"),
  code: text("code"),
  performedDate: date("performed_date", { mode: "string" }),
  performedPrecision: text("performed_precision").$type<HistoryDatePrecision>(),
  performer: text("performer"),
  bodySite: text("body_site"),
  notes: text("notes"),
  source: text("source").$type<PastProcedureSource>().notNull(),
  reportedBy: text("reported_by").$type<HistoryInformant>(),
  sourceDescription: text("source_description"),
  sourceReference: text("source_reference"),
  declaredSource: text("declared_source"),
  recorderPractitionerId: uuid("recorder_practitioner_id"),
  ...enteredInError,
  ...recordedBy,
});

export const pastCondition = pgTable("past_condition", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id"),
  description: text("description").notNull(),
  codeSystem: text("code_system"),
  code: text("code"),
  onsetDate: date("onset_date", { mode: "string" }),
  onsetPrecision: text("onset_precision").$type<HistoryDatePrecision>(),
  reportedStatus: text("reported_status").$type<PastConditionStatus>().notNull(),
  diagnosedBy: text("diagnosed_by"),
  notes: text("notes"),
  source: text("source").$type<PastConditionSource>().notNull(),
  reportedBy: text("reported_by").$type<HistoryInformant>(),
  sourceDescription: text("source_description"),
  recorderPractitionerId: uuid("recorder_practitioner_id"),
  ...enteredInError,
  ...recordedBy,
});

/** A medicine the patient takes that was not prescribed here (prescribed elsewhere, over the counter, supplements). */
export const reportedMedication = pgTable("reported_medication", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id"),
  medication: text("medication").notNull(),
  codeSystem: text("code_system"),
  code: text("code"),
  doseText: text("dose_text"),
  reason: text("reason"),
  prescribedBy: text("prescribed_by"),
  startedDate: date("started_date", { mode: "string" }),
  startedPrecision: text("started_precision").$type<HistoryDatePrecision>(),
  reportedStatus: text("reported_status").$type<ReportedMedicationStatus>().notNull(),
  stoppedDate: date("stopped_date", { mode: "string" }),
  stoppedPrecision: text("stopped_precision").$type<HistoryDatePrecision>(),
  notes: text("notes"),
  source: text("source").$type<ReportedMedicationSource>().notNull(),
  reportedBy: text("reported_by").$type<HistoryInformant>(),
  sourceDescription: text("source_description"),
  recorderPractitionerId: uuid("recorder_practitioner_id"),
  stopRecordedAt: ts("stop_recorded_at"),
  stopRecordedBy: uuid("stop_recorded_by"),
  /** The MyHealth account that marked it stopped (instead of a staff user). */
  stopPortalAccountId: uuid("stop_portal_account_id"),
  stopNote: text("stop_note"),
  ...enteredInError,
  ...recordedBy,
});

export const familyHistoryEntry = pgTable("family_history_entry", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id"),
  relationship: text("relationship").$type<FamilyRelationship>().notNull(),
  relationshipText: text("relationship_text"),
  condition: text("condition").notNull(),
  codeSystem: text("code_system"),
  code: text("code"),
  onsetAge: smallint("onset_age"),
  deceased: boolean("deceased"),
  causeOfDeath: text("cause_of_death"),
  notes: text("notes"),
  source: text("source").$type<FamilyHistorySource>().notNull(),
  reportedBy: text("reported_by").$type<HistoryInformant>(),
  sourceReference: text("source_reference"),
  declaredSource: text("declared_source"),
  ...enteredInError,
  ...recordedBy,
});

export const familyHistoryReview = pgTable("family_history_review", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id"),
  outcome: text("outcome").$type<FamilyReviewOutcome>().notNull(),
  unknownReason: text("unknown_reason").$type<FamilyUnknownReason>(),
  notes: text("notes"),
  reviewedBy: uuid("reviewed_by").notNull(),
  reviewedAt: ts("reviewed_at").notNull().defaultNow(),
});

export const socialHistory = pgTable("social_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id"),
  supersedesId: uuid("supersedes_id"),
  effectiveDate: date("effective_date", { mode: "string" }).notNull(),
  tobaccoStatus: text("tobacco_status").$type<UseStatus>(),
  tobaccoType: text("tobacco_type"),
  tobaccoAmount: text("tobacco_amount"),
  tobaccoQuitYear: smallint("tobacco_quit_year"),
  alcoholStatus: text("alcohol_status").$type<UseStatus>(),
  alcoholFrequency: text("alcohol_frequency"),
  substanceUse: text("substance_use"),
  occupation: text("occupation"),
  occupationalExposures: text("occupational_exposures"),
  livingSituation: text("living_situation"),
  physicalActivity: text("physical_activity"),
  diet: text("diet"),
  sexualHistory: text("sexual_history"),
  notes: text("notes"),
  ...enteredInError,
  ...recordedBy,
});

/** A questionnaire completed in MyHealth: which sections were answered and the entries it wrote (migration 0103). */
export const patientHistorySubmission = pgTable("patient_history_submission", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  portalAccountId: uuid("portal_account_id").notNull(),
  proxyGrantId: uuid("proxy_grant_id"),
  sections: text("sections").array().$type<Array<Exclude<HistorySection, "family_review">>>().notNull(),
  entryIds: uuid("entry_ids").array().notNull().default([]),
  idempotencyKey: text("idempotency_key"),
  submittedAt: ts("submitted_at").notNull().defaultNow(),
});

export type PastProcedureRecord = typeof pastProcedure.$inferSelect;
export type PastConditionRecord = typeof pastCondition.$inferSelect;
export type ReportedMedicationRecord = typeof reportedMedication.$inferSelect;
export type FamilyHistoryRecord = typeof familyHistoryEntry.$inferSelect;
export type FamilyReviewRecord = typeof familyHistoryReview.$inferSelect;
export type SocialHistoryRecord = typeof socialHistory.$inferSelect;
export type PatientHistorySubmissionRecord = typeof patientHistorySubmission.$inferSelect;
