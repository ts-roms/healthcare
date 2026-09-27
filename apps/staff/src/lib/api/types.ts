/**
 * Response shapes of the healthcare API (apps/api) used by the staff app.
 *
 * Hand-mirrored from the API's views/DTOs because the frontend may not import
 * backend libraries (layer:ui boundary). Move these into `type:contract`
 * libraries (or generate them from the OpenAPI document) as domains grow.
 */

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
  recordedAt: string;
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
}

/** A visit as returned by the queue commands (walk-in, check-in, move, call). */
export type Visit = Omit<QueueVisit, "patient" | "waitingMinutes">;

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
  reason: string | null;
  version: number;
  patient: PatientBrief | null;
}

export interface Practitioner {
  id: string;
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
