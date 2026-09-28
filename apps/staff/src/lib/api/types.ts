/**
 * Response shapes of the healthcare API (apps/api) used by the staff app.
 *
 * Hand-mirrored from the API's views/DTOs because the frontend may not import
 * backend libraries (layer:ui boundary). Move these into `type:contract`
 * libraries (or generate them from the OpenAPI document) as domains grow.
 */

import type { ToothFinding, ToothNotation, ToothSurface } from "@healthcare/domain";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export interface TokenResponse {
  status: "authenticated";
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  organizationId: string;
}

export interface MfaRequiredResponse {
  status: "mfa_required";
  challengeToken: string;
}

export type LoginResponse = TokenResponse | MfaRequiredResponse;

export interface OrganizationChoice {
  id: string;
  code?: string;
  name: string;
}

export interface Me {
  user: { id: string; email: string; displayName: string; mfaEnabled: boolean; isPlatformAdmin: boolean };
  organization: { id: string; code: string; name: string };
  facilityId: string | null;
  permissions: string[];
}

export interface Facility {
  id: string;
  code: string;
  name: string;
  facilityType: string;
  timezone: string;
  status: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export type PatientSex = "male" | "female" | "intersex" | "unknown";

export interface PatientSummary {
  id: string;
  patientNumber: string;
  displayName: string;
  sex: PatientSex;
  birthDate: string;
  age: number;
  status: string;
  mergedIntoPatientId: string | null;
  primaryMobileMasked: string | null;
}

export interface PatientContact {
  id: string;
  system: "mobile" | "phone" | "email";
  value: string;
  use: string | null;
  isPrimary: boolean;
}

export interface PatientAddress {
  id: string;
  use: string | null;
  /** House/unit number, street, subdivision or sitio/purok. */
  line1: string | null;
  barangay: string | null;
  cityMunicipality: string;
  province: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  psgcCode: string | null;
  isPrimary: boolean;
}

export interface PatientIdentifier {
  id: string;
  type: string;
  value: string;
  issuer: string | null;
  validFrom: string | null;
  validUntil: string | null;
}

export interface PatientRelationship {
  id: string;
  relationship: string;
  relatedPatientId: string | null;
  name: string | null;
  contactNumber: string | null;
  isEmergencyContact: boolean;
  isLegalGuardian: boolean;
  notes: string | null;
}

export interface PatientConsent {
  id: string;
  consentType: string;
  decision: string;
  effectiveAt: string;
  expiresAt: string | null;
  capturedVia: string;
  /** The signed form, when one was attached. */
  documentId: string | null;
  notes: string | null;
  recordedAt: string;
}

export interface PatientDetail {
  id: string;
  patientNumber: string;
  displayName: string;
  familyName: string;
  givenName: string;
  middleName: string | null;
  suffix: string | null;
  sex: PatientSex;
  genderIdentity: string | null;
  birthDate: string;
  birthDateIsEstimated: boolean;
  age: number;
  civilStatus: string | null;
  nationality: string | null;
  occupation: string | null;
  status: string;
  deceasedAt: string | null;
  mergedIntoPatientId: string | null;
  registeredFacilityId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  contacts: PatientContact[];
  addresses: PatientAddress[];
  identifiers: PatientIdentifier[];
  relationships: PatientRelationship[];
  consents: PatientConsent[];
  communicationPreferences: Array<{ channel: string; category: string; optedIn: boolean }>;
}

export interface DuplicateCandidate {
  patient: PatientSummary;
  level: "certain" | "high" | "possible";
  reasons: string[];
}

export interface RegisteredPatient {
  id: string;
  patientNumber: string;
  version: number;
}

// ---- Patient 360 summary (GET /patients/:id/summary; needs patient.read + clinical.read) -----------

export interface AllergyRecord {
  id: string;
  category: "medication" | "food" | "environment" | "biologic" | "other";
  substance: string;
  reaction: string | null;
  severity: "mild" | "moderate" | "severe" | null;
  criticality: "low" | "high" | "unable_to_assess";
  verification: "unconfirmed" | "confirmed";
  status?: "active" | "inactive" | "resolved" | "entered_in_error";
  recordedAt: string;
  /** Optimistic lock for status changes. */
  version?: number;
}

export interface AllergySummary {
  allergies: AllergyRecord[];
  /** "not_reviewed" (never asked) is clinically different from "no_known_allergies". */
  status: "has_allergies" | "no_known_allergies" | "not_reviewed";
  lastReviewedAt: string | null;
}

export interface ProblemRecord {
  id: string;
  code: string;
  display: string;
  codeSystemKey: string;
  isChronic: boolean;
  certainty: "provisional" | "confirmed" | "refuted";
  recordedAt: string;
}

export interface VitalsRecord {
  id: string;
  measuredAt: string;
  systolicMmhg: number | null;
  diastolicMmhg: number | null;
  heartRateBpm: number | null;
  respiratoryRateBpm: number | null;
  temperatureC: number | null;
  spo2Percent: number | null;
  weightKg: number | null;
  heightCm: number | null;
}

export interface UpcomingAppointment {
  id: string;
  startsAt: string;
  status: string;
  reason: string | null;
}

export interface PrescriptionItemView {
  id: string;
  genericName: string;
  brandName: string | null;
  strength: string | null;
  dosageForm: string | null;
  frequency: string;
  frequencyText: string | null;
  instructions: string;
}

export interface PrescriptionSummaryView {
  id: string;
  issuedAt: string;
  items: PrescriptionItemView[];
}

export interface CarePlanSummaryView {
  id: string;
  title: string;
  status: string;
  startDate: string;
  openActivities: Array<{ id: string }>;
}

export interface PatientSummaryResponse {
  allergies: AllergySummary;
  problemList: ProblemRecord[];
  recentEncounters: Array<{ id: string; startedAt: string | null; status: string }>;
  latestVitals: VitalsRecord[];
  upcomingAppointments: UpcomingAppointment[];
  /** null when the viewer lacks prescription.read. */
  activePrescriptions: PrescriptionSummaryView[] | null;
  /** null when the viewer lacks care-plan.read. */
  openCarePlans: CarePlanSummaryView[] | null;
}

// ---- Clinic: queue and appointments (Phase 2) -----------------------------------------------------

export interface PatientBrief {
  patientNumber: string;
  displayName: string;
  sex: PatientSex;
  age: number;
}

export type VisitStatus = "waiting" | "in_triage" | "awaiting_consultation" | "in_consultation" | "completed" | "cancelled" | "left_without_being_seen";
export type VisitPriority = "routine" | "urgent" | "emergency";

/** GET /queue row. */
export interface QueueVisit {
  id: string;
  facilityId: string;
  patientId: string;
  appointmentId: string | null;
  arrivalMode: "walk_in" | "appointment";
  ticket: string;
  queueNumber: number;
  queueDate: string;
  priority: VisitPriority;
  status: VisitStatus;
  chiefComplaint: string | null;
  checkedInAt: string;
  calledAt: string | null;
  calledTo: string | null;
  assignedPractitionerId: string | null;
  version: number;
  waitingMinutes: number;
  patient: PatientBrief | null;
  /** The visit's consultation once started. */
  encounterId: string | null;
}

/** A visit as returned by the queue commands (walk-in, check-in, move, call). */
export type Visit = Omit<QueueVisit, "patient" | "waitingMinutes" | "encounterId">;

export type AppointmentStatusApi = "booked" | "confirmed" | "checked_in" | "completed" | "cancelled" | "no_show";

/** GET /appointments row. */
export interface AppointmentItem {
  id: string;
  facilityId: string;
  patientId: string;
  practitionerId: string;
  visitTypeId: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatusApi;
  bookingChannel: string;
  /** Booked by the patient in MyHealth (no staff user). */
  bookedByPatient?: boolean;
  reason: string | null;
  version: number;
  patient: PatientBrief | null;
}

export interface Practitioner {
  id: string;
  userId: string | null;
  displayName: string;
  profession: string;
  specialty: string | null;
  status: "active" | "inactive";
}

export interface VisitType {
  id: string;
  code: string;
  name: string;
  defaultDurationMinutes: number;
  modality: "in_person" | "telemedicine";
  status: "active" | "inactive";
  requiresTriage: boolean;
  /** Patients may book this visit type themselves in MyHealth. */
  onlineBooking: boolean;
  version: number;
}

export interface Availability {
  date: string;
  timeZone: string;
  durationMinutes: number;
  slots: Array<{ startsAt: string; endsAt: string; roomId: string | null }>;
}

/** `GET /patients/:id/portal-account` */
export interface PortalAccountStatus {
  status: "none" | "invited" | "active" | "disabled";
  email: string | null;
  invitedAt: string | null;
  activationExpiresAt: string | null;
  /** The invitation code can no longer be used (expired or too many wrong attempts). */
  invitationExpired: boolean;
  activatedAt: string | null;
  lastLoginAt: string | null;
  disabledAt: string | null;
  disabledReason: string | null;
  /** The patient's latest portal access consent is granted and in effect. */
  portalConsent: boolean;
}

/** `POST /patients/:id/portal-account/invitations`: the code is returned once and never stored in plain text. */
export interface PortalInvitation {
  activationCode: string;
  expiresAt: string;
}

// ---- Clinic: encounters (Phase 2) -----------------------------------------------------------------

export type EncounterStatus = "in_progress" | "completed" | "entered_in_error";

export interface Encounter {
  id: string;
  facilityId: string;
  patientId: string;
  visitId: string | null;
  appointmentId: string | null;
  practitionerId: string;
  modality: "in_person" | "telemedicine";
  status: EncounterStatus;
  chiefComplaint: string | null;
  startedAt: string;
  completedAt: string | null;
  signedByPractitionerId: string | null;
  enteredInErrorReason: string | null;
  updatedAt: string;
  version: number;
}

export interface NoteRevision {
  id: string;
  encounterId: string;
  revisionNumber: number;
  kind: "draft" | "signed" | "amendment";
  templateKey: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  sections: Record<string, unknown>;
  amendmentReason: string | null;
  authoredBy: string;
  authoredAt: string;
}

export interface DiagnosisView {
  id: string;
  encounterId: string;
  codeSystemKey: string | null;
  codeSystemVersion: string | null;
  code: string | null;
  display: string;
  rank: "primary" | "secondary";
  certainty: "provisional" | "confirmed" | "refuted";
  isChronic: boolean;
  notes: string | null;
  status: "active" | "resolved" | "entered_in_error";
  statusReason: string | null;
  recordedAt: string;
}

export interface TriageView {
  id: string;
  chiefComplaint: string;
  painScore: number | null;
  priority: VisitPriority;
  riskFlags: string[];
  notes: string | null;
  assessedAt: string;
}

/** GET /encounters/:id */
export interface EncounterDetail extends Encounter {
  note: NoteRevision | null;
  revisionCount: number;
  diagnoses: DiagnosisView[];
  vitals: Array<VitalsRecord & { bmi: number | null }>;
  triage: TriageView[];
}

export interface CodingSystem {
  id: string;
  key: string;
  name: string;
  version: string | null;
  status: "active" | "inactive";
}

// ---- Prescriptions (Phase 2) ------------------------------------------------------------------------

export type PrescriptionRoute =
  | "oral"
  | "sublingual"
  | "buccal"
  | "topical"
  | "transdermal"
  | "inhalation"
  | "nasal"
  | "ophthalmic"
  | "otic"
  | "rectal"
  | "vaginal"
  | "subcutaneous"
  | "intramuscular"
  | "intravenous"
  | "other";

export type PrescriptionFrequency =
  | "once"
  | "once_daily"
  | "twice_daily"
  | "three_times_daily"
  | "four_times_daily"
  | "every_4_hours"
  | "every_6_hours"
  | "every_8_hours"
  | "every_12_hours"
  | "at_bedtime"
  | "weekly"
  | "as_needed"
  | "custom";

export interface PrescriptionLine {
  id: string;
  lineNumber: number;
  genericName: string;
  brandName: string | null;
  strength: string | null;
  dosageForm: string | null;
  doseAmount: number | null;
  doseUnit: string | null;
  route: PrescriptionRoute;
  frequency: PrescriptionFrequency;
  frequencyText: string | null;
  asNeededReason: string | null;
  durationValue: number | null;
  durationUnit: "days" | "weeks" | "months" | null;
  quantity: number;
  quantityUnit: string;
  refills: number;
  instructions: string;
}

/** Drug–allergy decision support finding (a name match only; no drug-class knowledge). */
export interface AllergyWarning {
  allergyId: string;
  substance: string;
  medication: string;
  criticality: string;
  reaction: string | null;
  basis: "name_match";
}

/** GET /prescriptions, POST /prescriptions */
export interface Prescription {
  id: string;
  facilityId: string;
  patientId: string;
  encounterId: string;
  prescriberPractitionerId: string;
  prescriptionNumber: string;
  status: "active" | "cancelled" | "superseded";
  issuedAt: string;
  issuedBy: string;
  notes: string | null;
  replacesPrescriptionId: string | null;
  allergyOverrideReason: string | null;
  allergyWarnings: AllergyWarning[];
  cancelledAt: string | null;
  cancellationReason: string | null;
  items: PrescriptionLine[];
}

// ---- Care plans (Phase 2) ---------------------------------------------------------------------------

export type CarePlanCategory = "chronic_disease" | "preventive" | "post_procedure" | "maternal" | "other";
export type CarePlanStatus = "draft" | "active" | "on_hold" | "completed" | "cancelled";
export type CareActivityKind =
  "follow_up_appointment" | "laboratory_monitoring" | "medication" | "lifestyle" | "education" | "referral" | "patient_task" | "provider_task";
export type CareActivityStatus = "planned" | "scheduled" | "in_progress" | "completed" | "cancelled";
export type CareGoalStatus = "proposed" | "active" | "achieved" | "not_achieved" | "cancelled";

/** GET /care-plans?patientId row. */
export interface CarePlan {
  id: string;
  patientId: string;
  title: string;
  category: CarePlanCategory;
  description: string | null;
  status: CarePlanStatus;
  startDate: string;
  endDate: string | null;
  authorPractitionerId: string | null;
  sourceEncounterId: string | null;
  statusReason: string | null;
  updatedAt: string;
  version: number;
}

export interface CareGoal {
  id: string;
  description: string;
  targetMeasure: string | null;
  targetValue: string | null;
  targetDate: string | null;
  status: CareGoalStatus;
}

export interface CareActivity {
  id: string;
  carePlanId: string;
  goalId: string | null;
  kind: CareActivityKind;
  description: string;
  assignee: "patient" | "care_team";
  assigneePractitionerId: string | null;
  dueDate: string | null;
  recurrenceIntervalDays: number | null;
  status: CareActivityStatus;
  linkedAppointmentId: string | null;
  completedAt: string | null;
  statusReason: string | null;
}

/** GET /care-plans/:id */
export interface CarePlanDetail extends CarePlan {
  problems: Array<{ id: string; diagnosisId: string | null; description: string }>;
  goals: CareGoal[];
  activities: CareActivity[];
  progressNotes: Array<{ id: string; note: string; recordedBy: string; recordedAt: string }>;
}

// ---- Clinic dashboard (Phase 2) ---------------------------------------------------------------------

/** GET /clinic/dashboard — one facility, one day. */
export interface ClinicDashboard {
  facilityId: string;
  date: string;
  appointments: { byStatus: Record<string, number>; total: number; noShowRate: number };
  queue: {
    byStatus: Record<string, number>;
    waiting: number;
    inConsultation: number;
    walkedOut: number;
    averageWaitMinutes: number | null;
    longestCurrentWaitMinutes: number | null;
  };
  /** inProgress counts every unsigned encounter at the facility, not only today's. */
  encounters: { inProgress: number; completedToday: number };
  providerWorkload: Array<{ practitionerId: string; displayName: string; booked: number; seen: number; waiting: number }>;
}

/** GET /care-plans/activities/due row (recall list). */
export interface DueCareActivity {
  id: string;
  carePlanId: string;
  patientId: string;
  kind: CareActivityKind;
  description: string;
  dueDate: string | null;
  status: CareActivityStatus;
  assignee: "patient" | "care_team";
  recurrenceIntervalDays: number | null;
  planTitle: string;
  planCategory: CarePlanCategory;
  overdue: boolean;
  /** When the patient was last sent a recall reminder for this activity (SMS / MyHealth), if ever. */
  lastReminderAt?: string | null;
  /** Minimal identification (number, name, sex, age). */
  patient: PatientBrief | null;
}

// ---- Laboratory (Phase 3) ---------------------------------------------------------------------------

export type LabResultType = "numeric" | "text" | "coded";
export type LabOrderSource = "clinic" | "telemedicine" | "dental" | "external" | "patient_request";
export type LabPriority = "routine" | "stat" | "scheduled";
export type LabOrderStatus = "active" | "completed" | "cancelled";
export type LabItemStatus = "pending_collection" | "collected" | "received" | "resulted" | "released" | "cancelled";
export type LabSpecimenStatus = "collected" | "received" | "rejected" | "stored" | "disposed";
export type LabResultStatus = "entered" | "verified" | "approved" | "released" | "superseded" | "cancelled";
export type LabResultFlag = "normal" | "low" | "high" | "critical_low" | "critical_high" | "abnormal";
export type LabWorklistStage = "collect" | "receive" | "enter" | "verify" | "approve" | "release";

export interface LabCatalogEntry {
  id: string;
  code: string;
  name: string;
  status: "active" | "inactive";
  version: number;
}

export interface LabSpecimenType extends LabCatalogEntry {
  container: string | null;
  collectionInstructions: string | null;
}

export interface LabReferenceRange {
  id: string;
  testId: string;
  sex: "male" | "female" | null;
  ageMinDays: number;
  ageMaxDays: number | null;
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  textRange: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** GET /laboratory/tests row (current ranges) or /laboratory/tests/:id (full range history). */
export interface LabTest extends LabCatalogEntry {
  departmentId: string;
  specimenTypeId: string;
  loincCode: string | null;
  resultType: LabResultType;
  unit: string | null;
  decimalPlaces: number | null;
  codedValues: string[];
  abnormalCodedValues: string[];
  turnaroundMinutes: number | null;
  requiresFasting: boolean;
  patientReleasable: boolean;
  collectionInstructions: string | null;
  referenceRanges: LabReferenceRange[];
}

export interface LabPanel extends LabCatalogEntry {
  testIds: string[];
}

export interface LabPolicy {
  facilityId: string;
  allowSelfVerification: boolean;
  allowSelfApproval: boolean;
  releaseOnApproval: boolean;
  version: number;
}

export interface LabResult {
  id: string;
  facilityId: string;
  patientId: string;
  orderId: string;
  orderItemId: string;
  testId: string;
  versionNumber: number;
  supersedesResultId: string | null;
  correctionReason: string | null;
  status: LabResultStatus;
  resultType: LabResultType;
  valueNumeric: number | null;
  valueText: string | null;
  valueCoded: string | null;
  unit: string | null;
  flag: LabResultFlag | null;
  critical: boolean;
  refLow: number | null;
  refHigh: number | null;
  refCriticalLow: number | null;
  refCriticalHigh: number | null;
  refText: string | null;
  comment: string | null;
  method: string | null;
  instrument: string | null;
  patientReleasable: boolean;
  enteredAt: string;
  enteredBy: string;
  enteredByName: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  selfVerified: boolean;
  approvedAt: string | null;
  approvedByName: string | null;
  selfApproved: boolean;
  releasedAt: string | null;
  releasedByName: string | null;
  cancellationReason: string | null;
}

export interface LabSpecimen {
  id: string;
  facilityId: string;
  patientId: string;
  orderId: string;
  specimenTypeId: string;
  accessionNumber: string;
  status: LabSpecimenStatus;
  collectedAt: string;
  collectedByName: string | null;
  receivedAt: string | null;
  receivedByName: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  version: number;
}

export interface LabOrderItem {
  id: string;
  orderId: string;
  testId: string;
  testCode: string;
  testName: string;
  panelCode: string | null;
  specimenId: string | null;
  status: LabItemStatus;
  cancellationReason: string | null;
  departmentId: string;
  specimenTypeId: string;
  resultType: LabResultType;
  unit: string | null;
  codedValues: string[];
  turnaroundMinutes: number | null;
  /** Current result; before release only laboratory staff receive it. */
  result: LabResult | null;
}

/** GET /laboratory/orders/:id */
export interface LabOrder {
  id: string;
  facilityId: string;
  patientId: string;
  encounterId: string | null;
  orderNumber: string;
  source: LabOrderSource;
  priority: LabPriority;
  scheduledFor: string | null;
  clinicalIndication: string | null;
  notes: string | null;
  fastingRequired: boolean;
  status: LabOrderStatus;
  orderedAt: string;
  orderingPractitionerName: string | null;
  externalOrderer: string | null;
  orderedByName: string | null;
  cancellationReason: string | null;
  version: number;
  patient: PatientBrief | null;
  items: LabOrderItem[];
  specimens: LabSpecimen[];
}

/** GET /laboratory/worklist row: one specimen (or, to collect, one order) and the tests waiting at that stage. */
export interface LabWorklistRow {
  key: string;
  order: Omit<LabOrder, "items" | "specimens" | "patient">;
  patient: PatientBrief | null;
  specimen: LabSpecimen | null;
  items: LabOrderItem[];
}

/** GET /laboratory/dashboard */
export interface LabDashboard {
  facilityId: string;
  date: string;
  pendingCollection: number;
  awaitingReceipt: number;
  awaitingEntry: number;
  awaitingVerification: number;
  awaitingApproval: number;
  awaitingRelease: number;
  statOpen: number;
  overdue: number;
  releasedToday: number;
  averageTurnaroundMinutes: number | null;
  rejectedToday: number;
  criticalUnacknowledged: number;
}

/** GET /laboratory/critical-results row */
export interface LabCriticalAlert {
  id: string;
  resultId: string;
  status: "open" | "communicated" | "acknowledged";
  raisedAt: string;
  communicatedAt: string | null;
  communicatedTo: string | null;
  communicationMethod: "phone" | "in_person" | "secure_message" | "other" | null;
  readBackConfirmed: boolean | null;
  communicationNote: string | null;
  communicatedByName: string | null;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  orderId: string;
  orderNumber: string;
  testName: string;
  patient: PatientBrief | null;
  orderingPractitionerName: string | null;
  result: LabResult;
}

/** GET /laboratory/patients/:id/results row: a released result with its test. */
export interface PatientLabResult extends LabResult {
  testCode: string;
  testName: string;
  orderNumber: string;
  collectedAt: string | null;
}

/** GET /laboratory/patients/:id/trends */
export interface LabTrend {
  analyte: string;
  testName: string;
  unit: string | null;
  points: Array<{
    resultId: string;
    collectedAt: string | null;
    releasedAt: string | null;
    testCode: string;
    valueNumeric: number | null;
    valueText: string | null;
    valueCoded: string | null;
    unit: string | null;
    flag: LabResultFlag | null;
    critical: boolean;
    refLow: number | null;
    refHigh: number | null;
    refText: string | null;
    corrected: boolean;
  }>;
}

// ---- Telemedicine (Phase 5) -------------------------------------------------------------------------

export type TelemedicineStatus = "scheduled" | "waiting" | "in_consultation" | "ended" | "escalated";

export interface TelemedicineSessionSummary {
  status: TelemedicineStatus;
  questionnaireSubmittedAt: string | null;
  redFlags: string[];
  consentAcknowledgedAt: string | null;
  patientJoinedAt: string | null;
  clinicianJoinedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  encounterId: string | null;
  patientInstructions: string | null;
}

export interface TelemedicineAppointment {
  id: string;
  patientId: string;
  practitionerId: string;
  practitionerName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  reason: string | null;
  visitType: string;
}

/** `GET /telemedicine/consultations` */
export interface TelemedicineDay {
  date: string;
  timeZone: string;
  videoConfigured: boolean;
  consultations: Array<{
    appointment: TelemedicineAppointment;
    patient: PatientBrief | null;
    visitStatus: string | null;
    encounterId: string | null;
    session: TelemedicineSessionSummary;
  }>;
}

export interface TelemedicineQuestionnaire {
  reasonForVisit: string;
  symptoms?: string;
  symptomDurationDays?: number;
  currentMedications?: string;
  newAllergies?: string;
  redFlags: string[];
  locationCity: string;
  callbackNumber: string;
}

/** `GET /telemedicine/consultations/:appointmentId` and the actions' responses. */
export interface TelemedicineConsultation {
  appointment: TelemedicineAppointment;
  session: TelemedicineSessionSummary & {
    questionnaire: TelemedicineQuestionnaire | null;
    redFlagLabels: string[];
    escalationReason: string | null;
  };
  videoConfigured: boolean;
  video?: VideoJoin | null;
}

export interface VideoJoin {
  url: string;
  token: string;
  room: string;
  expiresInSeconds: number;
}

// ---- Billing (Phase 7) ------------------------------------------------------------------------------
// Money is integer centavos (PHP) in the API: 50000 = ₱500.00.

export type BillingCategory = "consultation" | "procedure" | "laboratory" | "dental" | "telemedicine" | "supply" | "other";
export type PaymentMethod = "cash" | "card" | "e_wallet" | "bank_transfer" | "check" | "other";

export interface BillingServicePrice {
  id: string;
  serviceId: string;
  unitPrice: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

export interface BillingService {
  id: string;
  code: string;
  name: string;
  category: BillingCategory;
  sourceKind: "visit_type" | "lab_test" | "dental_procedure" | null;
  sourceCode: string | null;
  status: "active" | "inactive";
  version: number;
  currentPrice: number | null;
  prices: BillingServicePrice[];
}

export interface BillingPayer {
  id: string;
  code: string;
  name: string;
  payerType: "hmo" | "philhealth" | "insurance" | "company" | "other";
  status: "active" | "inactive";
}

export interface DiscountRule {
  id: string;
  code: string;
  name: string;
  kind: "senior_citizen" | "pwd" | "employee" | "promotional" | "other";
  statutory: boolean;
  rateBp: number;
  categories: BillingCategory[];
  requiresEvidence: boolean;
  stackable: boolean;
  effectiveFrom: string;
  effectiveUntil: string | null;
  status: "active" | "inactive";
}

export interface BillingCharge {
  id: string;
  patientId: string;
  serviceId: string;
  serviceCode: string;
  category: BillingCategory;
  sourceType: "encounter" | "lab_order_item" | "manual";
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  serviceDate: string;
  status: "pending" | "invoiced" | "cancelled";
  invoiceId: string | null;
  cancelReason: string | null;
  capturedAt: string;
  version: number;
  patient: PatientBrief | null;
}

export interface BillingWorklistRow {
  patientId: string;
  count: number;
  amount: number;
  oldest: string;
  patient: PatientBrief | null;
}

export type InvoiceStatus = "draft" | "issued" | "void";

export interface InvoiceSummary {
  id: string;
  patientId: string;
  invoiceNumber: string | null;
  status: InvoiceStatus;
  grossTotal: number;
  discountTotal: number;
  netTotal: number;
  payerTotal: number;
  patientTotal: number;
  paidTotal: number;
  balance: number;
  createdAt: string;
  issuedAt: string | null;
  voidedAt: string | null;
  version: number;
  patient: PatientBrief | null;
}

export interface InvoiceLine {
  id: string;
  chargeId: string;
  category: BillingCategory;
  description: string;
  serviceDate: string;
  quantity: number;
  unitPrice: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
}

export interface InvoiceDiscount {
  id: string;
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  rateBp: number;
  amount: number;
  evidenceIdMasked: string | null;
  evidenceNote: string | null;
}

export interface InvoiceCoverage {
  id: string;
  payerId: string;
  payerName: string;
  payerType: BillingPayer["payerType"];
  amount: number;
  reference: string | null;
  status: "pending" | "submitted" | "settled" | "denied";
  settledAmount: number | null;
  statusNote: string | null;
}

export interface LedgerEntry {
  id: string;
  kind: "payment" | "refund";
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  receiptNumber: string | null;
  refundOfId: string | null;
  reason: string | null;
  recordedAt: string;
}

export interface InvoiceDetail extends Omit<InvoiceSummary, "patient"> {
  facilityId: string;
  notes: string | null;
  voidReason: string | null;
  replacedById: string | null;
  items: InvoiceLine[];
  discounts: InvoiceDiscount[];
  payers: InvoiceCoverage[];
  payments: LedgerEntry[];
  patient: PatientBrief | null;
}

export interface DailyBillingReport {
  date: string;
  invoices: { issued: number; voided: number; grossTotal: number; discountTotal: number; netTotal: number; payerTotal: number; patientTotal: number };
  discounts: Array<{ code: string; name: string; count: number; amount: number }>;
  collections: Array<{ method: PaymentMethod; count: number; amount: number }>;
  collectedTotal: number;
  refunds: Array<{ method: PaymentMethod; count: number; amount: number }>;
  refundedTotal: number;
  receivables: { patientBalance: number; invoices: number; payerPending: number };
}

// ---- PhilHealth claims (libs/interoperability/src/lib/philhealth) ----------------------------------

export interface IntegrationSpecification {
  system: string;
  name: string;
  /** "dependency": no official specification yet — nothing can be transmitted. */
  status: "dependency" | "stubbed" | "implemented" | "certified";
  specificationVersion: string | null;
  note: string;
}

export interface ClaimReadinessCheck {
  code: string;
  ok: boolean;
  message: string;
}

export interface ClaimExchange {
  id: string;
  status: "queued" | "accepted" | "rejected" | "failed" | "not_configured";
  attempts: number;
  externalReference: string | null;
  outcomeDetail: { reasons?: Array<{ code: string; message: string }> };
  lastError: string | null;
  requestedAt: string;
  completedAt: string | null;
}

export interface PhilHealthClaimPreview {
  integration: IntegrationSpecification;
  invoiceId: string;
  ready: boolean;
  checks: ClaimReadinessCheck[];
  claim: {
    facility: { accreditationNumber: string | null };
    patient: { patientNumber: string; familyName: string; givenName: string; philhealthPin: string | null };
    coverage: { amountClaimed: number };
    servicePeriod: { from: string; to: string };
    diagnoses: Array<{ codeSystem: string; code: string; display: string; primary: boolean }>;
  } | null;
  submissions: ClaimExchange[];
  /** Informational: the latest answered eligibility check for the dates of service. */
  eligibility: EligibilityCheck | null;
}

export interface PhilHealthAccreditation {
  facilityId: string;
  accreditationNumber: string;
  validFrom: string | null;
  validUntil: string | null;
  version: number;
}

// ---- DOH case reporting (libs/interoperability/src/lib/doh) ----------------------------------------

export type CaseReportStatus = "pending_review" | "queued" | "reported" | "rejected" | "failed" | "dismissed";

export interface CaseReportSummary {
  id: string;
  facilityId: string;
  patientId: string;
  encounterId: string;
  diagnosisId: string;
  category: string;
  diagnosisCode: string;
  diagnosisDisplay: string;
  status: CaseReportStatus;
  reportedVia: "external_channel" | "adapter" | null;
  externalReference: string | null;
  statusReason: string | null;
  detectedAt: string;
  reviewedAt: string | null;
  version: number;
  /** Set when a check of earlier diagnoses opened it (rather than detection as the diagnosis was recorded). */
  rescanId: string | null;
  patient: { patientNumber: string; displayName: string } | null;
}

export interface CaseReportDetail extends Omit<CaseReportSummary, "patient"> {
  integration: IntegrationSpecification;
  ready: boolean;
  checks: ClaimReadinessCheck[];
  report: {
    category: string;
    facility: { name: string; facilityCode: string | null };
    patient: {
      patientNumber: string;
      familyName: string;
      givenName: string;
      middleName: string | null;
      sex: string;
      birthDate: string;
      address: { line1: string | null; barangay: string | null; cityMunicipality: string; province: string | null; region: string | null } | null;
      contactNumber: string | null;
    };
    diagnosis: { code: string; display: string; certainty: string; recordedAt: string };
    consultation: { date: string; modality: string; clinician: string | null };
  };
  submissions: ClaimExchange[];
}

export interface ReportableRule {
  id: string;
  codeSystemKey: "icd-10";
  codePrefix: string;
  category: string;
  sourceNote: string | null;
  status: "active" | "inactive";
  createdAt: string;
}

export interface DohFacilityCode {
  facilityId: string;
  facilityCode: string;
  version: number;
}

export interface EligibilityCheck {
  id: string;
  facilityId: string;
  patientId: string;
  serviceDate: string;
  status: "queued" | "eligible" | "not_eligible" | "undetermined" | "failed";
  source: "external_channel" | "adapter";
  externalReference: string | null;
  note: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface EligibilityOverview {
  integration: IntegrationSpecification;
  checks: EligibilityCheck[];
  readiness: ClaimReadinessCheck[] | null;
}

// ---- Integration exchange review (libs/interoperability/src/lib/exchange) ---------------------------

export interface ExchangeReviewItem {
  id: string;
  system: string;
  operation: string;
  status: "queued" | "accepted" | "rejected" | "failed" | "not_configured";
  resourceType: string;
  resourceId: string;
  patientId: string | null;
  patient: { patientNumber: string; displayName: string } | null;
  attempts: number;
  externalReference: string | null;
  outcomeDetail: { reasons?: Array<{ code: string; message: string }>; detail?: Record<string, string> };
  lastError: string | null;
  payloadDigest: string;
  payloadSealed: boolean;
  stalled: boolean;
  requestedAt: string;
  lastAttemptAt: string | null;
  completedAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface ExchangeReviewList {
  summary: { needsReview: number; stalled: number; queued: number };
  exchanges: ExchangeReviewItem[];
}

/** An archived copy of a released laboratory report (GET /laboratory/patients/:id/report-archive). */
export interface LabReportArchiveEntry {
  id: string;
  orderId: string;
  orderNumber: string;
  /** 1, 2, … per order: each release (or correction) of the order's results is a new version. */
  archiveVersion: number;
  resultCount: number;
  corrected: boolean;
  status: "pending" | "stored" | "failed";
  createdAt: string;
  storedAt: string | null;
}

// ---- Billing: patient deposits and credit notes (migration 0035) -----------------------------------

/** deposit (+), credit from a credit note (+), application to an invoice (−), release by a void (+), refund (−). */
export type AccountEntryKind = "deposit" | "credit" | "application" | "release" | "refund";

export interface AccountEntry {
  id: string;
  facilityId: string;
  patientId: string;
  kind: AccountEntryKind;
  amount: number;
  method: PaymentMethod | null;
  reference: string | null;
  receiptNumber: string | null;
  invoiceId: string | null;
  creditNoteId: string | null;
  applicationId: string | null;
  reason: string | null;
  recordedAt: string;
  /** On the account ledger (not on an invoice's entries). */
  invoiceNumber?: string | null;
  creditNoteNumber?: string | null;
}

/** The patient's deposit and credit balance at the selected facility. */
export interface PatientAccount {
  patientId: string;
  facilityId: string;
  balance: number;
  entries: AccountEntry[];
}

export interface CreditNoteLine {
  id: string;
  creditNoteId: string;
  invoiceItemId: string;
  description: string;
  amount: number;
}

export interface CreditNote {
  id: string;
  facilityId: string;
  patientId: string;
  invoiceId: string;
  creditNoteNumber: string;
  reason: string;
  amount: number;
  /** The part that reduced what the patient owed on the invoice. */
  appliedAmount: number;
  /** The part already paid, credited to the patient's account. */
  accountCredit: number;
  issuedBy: string;
  issuedAt: string;
  lines: CreditNoteLine[];
  invoiceNumber?: string | null;
}

/** What `GET /billing/invoices/:id` adds for deposits and credit notes. */
export interface InvoiceSettlement {
  depositAppliedTotal: number;
  creditedTotal: number;
  creditNoteTotal: number;
  accountEntries: AccountEntry[];
  creditNotes: CreditNote[];
}

export type InvoiceWithSettlement = InvoiceDetail & InvoiceSettlement;

export interface DailyAccountFigures {
  deposits: {
    received: Array<{ method: PaymentMethod; count: number; amount: number }>;
    receivedTotal: number;
    appliedTotal: number;
    refunds: Array<{ method: PaymentMethod; count: number; amount: number }>;
    refundedTotal: number;
    held: number;
  };
  creditNotes: { count: number; amount: number; appliedAmount: number; accountCredit: number };
}

export interface BillingPrefixes {
  invoicePrefix: string;
  receiptPrefix: string;
  creditNotePrefix: string;
}

// ---- DOH: checks of earlier diagnoses against the rules (libs/interoperability/src/lib/doh/doh-rescans.service.ts) ----

/** GET /doh/rescans: recent checks, with the organization's time zone and today's date there. */
export interface DohRescanOverview {
  timeZone: string;
  today: string;
  rescans: DohRescan[];
}

export type DohRescanStatus = "queued" | "running" | "completed" | "failed";

export interface DohRescan {
  id: string;
  fromDate: string;
  toDate: string;
  timeZone: string;
  status: DohRescanStatus;
  /** Coded diagnoses checked, those matching an active rule, and case reports this check opened. */
  scanned: number;
  matched: number;
  opened: number;
  lastError: string | null;
  requestedBy: string;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

// ---- Inventory (libs/inventory) ---------------------------------------------------------------------

export type InventoryCategory = "medicine" | "medical_supply" | "reagent" | "laboratory_consumable" | "dental_supply" | "ppe" | "other";

export interface InventoryItem {
  id: string;
  code: string;
  name: string;
  category: InventoryCategory;
  stockUnit: string;
  tracksLots: boolean;
  controlled: boolean;
  status: "active" | "inactive";
  version: number;
}

export interface InventorySupplier {
  id: string;
  code: string;
  name: string;
  contact: string | null;
  status: "active" | "inactive";
}

export interface InventoryLocation {
  id: string;
  facilityId: string;
  code: string;
  name: string;
  status: "active" | "inactive";
}

export interface StockRow {
  location: { id: string; name: string };
  item: { id: string; code: string; name: string; category: InventoryCategory; stockUnit: string; controlled: boolean };
  onHand: number;
  usable: number;
  reorderLevel: number | null;
  status: "out" | "low" | "ok";
  lots: Array<{ lotId: string; lotNumber: string | null; expiryDate: string | null; quantity: number; expiry: "expired" | "expiring" | "ok" | "no_expiry" }>;
}

export interface InventoryMovement {
  id: string;
  movementGroupId: string;
  kind: "receipt" | "issue" | "transfer_out" | "transfer_in" | "adjustment" | "write_off";
  locationId: string;
  itemId: string;
  lotId: string;
  quantity: number;
  balanceAfter: number;
  supplierId: string | null;
  unitCost: number | null;
  reference: string | null;
  issuedTo: string | null;
  reason: string | null;
  recordedBy: string;
  recordedAt: string;
  itemName: string;
  stockUnit: string;
  locationName: string;
  lotNumber: string | null;
  expiryDate: string | null;
}

// ---- Dental (libs/dental) ------------------------------------------------------------------------

export type DentalProcedureSite = "mouth" | "tooth" | "surface";
export type DentalChartEffect = "restoration" | "sealant" | "crown" | "root_canal" | "missing" | "implant" | "pontic";

export interface DentalProcedureType {
  id: string;
  code: string;
  name: string;
  site: DentalProcedureSite;
  chartEffect: DentalChartEffect | null;
  status: "active" | "inactive";
  version: number;
}

export interface DentalSettings {
  notation: ToothNotation;
  procedureTypes: DentalProcedureType[];
}

export interface DentalChartTooth {
  tooth: string;
  findings: ToothFinding[];
  note: string | null;
  source: { type: "examination" | "procedure"; id: string };
  recordedAt: string;
  recordedBy: string;
  recordedByName: string | null;
}

export interface DentalToothHistoryEntry {
  tooth: string;
  findings: ToothFinding[];
  note: string | null;
  source: { type: "examination" | "procedure"; id: string; status: DentalRecordStatus };
  recordedAt: string;
  recordedByName: string | null;
}

export type DentalRecordStatus = "recorded" | "entered_in_error";

export interface DentalExamination {
  id: string;
  facilityId: string;
  patientId: string;
  encounterId: string;
  practitionerId: string;
  practitionerName: string | null;
  oralHygiene: "good" | "fair" | "poor" | null;
  notes: string | null;
  status: DentalRecordStatus;
  enteredInErrorReason: string | null;
  recordedAt: string;
  teeth: Array<{ tooth: string; findings: ToothFinding[]; note: string | null }>;
}

export type DentalPlanStatus = "proposed" | "accepted" | "in_progress" | "completed" | "declined" | "discontinued";
export type DentalPlanItemStatus = "proposed" | "accepted" | "declined" | "completed" | "cancelled";

export interface DentalPlanItem {
  id: string;
  planId: string;
  phase: number;
  procedureTypeId: string;
  procedure: { code: string; name: string; site: DentalProcedureSite } | null;
  tooth: string | null;
  surfaces: ToothSurface[];
  note: string | null;
  status: DentalPlanItemStatus;
  procedureId: string | null;
  version: number;
}

export interface DentalTreatmentPlan {
  id: string;
  facilityId: string;
  patientId: string;
  practitionerId: string;
  practitionerName?: string | null;
  title: string;
  notes: string | null;
  status: DentalPlanStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  discontinuedReason: string | null;
  createdAt: string;
  version: number;
  items: DentalPlanItem[];
}

export interface DentalProcedure {
  id: string;
  facilityId: string;
  patientId: string;
  encounterId: string;
  practitionerId: string;
  practitionerName: string | null;
  procedureTypeId: string;
  procedure: { code: string; name: string };
  label: string;
  tooth: string | null;
  surfaces: ToothSurface[];
  notes: string | null;
  planItemId: string | null;
  status: DentalRecordStatus;
  enteredInErrorReason: string | null;
  performedAt: string;
}

export type DentalImageKind = "periapical" | "bitewing" | "panoramic" | "cephalometric" | "occlusal" | "cbct" | "intraoral_photo" | "extraoral_photo" | "other";

export interface DentalImage {
  id: string;
  patientId: string;
  documentId: string;
  encounterId: string | null;
  kind: DentalImageKind;
  teeth: string[];
  takenOn: string;
  notes: string | null;
  status: DentalRecordStatus;
  enteredInErrorReason: string | null;
  recordedAt: string;
  recordedByName: string | null;
}

export interface DentalRecord {
  patient: PatientBrief & { id: string };
  notation: ToothNotation;
  chart: DentalChartTooth[];
  examinations: DentalExamination[];
  plans: DentalTreatmentPlan[];
  procedures: DentalProcedure[];
  images: DentalImage[];
}

export interface DentalVisit {
  encounterId: string;
  patientId: string;
  practitionerId: string;
  practitionerName: string;
  status: "in_progress" | "completed" | "entered_in_error";
  startedAt: string;
  chiefComplaint: string | null;
  patient: PatientBrief | null;
  examinations: number;
  procedures: number;
}

export interface DentalVisits {
  date: string;
  visits: DentalVisit[];
}

// ---- PhilHealth YAKAP (libs/philhealth/src/lib/yakap*.ts) --------------------------------------------

/** PhilHealth's answer about a patient's YAKAP registration, in the platform's own neutral vocabulary (recorded, never decided). */
export type YakapRegistrationStatus = "registered" | "not_registered" | "pending" | "unknown";

export interface YakapParticipation {
  id: string;
  facilityId: string;
  participationReference: string;
  validFrom: string | null;
  validUntil: string | null;
  updatedBy: string;
  updatedAt: string;
  version: number;
}

export interface YakapRegistration {
  id: string;
  facilityId: string;
  patientId: string;
  status: YakapRegistrationStatus;
  effectiveDate: string | null;
  externalReference: string | null;
  note: string | null;
  recordedBy: string;
  recordedAt: string;
}

export interface YakapRegistrationOverview {
  integration: IntegrationSpecification;
  /** The selected facility's participation reference (null when none is recorded or no facility is selected). */
  participation: YakapParticipation | null;
  registrations: YakapRegistration[];
}

export interface YakapConsultation {
  encounterId: string;
  facilityId: string;
  facilityName: string;
  date: string;
  modality: string;
  status: "in_progress" | "completed" | "entered_in_error";
  visitTypeName: string | null;
  clinicianName: string | null;
  latestSubmission: ClaimExchange | null;
}

export interface YakapConsultationList {
  integration: IntegrationSpecification;
  consultations: YakapConsultation[];
}

/** The platform's format-neutral package of one consultation (not PhilHealth's format). */
export interface YakapEncounterPackage {
  model: "platform-yakap-1";
  facility: { id: string; name: string; participationReference: string | null };
  patient: {
    patientNumber: string;
    familyName: string;
    givenName: string;
    middleName: string | null;
    sex: string;
    birthDate: string;
    philhealthPin: string | null;
  };
  registration: { status: YakapRegistrationStatus; effectiveDate: string | null; reference: string | null; recordedAt: string } | null;
  encounter: {
    id: string;
    date: string;
    startedAt: string;
    completedAt: string | null;
    modality: string;
    visitType: string | null;
    clinician: { name: string; profession: string; licenseNumber: string | null } | null;
  };
  diagnoses: Array<{ codeSystem: "icd-10"; code: string; display: string; primary: boolean; certainty: string }>;
  prescriptions: Array<{
    prescriptionNumber: string;
    issuedAt: string;
    items: Array<{ genericName: string; brandName: string | null; strength: string | null; dosageForm: string | null; quantity: number; quantityUnit: string }>;
  }>;
  labOrders: Array<{ orderNumber: string; orderedAt: string; tests: Array<{ code: string; name: string; loincCode: string | null }> }>;
}

export interface YakapPackagePreview {
  integration: IntegrationSpecification;
  encounterId: string;
  patientId: string;
  consultation: {
    date: string;
    modality: string;
    status: "in_progress" | "completed" | "entered_in_error";
    facilityId: string;
    facilityName: string;
    visitTypeName: string | null;
    clinicianName: string | null;
  };
  registration: { status: YakapRegistrationStatus; effectiveDate: string | null; externalReference: string | null; recordedAt: string } | null;
  ready: boolean;
  checks: ClaimReadinessCheck[];
  /** PIN masked. Null until the readiness checks pass. */
  package: YakapEncounterPackage | null;
  submissions: ClaimExchange[];
}
// ---- Laboratory send-outs to reference laboratories (Phase 8) -----------------------------------------
// The declarations below extend LabResult, LabOrderItem and LabDashboard (interface merging).

export type LabSendOutStatus = "prepared" | "dispatched" | "results_received" | "rejected" | "cancelled";

export interface LabResult {
  /** Performed by a reference laboratory (null: the facility's own laboratory); the name is a snapshot. */
  sendOutId: string | null;
  referenceLaboratoryId: string | null;
  performingLaboratory: string | null;
}

/** The latest send-out of a test on its current specimen. */
export interface LabItemSendOut {
  id: string;
  status: LabSendOutStatus;
  referenceLaboratoryId: string;
  referenceLaboratoryName: string;
  dispatchedAt: string | null;
  referenceAccession: string | null;
  resultsReceivedAt: string | null;
  rejectionReason: string | null;
}

export interface LabOrderItem {
  sendOut: LabItemSendOut | null;
}

export interface LabDashboard {
  sendOutsToDispatch: number;
  sendOutsAwaitingResults: number;
  sendOutsOverdue: number;
}

/** GET /laboratory/reference-labs */
export interface ReferenceLaboratory {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  /** As recorded by staff; not verified. */
  accreditationReference: string | null;
  notes: string | null;
  status: "active" | "inactive";
  version: number;
}

/** GET /laboratory/referrals (selected facility) */
export interface LabTestReferral {
  facilityId: string;
  testId: string;
  testCode: string;
  testName: string;
  testTurnaroundMinutes: number | null;
  referenceLaboratoryId: string;
  referenceLaboratoryName: string;
  referenceLaboratoryStatus: "active" | "inactive";
  turnaroundMinutes: number | null;
  updatedAt: string;
  version: number;
}

/** GET /laboratory/send-outs row */
export interface LabSendOut {
  id: string;
  status: LabSendOutStatus;
  facilityId: string;
  patientId: string;
  orderId: string;
  orderItemId: string;
  specimenId: string;
  referenceLaboratoryId: string;
  referenceLaboratoryName: string;
  turnaroundMinutes: number | null;
  preparedAt: string;
  preparedByName: string | null;
  dispatchId: string | null;
  manifestNumber: string | null;
  dispatchedAt: string | null;
  referenceAccession: string | null;
  resultsReceivedAt: string | null;
  resultsReceivedByName: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  /** Turnaround counted from dispatch. */
  dueAt: string | null;
  minutesOut: number | null;
  overdue: boolean;
  orderNumber: string;
  priority: LabPriority;
  testCode: string;
  testName: string;
  itemStatus: LabItemStatus;
  accessionNumber: string;
  collectedAt: string;
  specimenTypeName: string;
  patient: PatientBrief | null;
  version: number;
}

/** GET /laboratory/send-out-dispatches/:id (the list rows carry a count instead of the send-outs) */
export interface LabSendOutDispatch {
  id: string;
  facilityId: string;
  referenceLaboratoryId: string;
  referenceLaboratoryName: string | null;
  manifestNumber: string;
  courier: string;
  courierReference: string | null;
  dispatchedAt: string;
  dispatchedByName: string | null;
  electronicReference: string | null;
  electronicAcknowledgedAt: string | null;
}

export interface LabSendOutDispatchSummary extends LabSendOutDispatch {
  sendOuts: number;
}

export interface LabSendOutDispatchDetail extends LabSendOutDispatch {
  sendOuts: LabSendOut[];
}

/** GET /integrations/reference-laboratories/dispatches/:id/submissions */
export interface ReferenceLabSubmissionStatus {
  integration: {
    system: string;
    name: string;
    status: "dependency" | "stubbed" | "implemented" | "certified";
    specificationVersion: string | null;
    note: string;
  };
  dispatchId: string;
  ready: boolean;
  checks: Array<{ key: string; ok: boolean; message: string }>;
  submissions: Array<{
    id: string;
    status: string;
    attempts: number;
    externalReference: string | null;
    lastError: string | null;
    requestedAt: string;
    completedAt: string | null;
  }>;
}

// ---- FHIR imports (GET/POST /fhir-imports; interop.fhir.import.review) and external history -----------

/** Where an allergy came from (declaration merged into AllergyRecord above; migration 0048). */
export interface AllergyRecord {
  source?: "staff" | "external_import";
  /** "fhir-import:<import id>#<entry index>" for an accepted import. */
  sourceReference?: string | null;
}

export type FhirImportStatus = "pending_review" | "accepted" | "partially_accepted" | "rejected";
export type FhirImportEntryOutcome = "pending" | "accepted" | "rejected" | "not_supported";
export type FhirImportKind = "patient" | "allergy" | "condition" | "observation" | "medication" | "document" | "not_supported";

export interface FhirImportSummary {
  id: string;
  status: FhirImportStatus;
  sourceKind: "bundle" | "resource";
  bundleType: "collection" | "document" | "searchset" | null;
  declaredSource: string | null;
  resourceCounts: Record<string, number>;
  entryCount: number;
  patientId: string | null;
  matchedAt: string | null;
  rejectionReason: string | null;
  receivedAt: string;
  completedAt: string | null;
  contentPurged: boolean;
  version: number;
}

export interface FhirImportListItem extends FhirImportSummary {
  pendingEntries: number;
  patient: { patientNumber: string; displayName: string } | null;
}

export interface ImportedCode {
  system: string | null;
  code: string | null;
  display: string | null;
}

interface ImportedBase {
  resourceType: string;
  acceptable: boolean;
  notes: string[];
}
export type SubjectMatch = "import_patient" | "other_patient" | "not_stated";

export interface ImportedPatient extends ImportedBase {
  kind: "patient";
  familyName: string | null;
  givenNames: string[];
  nameText: string | null;
  suffix: string | null;
  sex: "male" | "female" | "unknown" | null;
  gender: string | null;
  birthDate: string | null;
  deceased: boolean;
  identifiers: Array<{ system: string | null; value: string; type: string | null }>;
  telecom: Array<{ system: string | null; value: string; use: string | null }>;
  addresses: Array<{
    use: string | null;
    lines: string[];
    city: string | null;
    district: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
    text: string | null;
  }>;
}

export interface ImportedAllergyItem extends ImportedBase {
  kind: "allergy";
  subject: SubjectMatch;
  substance: string | null;
  codes: ImportedCode[];
  category: string;
  criticality: "low" | "high" | "unable_to_assess";
  severity: "mild" | "moderate" | "severe" | null;
  reaction: string | null;
  clinicalStatus: string | null;
  verificationStatus: string | null;
  recordedDate: string | null;
}

export interface ImportedConditionItem extends ImportedBase {
  kind: "condition";
  subject: SubjectMatch;
  display: string | null;
  codes: ImportedCode[];
  category: string | null;
  clinicalStatus: string | null;
  verificationStatus: string | null;
  onset: string | null;
  abatement: string | null;
  recordedDate: string | null;
}

export interface ImportedObservationItem extends ImportedBase {
  kind: "observation";
  subject: SubjectMatch;
  category: "laboratory" | "vital-signs" | "other";
  display: string | null;
  codes: ImportedCode[];
  value: string | null;
  interpretation: string | null;
  referenceRange: string | null;
  status: string;
  effective: string | null;
}

export interface ImportedMedicationItem extends ImportedBase {
  kind: "medication";
  subject: SubjectMatch;
  statement: "statement" | "request";
  medication: string | null;
  codes: ImportedCode[];
  dosage: string | null;
  status: string;
  date: string | null;
}

export interface ImportedDocumentItem extends ImportedBase {
  kind: "document";
  subject: SubjectMatch;
  type: string | null;
  description: string | null;
  status: string;
  date: string | null;
  attachments: Array<{ contentType: string | null; title: string | null; size: number | null; inline: boolean; url: string | null }>;
}

export type ImportedItem =
  | ImportedPatient
  | ImportedAllergyItem
  | ImportedConditionItem
  | ImportedObservationItem
  | ImportedMedicationItem
  | ImportedDocumentItem
  | (ImportedBase & { kind: "not_supported" });

export interface FhirImportEntry {
  id: string;
  index: number;
  resourceType: string;
  kind: FhirImportKind;
  /** What accepting creates. */
  becomes: "allergy" | "external_history" | "patient_match" | null;
  outcome: FhirImportEntryOutcome;
  reason: string | null;
  resultType: "allergy_intolerance" | "external_history_entry" | "patient" | null;
  resultId: string | null;
  decidedAt: string | null;
  /** Null once the received content was deleted by the retention rule. */
  item: ImportedItem | null;
}

export interface ImportPatientBrief {
  id: string;
  patientNumber: string;
  displayName: string;
  sex: PatientSex;
  birthDate: string;
  status: string;
}

export interface FhirImportDetail extends FhirImportSummary {
  patient: ImportPatientBrief | null;
  importedPatient: ImportedPatient | null;
  registration: {
    possible: boolean;
    draft: {
      familyName: string;
      givenName: string;
      suffix?: string;
      sex: string;
      birthDate: string;
      contacts: Array<{ system: string; value: string }>;
      addresses: Array<{ line1?: string; cityMunicipality: string; province?: string; region?: string; postalCode?: string }>;
      identifiers: Array<{ type: string; value: string }>;
    } | null;
  };
  entries: FhirImportEntry[];
}

export interface FhirImportCandidates {
  searchable: boolean;
  candidates: Array<{ patient: ImportPatientBrief; level: "certain" | "high" | "possible"; reasons: string[] }>;
}

/** GET /patients/:id/external-history (clinical.read). */
export interface ExternalHistoryEntry {
  id: string;
  patientId: string;
  kind: "condition" | "observation" | "medication" | "document";
  category: string | null;
  display: string;
  codeSystem: string | null;
  code: string | null;
  valueText: string | null;
  statusText: string | null;
  effectiveText: string | null;
  source: "external_import";
  sourceReference: string;
  declaredSource: string | null;
  status: "active" | "entered_in_error";
  enteredInErrorReason: string | null;
  recordedAt: string;
}

// ---- Integration payload keys (libs/interoperability/src/lib/exchange/payload-keys.service.ts; platform administrators) ----

export interface PayloadKeyUsage {
  /** null: sealed before key ids existed. */
  keyId: string | null;
  configured: boolean;
  current: boolean;
  queuedPayloads: number;
  importContents: number;
}

export interface PayloadKeyOverview {
  currentKeyId: string;
  keys: PayloadKeyUsage[];
}
