import { boolean, date, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const PROFESSIONS = ['physician', 'dentist', 'nurse', 'midwife', 'medical_technologist', 'pharmacist', 'other'] as const;
export const ROOM_TYPES = ['consultation', 'triage', 'procedure', 'dental', 'other'] as const;
export const MODALITIES = ['in_person', 'telemedicine'] as const;
export const APPOINTMENT_STATUSES = ['booked', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'] as const;
export const BOOKING_CHANNELS = ['front_desk', 'phone', 'online', 'follow_up'] as const;
export const VISIT_STATUSES = ['waiting', 'in_triage', 'awaiting_consultation', 'in_consultation', 'completed', 'cancelled', 'left_without_being_seen'] as const;
export const VISIT_PRIORITIES = ['routine', 'urgent', 'emergency'] as const;
export const ALLERGY_CATEGORIES = ['medication', 'food', 'environment', 'biologic', 'other'] as const;
export const ALLERGY_STATUSES = ['active', 'inactive', 'resolved', 'entered_in_error'] as const;

export type Profession = (typeof PROFESSIONS)[number];
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export type VisitPriority = (typeof VISIT_PRIORITIES)[number];
export type Modality = (typeof MODALITIES)[number];

export const practitioner = pgTable('practitioner', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  userId: uuid('user_id'),
  displayName: text('display_name').notNull(),
  profession: text('profession').$type<Profession>().notNull(),
  specialty: text('specialty'),
  licenseNumber: text('license_number'),
  licenseValidUntil: date('license_valid_until', { mode: 'string' }),
  status: text('status').$type<'active' | 'inactive'>().notNull().default('active'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const room = pgTable('room', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  facilityId: uuid('facility_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  roomType: text('room_type').$type<(typeof ROOM_TYPES)[number]>().notNull(),
  status: text('status').$type<'active' | 'inactive'>().notNull().default('active'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const visitType = pgTable('visit_type', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  defaultDurationMinutes: integer('default_duration_minutes').notNull(),
  modality: text('modality').$type<Modality>().notNull().default('in_person'),
  requiresTriage: boolean('requires_triage').notNull().default(true),
  status: text('status').$type<'active' | 'inactive'>().notNull().default('active'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const codingSystem = pgTable('coding_system', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  version: text('version'),
  status: text('status').$type<'active' | 'inactive'>().notNull().default('active'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const practitionerSchedule = pgTable('practitioner_schedule', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  practitionerId: uuid('practitioner_id').notNull(),
  facilityId: uuid('facility_id').notNull(),
  roomId: uuid('room_id'),
  dayOfWeek: smallint('day_of_week').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  slotMinutes: integer('slot_minutes').notNull(),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  validUntil: date('valid_until', { mode: 'string' }),
  status: text('status').$type<'active' | 'retired'>().notNull().default('active'),
  createdBy: uuid('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  retiredAt: ts('retired_at'),
});

export const scheduleException = pgTable('schedule_exception', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  facilityId: uuid('facility_id').notNull(),
  practitionerId: uuid('practitioner_id'),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const appointment = pgTable('appointment', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  facilityId: uuid('facility_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  practitionerId: uuid('practitioner_id').notNull(),
  roomId: uuid('room_id'),
  visitTypeId: uuid('visit_type_id').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  status: text('status').$type<AppointmentStatus>().notNull().default('booked'),
  bookingChannel: text('booking_channel').$type<(typeof BOOKING_CHANNELS)[number]>().notNull(),
  reason: text('reason'),
  notes: text('notes'),
  seriesId: uuid('series_id'),
  confirmedAt: ts('confirmed_at'),
  checkedInAt: ts('checked_in_at'),
  completedAt: ts('completed_at'),
  noShowAt: ts('no_show_at'),
  cancelledAt: ts('cancelled_at'),
  cancelledBy: uuid('cancelled_by'),
  cancellationReason: text('cancellation_reason'),
  createdBy: uuid('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const waitlistEntry = pgTable('appointment_waitlist_entry', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  facilityId: uuid('facility_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  practitionerId: uuid('practitioner_id'),
  visitTypeId: uuid('visit_type_id'),
  earliestDate: date('earliest_date', { mode: 'string' }).notNull(),
  latestDate: date('latest_date', { mode: 'string' }).notNull(),
  priority: text('priority').$type<'routine' | 'soon'>().notNull().default('routine'),
  notes: text('notes'),
  status: text('status').$type<'waiting' | 'booked' | 'cancelled'>().notNull().default('waiting'),
  appointmentId: uuid('appointment_id'),
  createdBy: uuid('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  closedAt: ts('closed_at'),
  closedBy: uuid('closed_by'),
  closeReason: text('close_reason'),
});

export const facilityQueueCounter = pgTable(
  'facility_queue_counter',
  {
    facilityId: uuid('facility_id').notNull(),
    queueDate: date('queue_date', { mode: 'string' }).notNull(),
    nextValue: integer('next_value').notNull(),
  },
  (table) => [primaryKey({ columns: [table.facilityId, table.queueDate] })],
);

export const visit = pgTable('visit', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  facilityId: uuid('facility_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  appointmentId: uuid('appointment_id'),
  visitTypeId: uuid('visit_type_id').notNull(),
  arrivalMode: text('arrival_mode').$type<'walk_in' | 'appointment'>().notNull(),
  queueDate: date('queue_date', { mode: 'string' }).notNull(),
  queueNumber: integer('queue_number').notNull(),
  priority: text('priority').$type<VisitPriority>().notNull().default('routine'),
  status: text('status').$type<VisitStatus>().notNull().default('waiting'),
  assignedPractitionerId: uuid('assigned_practitioner_id'),
  chiefComplaint: text('chief_complaint'),
  checkedInAt: ts('checked_in_at').notNull().defaultNow(),
  checkedInBy: uuid('checked_in_by').notNull(),
  calledAt: ts('called_at'),
  calledTo: text('called_to'),
  triageStartedAt: ts('triage_started_at'),
  consultationStartedAt: ts('consultation_started_at'),
  completedAt: ts('completed_at'),
  closedReason: text('closed_reason'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const triageAssessment = pgTable('triage_assessment', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  visitId: uuid('visit_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  chiefComplaint: text('chief_complaint').notNull(),
  painScore: smallint('pain_score'),
  priority: text('priority').$type<VisitPriority>().notNull(),
  riskFlags: text('risk_flags').array().notNull().default([]),
  notes: text('notes'),
  assessedBy: uuid('assessed_by').notNull(),
  assessedAt: ts('assessed_at').notNull().defaultNow(),
  status: text('status').$type<'final' | 'entered_in_error'>().notNull().default('final'),
  enteredInErrorReason: text('entered_in_error_reason'),
  enteredInErrorBy: uuid('entered_in_error_by'),
});

export const vitalSignSet = pgTable('vital_sign_set', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  facilityId: uuid('facility_id'),
  patientId: uuid('patient_id').notNull(),
  visitId: uuid('visit_id'),
  encounterId: uuid('encounter_id'),
  measuredAt: ts('measured_at').notNull(),
  measuredBy: uuid('measured_by').notNull(),
  systolicMmhg: smallint('systolic_mmhg'),
  diastolicMmhg: smallint('diastolic_mmhg'),
  heartRateBpm: smallint('heart_rate_bpm'),
  respiratoryRateBpm: smallint('respiratory_rate_bpm'),
  temperatureC: numeric('temperature_c', { precision: 4, scale: 1, mode: 'number' }),
  spo2Percent: smallint('spo2_percent'),
  weightKg: numeric('weight_kg', { precision: 5, scale: 2, mode: 'number' }),
  heightCm: numeric('height_cm', { precision: 5, scale: 1, mode: 'number' }),
  bloodGlucoseMgDl: smallint('blood_glucose_mg_dl'),
  notes: text('notes'),
  recordedAt: ts('recorded_at').notNull().defaultNow(),
  status: text('status').$type<'final' | 'entered_in_error'>().notNull().default('final'),
  enteredInErrorReason: text('entered_in_error_reason'),
  enteredInErrorBy: uuid('entered_in_error_by'),
});

export const allergyIntolerance = pgTable('allergy_intolerance', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  category: text('category').$type<(typeof ALLERGY_CATEGORIES)[number]>().notNull(),
  substance: text('substance').notNull(),
  substanceNormalized: text('substance_normalized').notNull(),
  reaction: text('reaction'),
  severity: text('severity').$type<'mild' | 'moderate' | 'severe'>(),
  criticality: text('criticality').$type<'low' | 'high' | 'unable_to_assess'>().notNull().default('unable_to_assess'),
  verification: text('verification').$type<'unconfirmed' | 'confirmed'>().notNull().default('unconfirmed'),
  status: text('status').$type<(typeof ALLERGY_STATUSES)[number]>().notNull().default('active'),
  statusReason: text('status_reason'),
  recordedBy: uuid('recorded_by').notNull(),
  recordedAt: ts('recorded_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const allergyReview = pgTable('allergy_review', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  noKnownAllergies: boolean('no_known_allergies').notNull(),
  reviewedBy: uuid('reviewed_by').notNull(),
  reviewedAt: ts('reviewed_at').notNull().defaultNow(),
});

export const encounter = pgTable('encounter', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  facilityId: uuid('facility_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  visitId: uuid('visit_id'),
  appointmentId: uuid('appointment_id'),
  practitionerId: uuid('practitioner_id').notNull(),
  modality: text('modality').$type<Modality>().notNull().default('in_person'),
  status: text('status').$type<'in_progress' | 'completed' | 'entered_in_error'>().notNull().default('in_progress'),
  chiefComplaint: text('chief_complaint'),
  startedAt: ts('started_at').notNull().defaultNow(),
  startedBy: uuid('started_by').notNull(),
  completedAt: ts('completed_at'),
  signedByPractitionerId: uuid('signed_by_practitioner_id'),
  enteredInErrorReason: text('entered_in_error_reason'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const encounterNoteRevision = pgTable('encounter_note_revision', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  encounterId: uuid('encounter_id').notNull(),
  revisionNumber: integer('revision_number').notNull(),
  kind: text('kind').$type<'draft' | 'signed' | 'amendment'>().notNull(),
  templateKey: text('template_key').notNull().default('soap'),
  subjective: text('subjective'),
  objective: text('objective'),
  assessment: text('assessment'),
  plan: text('plan'),
  sections: jsonb('sections').$type<Record<string, unknown>>().notNull().default({}),
  amendmentReason: text('amendment_reason'),
  authoredBy: uuid('authored_by').notNull(),
  authoredAt: ts('authored_at').notNull().defaultNow(),
});

export const diagnosis = pgTable('diagnosis', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  encounterId: uuid('encounter_id').notNull(),
  codeSystemKey: text('code_system_key'),
  codeSystemVersion: text('code_system_version'),
  code: text('code'),
  display: text('display').notNull(),
  rank: text('rank').$type<'primary' | 'secondary'>().notNull().default('secondary'),
  certainty: text('certainty').$type<'provisional' | 'confirmed' | 'refuted'>().notNull().default('provisional'),
  isChronic: boolean('is_chronic').notNull().default(false),
  notes: text('notes'),
  status: text('status').$type<'active' | 'resolved' | 'entered_in_error'>().notNull().default('active'),
  statusReason: text('status_reason'),
  recordedBy: uuid('recorded_by').notNull(),
  recordedAt: ts('recorded_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export type PractitionerRecord = typeof practitioner.$inferSelect;
export type AppointmentRecord = typeof appointment.$inferSelect;
export type VisitRecord = typeof visit.$inferSelect;
export type EncounterRecord = typeof encounter.$inferSelect;
export type DiagnosisRecord = typeof diagnosis.$inferSelect;
export type VitalSignSetRecord = typeof vitalSignSet.$inferSelect;
export type AllergyRecord = typeof allergyIntolerance.$inferSelect;
export type ScheduleRecord = typeof practitionerSchedule.$inferSelect;
