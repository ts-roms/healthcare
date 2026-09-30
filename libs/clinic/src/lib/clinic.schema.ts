import { bigint, boolean, date, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, time, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const PROFESSIONS = ["physician", "dentist", "nurse", "midwife", "medical_technologist", "pharmacist", "other"] as const;
export const ROOM_TYPES = ["consultation", "triage", "procedure", "dental", "other"] as const;
export const MODALITIES = ["in_person", "telemedicine"] as const;
export const APPOINTMENT_STATUSES = ["booked", "confirmed", "checked_in", "completed", "cancelled", "no_show"] as const;
export const BOOKING_CHANNELS = ["front_desk", "phone", "online", "follow_up"] as const;
export const VISIT_STATUSES = [
  "waiting",
  "in_triage",
  "awaiting_consultation",
  "in_consultation",
  "completed",
  "cancelled",
  "left_without_being_seen",
] as const;
export const VISIT_PRIORITIES = ["routine", "urgent", "emergency"] as const;
export const ALLERGY_CATEGORIES = ["medication", "food", "environment", "biologic", "other"] as const;
export const ALLERGY_STATUSES = ["active", "inactive", "resolved", "entered_in_error"] as const;
export const ALLERGY_SOURCES = ["staff", "external_import"] as const;
export const EXTERNAL_HISTORY_KINDS = ["condition", "observation", "medication", "document"] as const;

export type Profession = (typeof PROFESSIONS)[number];
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export type VisitPriority = (typeof VISIT_PRIORITIES)[number];
export type Modality = (typeof MODALITIES)[number];

export const practitioner = pgTable("practitioner", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  userId: uuid("user_id"),
  displayName: text("display_name").notNull(),
  profession: text("profession").$type<Profession>().notNull(),
  specialty: text("specialty"),
  licenseNumber: text("license_number"),
  licenseValidUntil: date("license_valid_until", { mode: "string" }),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const room = pgTable("room", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  roomType: text("room_type").$type<(typeof ROOM_TYPES)[number]>().notNull(),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const visitType = pgTable("visit_type", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  defaultDurationMinutes: integer("default_duration_minutes").notNull(),
  modality: text("modality").$type<Modality>().notNull().default("in_person"),
  requiresTriage: boolean("requires_triage").notNull().default(true),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
  /** Patients may book this visit type themselves in MyHealth. */
  onlineBooking: boolean("online_booking").notNull().default(false),
  version: integer("version").notNull().default(1),
});

export const codingSystem = pgTable("coding_system", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  version: text("version"),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const practitionerSchedule = pgTable("practitioner_schedule", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  practitionerId: uuid("practitioner_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  roomId: uuid("room_id"),
  dayOfWeek: smallint("day_of_week").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  slotMinutes: integer("slot_minutes").notNull(),
  validFrom: date("valid_from", { mode: "string" }).notNull(),
  validUntil: date("valid_until", { mode: "string" }),
  status: text("status").$type<"active" | "retired">().notNull().default("active"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  retiredAt: ts("retired_at"),
});

export const scheduleException = pgTable("schedule_exception", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  practitionerId: uuid("practitioner_id"),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const appointment = pgTable("appointment", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  practitionerId: uuid("practitioner_id").notNull(),
  roomId: uuid("room_id"),
  visitTypeId: uuid("visit_type_id").notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  status: text("status").$type<AppointmentStatus>().notNull().default("booked"),
  bookingChannel: text("booking_channel").$type<(typeof BOOKING_CHANNELS)[number]>().notNull(),
  reason: text("reason"),
  notes: text("notes"),
  seriesId: uuid("series_id"),
  confirmedAt: ts("confirmed_at"),
  checkedInAt: ts("checked_in_at"),
  completedAt: ts("completed_at"),
  noShowAt: ts("no_show_at"),
  cancelledAt: ts("cancelled_at"),
  cancelledBy: uuid("cancelled_by"),
  cancellationReason: text("cancellation_reason"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  bookedByPatient: boolean("booked_by_patient").notNull().default(false),
  updatedByPatient: boolean("updated_by_patient").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const waitlistEntry = pgTable("appointment_waitlist_entry", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  practitionerId: uuid("practitioner_id"),
  visitTypeId: uuid("visit_type_id"),
  earliestDate: date("earliest_date", { mode: "string" }).notNull(),
  latestDate: date("latest_date", { mode: "string" }).notNull(),
  priority: text("priority").$type<"routine" | "soon">().notNull().default("routine"),
  notes: text("notes"),
  status: text("status").$type<"waiting" | "booked" | "cancelled">().notNull().default("waiting"),
  appointmentId: uuid("appointment_id"),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  closedAt: ts("closed_at"),
  closedBy: uuid("closed_by"),
  closeReason: text("close_reason"),
});

export const facilityQueueCounter = pgTable(
  "facility_queue_counter",
  {
    facilityId: uuid("facility_id").notNull(),
    queueDate: date("queue_date", { mode: "string" }).notNull(),
    nextValue: integer("next_value").notNull(),
  },
  (table) => [primaryKey({ columns: [table.facilityId, table.queueDate] })],
);

export const visit = pgTable("visit", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  appointmentId: uuid("appointment_id"),
  visitTypeId: uuid("visit_type_id").notNull(),
  arrivalMode: text("arrival_mode").$type<"walk_in" | "appointment">().notNull(),
  queueDate: date("queue_date", { mode: "string" }).notNull(),
  queueNumber: integer("queue_number").notNull(),
  priority: text("priority").$type<VisitPriority>().notNull().default("routine"),
  status: text("status").$type<VisitStatus>().notNull().default("waiting"),
  assignedPractitionerId: uuid("assigned_practitioner_id"),
  chiefComplaint: text("chief_complaint"),
  checkedInAt: ts("checked_in_at").notNull().defaultNow(),
  checkedInBy: uuid("checked_in_by"),
  checkedInVia: text("checked_in_via").$type<"staff" | "patient_portal">().notNull().default("staff"),
  calledAt: ts("called_at"),
  calledTo: text("called_to"),
  triageStartedAt: ts("triage_started_at"),
  consultationStartedAt: ts("consultation_started_at"),
  completedAt: ts("completed_at"),
  closedReason: text("closed_reason"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const triageAssessment = pgTable("triage_assessment", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  visitId: uuid("visit_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  chiefComplaint: text("chief_complaint").notNull(),
  painScore: smallint("pain_score"),
  priority: text("priority").$type<VisitPriority>().notNull(),
  riskFlags: text("risk_flags").array().notNull().default([]),
  notes: text("notes"),
  assessedBy: uuid("assessed_by").notNull(),
  assessedAt: ts("assessed_at").notNull().defaultNow(),
  status: text("status").$type<"final" | "entered_in_error">().notNull().default("final"),
  enteredInErrorReason: text("entered_in_error_reason"),
  enteredInErrorBy: uuid("entered_in_error_by"),
});

export const vitalSignSet = pgTable("vital_sign_set", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id"),
  patientId: uuid("patient_id").notNull(),
  visitId: uuid("visit_id"),
  encounterId: uuid("encounter_id"),
  measuredAt: ts("measured_at").notNull(),
  measuredBy: uuid("measured_by").notNull(),
  systolicMmhg: smallint("systolic_mmhg"),
  diastolicMmhg: smallint("diastolic_mmhg"),
  heartRateBpm: smallint("heart_rate_bpm"),
  respiratoryRateBpm: smallint("respiratory_rate_bpm"),
  temperatureC: numeric("temperature_c", { precision: 4, scale: 1, mode: "number" }),
  spo2Percent: smallint("spo2_percent"),
  weightKg: numeric("weight_kg", { precision: 5, scale: 2, mode: "number" }),
  heightCm: numeric("height_cm", { precision: 5, scale: 1, mode: "number" }),
  bloodGlucoseMgDl: smallint("blood_glucose_mg_dl"),
  notes: text("notes"),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
  status: text("status").$type<"final" | "entered_in_error">().notNull().default("final"),
  enteredInErrorReason: text("entered_in_error_reason"),
  enteredInErrorBy: uuid("entered_in_error_by"),
});

export const allergyIntolerance = pgTable("allergy_intolerance", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  category: text("category").$type<(typeof ALLERGY_CATEGORIES)[number]>().notNull(),
  substance: text("substance").notNull(),
  substanceNormalized: text("substance_normalized").notNull(),
  reaction: text("reaction"),
  severity: text("severity").$type<"mild" | "moderate" | "severe">(),
  criticality: text("criticality").$type<"low" | "high" | "unable_to_assess">().notNull().default("unable_to_assess"),
  verification: text("verification").$type<"unconfirmed" | "confirmed">().notNull().default("unconfirmed"),
  status: text("status").$type<(typeof ALLERGY_STATUSES)[number]>().notNull().default("active"),
  statusReason: text("status_reason"),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
  /** Where the allergy came from: staff entry, or accepted from an external import (migration 0048). */
  source: text("source").$type<(typeof ALLERGY_SOURCES)[number]>().notNull().default("staff"),
  /** For an import: "fhir-import:<import id>#<entry index>". */
  sourceReference: text("source_reference"),
});

export const allergyReview = pgTable("allergy_review", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  noKnownAllergies: boolean("no_known_allergies").notNull(),
  reviewedBy: uuid("reviewed_by").notNull(),
  reviewedAt: ts("reviewed_at").notNull().defaultNow(),
});

export const encounter = pgTable("encounter", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  visitId: uuid("visit_id"),
  appointmentId: uuid("appointment_id"),
  practitionerId: uuid("practitioner_id").notNull(),
  modality: text("modality").$type<Modality>().notNull().default("in_person"),
  status: text("status").$type<"in_progress" | "completed" | "entered_in_error">().notNull().default("in_progress"),
  chiefComplaint: text("chief_complaint"),
  startedAt: ts("started_at").notNull().defaultNow(),
  startedBy: uuid("started_by").notNull(),
  completedAt: ts("completed_at"),
  signedByPractitionerId: uuid("signed_by_practitioner_id"),
  enteredInErrorReason: text("entered_in_error_reason"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const encounterNoteRevision = pgTable("encounter_note_revision", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  encounterId: uuid("encounter_id").notNull(),
  revisionNumber: integer("revision_number").notNull(),
  kind: text("kind").$type<"draft" | "signed" | "amendment">().notNull(),
  templateKey: text("template_key").notNull().default("soap"),
  subjective: text("subjective"),
  objective: text("objective"),
  assessment: text("assessment"),
  plan: text("plan"),
  sections: jsonb("sections").$type<Record<string, unknown>>().notNull().default({}),
  amendmentReason: text("amendment_reason"),
  authoredBy: uuid("authored_by").notNull(),
  authoredAt: ts("authored_at").notNull().defaultNow(),
});

export const diagnosis = pgTable("diagnosis", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id").notNull(),
  codeSystemKey: text("code_system_key"),
  codeSystemVersion: text("code_system_version"),
  code: text("code"),
  display: text("display").notNull(),
  rank: text("rank").$type<"primary" | "secondary">().notNull().default("secondary"),
  certainty: text("certainty").$type<"provisional" | "confirmed" | "refuted">().notNull().default("provisional"),
  isChronic: boolean("is_chronic").notNull().default(false),
  notes: text("notes"),
  status: text("status").$type<"active" | "resolved" | "entered_in_error">().notNull().default("active"),
  statusReason: text("status_reason"),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * External clinical history accepted from an import (migration 0048): what another provider recorded, labelled as
 * such. Not an internal diagnosis, vital sign, laboratory result or prescription. Append-only except entered in error.
 */
export const externalHistoryEntry = pgTable("external_history_entry", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  kind: text("kind").$type<(typeof EXTERNAL_HISTORY_KINDS)[number]>().notNull(),
  category: text("category"),
  display: text("display").notNull(),
  codeSystem: text("code_system"),
  code: text("code"),
  valueText: text("value_text"),
  statusText: text("status_text"),
  effectiveText: text("effective_text"),
  source: text("source").$type<"external_import">().notNull().default("external_import"),
  sourceReference: text("source_reference").notNull(),
  declaredSource: text("declared_source"),
  status: text("status").$type<"active" | "entered_in_error">().notNull().default("active"),
  enteredInErrorReason: text("entered_in_error_reason"),
  enteredInErrorBy: uuid("entered_in_error_by"),
  enteredInErrorAt: ts("entered_in_error_at"),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});

export type PractitionerRecord = typeof practitioner.$inferSelect;
export type AppointmentRecord = typeof appointment.$inferSelect;
export type VisitRecord = typeof visit.$inferSelect;
export type EncounterRecord = typeof encounter.$inferSelect;
export type DiagnosisRecord = typeof diagnosis.$inferSelect;
export type VitalSignSetRecord = typeof vitalSignSet.$inferSelect;
export type AllergyRecord = typeof allergyIntolerance.$inferSelect;
export type ExternalHistoryRecord = typeof externalHistoryEntry.$inferSelect;
export type ScheduleRecord = typeof practitionerSchedule.$inferSelect;

// ---- Medical certificates (0068) --------------------------------------------------------------

export const medicalCertificateNumberSequence = pgTable("medical_certificate_number_sequence", {
  organizationId: uuid("organization_id").primaryKey(),
  nextValue: bigint("next_value", { mode: "number" }).notNull(),
});

export const medicalCertificate = pgTable("medical_certificate", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id").notNull(),
  practitionerId: uuid("practitioner_id").notNull(),
  certificateNumber: text("certificate_number").notNull(),
  examinedOn: date("examined_on", { mode: "string" }).notNull(),
  purpose: text("purpose").notNull(),
  findings: text("findings").notNull(),
  recommendations: text("recommendations"),
  restFrom: date("rest_from", { mode: "string" }),
  restTo: date("rest_to", { mode: "string" }),
  status: text("status").$type<"issued" | "void">().notNull().default("issued"),
  issuedAt: ts("issued_at").notNull().defaultNow(),
  issuedBy: uuid("issued_by").notNull(),
  voidedAt: ts("voided_at"),
  voidedBy: uuid("voided_by"),
  voidReason: text("void_reason"),
});
export type MedicalCertificateRecord = typeof medicalCertificate.$inferSelect;

// ---- Referrals (0076) -------------------------------------------------------------------------

export const REFERRAL_KINDS = ["internal", "external"] as const;
export type ReferralKind = (typeof REFERRAL_KINDS)[number];
export const REFERRAL_URGENCIES = ["routine", "urgent", "emergency"] as const;
export type ReferralUrgency = (typeof REFERRAL_URGENCIES)[number];
export const REFERRAL_STATUSES = ["sent", "accepted", "declined", "completed", "cancelled"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const referralNumberSequence = pgTable("referral_number_sequence", {
  organizationId: uuid("organization_id").primaryKey(),
  nextValue: bigint("next_value", { mode: "number" }).notNull(),
});

export const referral = pgTable("referral", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id").notNull(),
  referringPractitionerId: uuid("referring_practitioner_id").notNull(),
  referralNumber: text("referral_number").notNull(),
  kind: text("kind").$type<ReferralKind>().notNull(),
  specialty: text("specialty"),
  toPractitionerId: uuid("to_practitioner_id"),
  externalProvider: text("external_provider"),
  externalFacility: text("external_facility"),
  externalContact: text("external_contact"),
  urgency: text("urgency").$type<ReferralUrgency>().notNull(),
  reason: text("reason").notNull(),
  clinicalSummary: text("clinical_summary"),
  diagnosisIds: uuid("diagnosis_ids").array().notNull().default([]),
  status: text("status").$type<ReferralStatus>().notNull().default("sent"),
  issuedAt: ts("issued_at").notNull().defaultNow(),
  issuedBy: uuid("issued_by").notNull(),
  respondedAt: ts("responded_at"),
  respondedBy: uuid("responded_by"),
  responseNote: text("response_note"),
  appointmentId: uuid("appointment_id"),
  completedAt: ts("completed_at"),
  completedBy: uuid("completed_by"),
  outcomeNote: text("outcome_note"),
  replyDocumentId: uuid("reply_document_id"),
  cancelledAt: ts("cancelled_at"),
  cancelledBy: uuid("cancelled_by"),
  cancelReason: text("cancel_reason"),
  version: integer("version").notNull().default(1),
});
export type ReferralRecord = typeof referral.$inferSelect;
