import type { SessionTokens } from "@healthcare/web-session";

/** `POST /portal/auth/{activate,login,refresh}` */
export interface PortalTokenResponse extends SessionTokens {
  status: "authenticated";
  tokenType: "Bearer";
  /** Set when the patient asked to remember this browser after the second step: kept in a cookie, sent with the next sign-in. */
  deviceToken?: string;
  deviceTokenExpiresAt?: string;
}

/** `GET /portal/me`: the signed-in patient's identity (no clinical data). */
export interface PortalMe {
  patient: {
    displayName: string;
    givenName: string;
    familyName: string;
    patientNumber: string;
    birthDate: string;
    sex: string;
  };
  organization: { name: string };
  account: { email: string; emailVerified: boolean; mfaEnabled: boolean };
  /** The clinic's two-step verification requirement for patients and what it means for this account (the signed-in person's own). */
  mfaPolicy: PortalMfaPolicy;
  /** The patient's clinic's time zone: dates and times in MyHealth are shown in it (a visit uses its own facility's). */
  timeZone: string;
  /** Set when the signed-in person is acting for someone else: `patient` is then that person, `account` the signed-in person's own. */
  acting: { relationship: string; scopes: ("view" | "act")[] } | null;
}

/** `GET /portal/proxy/dependents` row */
export interface PortalDependent {
  grantId: string;
  patientId: string;
  displayName: string;
  relationship: string;
  scopes: ("view" | "act")[];
  grantedAt: string;
  expiresAt: string | null;
}

/** `GET /portal/proxy/guardians` row */
export interface PortalGuardian {
  grantId: string;
  displayName: string;
  relationship: string;
  scopes: ("view" | "act")[];
  grantedAt: string;
  expiresAt: string | null;
}

/** `GET /portal/appointments` row */
export interface PortalAppointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "booked" | "confirmed" | "checked_in" | "completed" | "cancelled" | "no_show";
  reason: string | null;
  visitType: string;
  modality: "in_person" | "telemedicine";
  practitionerName: string;
  facilityName: string;
  timeZone: string;
  version: number;
  facilityId: string;
  practitionerId: string;
  visitTypeId: string;
  bookedByPatient: boolean;
  /** What the patient may still do in MyHealth (the API enforces the same rules). */
  canCancel: boolean;
  canReschedule: boolean;
  /** In-person visit: the clinic offers online check-in and its window is open now. */
  canCheckIn: boolean;
  /** When online check-in opens, if the clinic offers it and it has not opened yet. */
  checkInOpensAt: string | null;
  /** The queue number of an in-person visit the patient is checked in for. */
  queueTicket: string | null;
}

export interface PortalAppointments {
  upcoming: PortalAppointment[];
  past: PortalAppointment[];
}

// Results and their wording are shared with the mobile app.
export type { PortalResult, PortalResultFlag, PortalTrend } from "@healthcare/domain/portal-results";

/** `GET /portal/prescriptions` row */
export interface PortalPrescription {
  id: string;
  prescriptionNumber: string;
  issuedAt: string;
  prescriberName: string | null;
  notes: string | null;
  items: Array<{
    genericName: string;
    brandName: string | null;
    strength: string | null;
    dosageForm: string | null;
    doseAmount: number | null;
    doseUnit: string | null;
    route: string;
    frequency: string;
    frequencyText: string | null;
    asNeededReason: string | null;
    durationValue: number | null;
    durationUnit: "days" | "weeks" | "months" | null;
    quantity: number;
    quantityUnit: string;
    refills: number;
    instructions: string;
  }>;
}

/** `GET /portal/care-plans` row */
export interface PortalCarePlan {
  id: string;
  title: string;
  category: string;
  startDate: string;
  goals: Array<{ id: string; description: string; targetMeasure: string | null; targetValue: string | null; targetDate: string | null; status: string }>;
  activities: Array<{ id: string; kind: string; description: string; assignee: "patient" | "care_team"; dueDate: string | null; status: string }>;
}

/** `GET /portal/teleconsults[/:appointmentId]` */
export interface PortalTeleconsult {
  appointmentId: string;
  startsAt: string;
  endsAt: string;
  /** The facility's time zone. */
  timeZone: string;
  appointmentStatus: string;
  practitionerName: string;
  visitType: string;
  status: "scheduled" | "waiting" | "in_consultation" | "ended" | "escalated";
  questionnaireSubmitted: boolean;
  waitingRoomOpensAt: string;
  videoConfigured: boolean;
  patientInstructions: string | null;
  escalated: boolean;
}

/** `POST /portal/teleconsults/:appointmentId/video` */
export interface VideoJoin {
  url: string;
  token: string;
  room: string;
  expiresInSeconds: number;
}

/** `GET /portal/booking/options`: what the clinic lets patients book online. */
export interface BookingOptions {
  visitTypes: Array<{ id: string; name: string; modality: "in_person" | "telemedicine"; durationMinutes: number }>;
  facilities: Array<{
    id: string;
    name: string;
    cityMunicipality: string | null;
    timeZone: string;
    practitioners: Array<{ id: string; displayName: string; specialty: string | null }>;
    /** The clinic's own online booking rules. */
    rules: BookingRulesView;
  }>;
}

export interface BookingRulesView {
  minLeadMinutes: number;
  maxAdvanceDays: number;
  maxUpcoming: number;
  changeCutoffMinutes: number;
  /** Patients may ask to be told when a time opens on a day with none. */
  waitlistEnabled: boolean;
  maxWaitlistEntries: number;
}

/** `GET /portal/booking/waitlist-allowance`: whether this clinic takes a request for the visit type and doctor chosen. */
export interface WaitlistAllowance {
  enabled: boolean;
  maxEntries: number;
  maxDaysAhead: number;
}

/** `GET /portal/booking/offers` row: a time the clinic is holding for the patient from the waiting list. */
export interface PortalWaitlistOffer {
  id: string;
  facilityId: string;
  facilityName: string;
  timeZone: string;
  visitTypeId: string;
  visitTypeName: string;
  practitionerId: string;
  practitionerName: string;
  startsAt: string;
  endsAt: string;
  expiresAt: string;
}

/** `GET /portal/booking/waitlist` row. */
export interface PortalWaitlistEntry {
  id: string;
  facilityId: string;
  facilityName: string;
  visitTypeId: string | null;
  visitTypeName: string | null;
  practitionerId: string | null;
  practitionerName: string | null;
  earliestDate: string;
  latestDate: string;
  createdAt: string;
}

/** `GET /portal/booking/slots` */
export interface BookingSlots {
  date: string;
  timeZone: string;
  durationMinutes: number;
  slots: Array<{ startsAt: string; endsAt: string; practitionerId: string; practitionerName: string }>;
}

/** The appointment as returned after a booking change. */
export interface BookedAppointment {
  id: string;
  facilityId: string;
  practitionerId: string;
  visitTypeId: string;
  startsAt: string;
  endsAt: string;
  status: PortalAppointment["status"];
  reason: string | null;
  version: number;
}

/** `GET /portal/messages` row: an in-app message, rendered by the API. */
export interface PortalMessage {
  id: string;
  templateKey: string;
  subject: string | null;
  text: string;
  createdAt: string;
  readAt: string | null;
}

/** `GET /portal/billing` row: an issued (or voided) invoice. Amounts are integer centavos (PHP). */
export interface PortalInvoice {
  id: string;
  invoiceNumber: string;
  status: "issued" | "void";
  issuedAt: string;
  grossTotal: number;
  discountTotal: number;
  netTotal: number;
  payerTotal: number;
  patientTotal: number;
  paidTotal: number;
  balance: number;
  items: Array<{ description: string; serviceDate: string; quantity: number; grossAmount: number; discountAmount: number; netAmount: number }>;
  discounts: Array<{ name: string; amount: number }>;
  payers: Array<{ name: string; amount: number; status: "pending" | "submitted" | "settled" | "denied" }>;
  payments: Array<{ kind: "payment" | "refund"; amount: number; method: string; receiptNumber: string | null; recordedAt: string }>;
}

/** Deposits and credit notes on an invoice (migration 0035). */
export interface PortalInvoiceCredits {
  depositAppliedTotal: number;
  creditedTotal: number;
  depositApplications: Array<{ kind: "application" | "release"; amount: number; recordedAt: string }>;
  creditNotes: Array<{
    id: string;
    creditNoteNumber: string;
    issuedAt: string;
    reason: string;
    amount: number;
    appliedAmount: number;
    accountCredit: number;
  }>;
}

/** The patient's deposit and credit balance at one facility. */
export interface PortalAccount {
  facilityName: string;
  balance: number;
  entries: Array<{
    kind: "deposit" | "credit" | "application" | "release" | "refund" | "transfer_in" | "transfer_out";
    amount: number;
    method: string | null;
    receiptNumber: string | null;
    invoiceNumber: string | null;
    creditNoteNumber: string | null;
    recordedAt: string;
  }>;
}

/** Debit notes and online payments on an invoice (migrations 0036, 0038). */
export interface PortalInvoiceNotes {
  debitedTotal: number;
  debitNotes: Array<{
    id: string;
    debitNoteNumber: string;
    issuedAt: string;
    reason: string;
    amount: number;
    lines: Array<{ description: string; quantity: number; amount: number }>;
  }>;
  onlinePayments: Array<{ id: string; amount: number; status: "pending" | "succeeded" | "failed" | "cancelled" | "expired"; createdAt: string }>;
}

/** Whether online payment is offered (a payment provider is an integration dependency). */
export interface PortalOnlinePayment {
  available: boolean;
  name: string;
  note: string;
}

// ---- Dental records (GET /portal/dental/*; only when the clinic shares them — libs/dental/src/lib/portal/dental-patient-access.ts) ----

/** For the navigation: the clinic shares dental records in MyHealth and there is something to show. */
export interface PortalDentalAvailability {
  available: boolean;
}

export type PortalToothCondition =
  "caries" | "restoration" | "sealant" | "fracture" | "crown" | "root_canal" | "missing" | "implant" | "pontic" | "impacted" | "unerupted" | "watch";
export type PortalToothSurface = "M" | "D" | "O" | "I" | "B" | "L";
export type PortalDentalPlanStatus = "proposed" | "accepted" | "in_progress" | "completed" | "declined" | "discontinued";
export type PortalDentalItemStatus = "proposed" | "accepted" | "declined" | "completed" | "cancelled";

export interface PortalDentalPlan {
  id: string;
  title: string;
  status: PortalDentalPlanStatus;
  /** Where the latest decision was taken. */
  decidedIn: "clinic" | "myhealth" | null;
  /** The patient can accept or decline items awaiting their decision here. */
  canDecide: boolean;
  /** Calendar dates (YYYY-MM-DD). */
  proposedOn: string;
  decidedOn: string | null;
  facilityName: string | null;
  dentistName: string | null;
  items: Array<{
    id: string;
    phase: number;
    /** FDI code, shown in the record's notation; null: the whole mouth. */
    tooth: string | null;
    surfaces: PortalToothSurface[];
    procedureName: string;
    status: PortalDentalItemStatus;
    /** Null for an item that is no longer planned. */
    decision: "awaiting" | "accepted" | "declined" | null;
    /** With an estimate: the listed price (centavos) of work still ahead; null: no listed price or not ahead. */
    estimatedFee?: number | null;
    /** The high end when the treatment may turn out to be another (its fee is a range); null: a single price. */
    estimatedFeeHigh?: number | null;
    /** With a range: what the treatment may turn out to be. */
    mayBecome?: string[];
  }>;
  /** Only when the clinic shows fee estimates in MyHealth and something on the plan is still ahead. */
  estimate: PortalPlanEstimate | null;
}

/** The fee estimate of the work still ahead on a plan, at the clinic's listed prices (centavos). */
export interface PortalPlanEstimate {
  pricedOn: string;
  awaitingDecision: number;
  accepted: number;
  remaining: number;
  /** High ends of the totals (the same as the above when no treatment has a fee range). */
  awaitingDecisionHigh: number;
  acceptedHigh: number;
  remainingHigh: number;
  unpricedItems: number;
  disclaimer: string;
  note: string | null;
}

export interface PortalDentalProcedure {
  id: string;
  performedOn: string;
  tooth: string | null;
  surfaces: PortalToothSurface[];
  procedureName: string;
  facilityName: string | null;
  dentistName: string | null;
}

export interface PortalDentalTooth {
  tooth: string;
  /** Empty: checked, nothing noted. */
  conditions: Array<{ condition: PortalToothCondition; surfaces: PortalToothSurface[] }>;
  updatedOn: string;
}

/** An X-ray or photo the dentist shared (opened through a short-lived link). */
export interface PortalDentalImage {
  id: string;
  kind: "periapical" | "bitewing" | "panoramic" | "cephalometric" | "occlusal" | "cbct" | "intraoral_photo" | "extraoral_photo" | "other";
  teeth: string[];
  takenOn: string;
  sharedOn: string;
  facilityName: string | null;
}

export interface PortalDentalRecord {
  notation: "fdi" | "universal" | "palmer";
  chart: PortalDentalTooth[];
  plans: PortalDentalPlan[];
  procedures: PortalDentalProcedure[];
  images: PortalDentalImage[];
  /** Online plan decisions: allowed or not, and the clinic's text the patient confirms. */
  decisions: { enabled: boolean; acknowledgement: string | null };
}

// ---- Documents: medical certificates and records requests (GET /portal/documents; migration 0068) ---------------

export type PortalRecordsScope = "consultations" | "laboratory" | "prescriptions" | "dental" | "imaging" | "certificates" | "other";
export type PortalRecordsRequestStatus = "submitted" | "in_review" | "fulfilled" | "declined" | "withdrawn";

export interface PortalCertificate {
  id: string;
  certificateNumber: string;
  examinedOn: string;
  issuedAt: string;
  purpose: string;
  practitionerName: string | null;
  restDays: number | null;
}

export interface PortalRecordsRequest {
  id: string;
  requestNumber: string;
  scope: PortalRecordsScope[];
  periodFrom: string | null;
  periodTo: string | null;
  details: string | null;
  purpose: string | null;
  status: PortalRecordsRequestStatus;
  submittedAt: string;
  /** When the clinic aims to answer, from its own response time (none: null). */
  respondBy: string | null;
  closedAt: string | null;
  /** The records office's note (shared) or reason (declined). */
  responseNote: string | null;
  documents: Array<{ documentId: string; title: string; category: string; sharedAt: string }>;
}

/** A referral made for the patient: who it is to, when, how urgent and where it stands (the letter holds the rest). */
export interface PortalReferral {
  id: string;
  referralNumber: string;
  issuedAt: string;
  status: "sent" | "accepted" | "declined" | "completed" | "cancelled";
  urgency: "routine" | "urgent" | "emergency";
  recipient: string;
  specialty: string | null;
  referringPractitionerName: string | null;
  letterAvailable: boolean;
}

export interface PortalDocuments {
  /** Older API versions leave it out. */
  referrals?: PortalReferral[];
  certificates: PortalCertificate[];
  requests: PortalRecordsRequest[];
  /** What the clinic tells patients before they ask, in its own words (none: null). */
  requestNotice: string | null;
  /** The clinic's own response time in days (none: null). */
  responseDays: number | null;
}

// ---- consents (/portal/consents) ----

export type ConsentType =
  "data_processing" | "treatment_general" | "telemedicine" | "data_sharing_hmo" | "data_sharing_philhealth" | "portal_access" | "research";

export interface PortalConsentDecision {
  id: string;
  decision: "granted" | "refused" | "withdrawn";
  effectiveAt: string;
  expiresAt: string | null;
  recordedAt: string;
  recordedVia: "clinic" | "myhealth";
  /** The version of the clinic's wording the patient read, for a consent given online. */
  wordingVersion: number | null;
}

/** `GET /portal/consents/:type/wording`: the organization's own words a patient reads before giving a consent online. */
export interface PortalConsentWording {
  id: string;
  consentType: ConsentType;
  version: number;
  title: string;
  body: string;
  acknowledgement: string;
}

export interface PortalConsent {
  consentType: ConsentType;
  current: PortalConsentDecision | null;
  inEffect: boolean;
  canWithdraw: boolean;
  /** The patient may give this consent now, in MyHealth (the clinic offers it online with its own wording). */
  canGive: boolean;
  history: PortalConsentDecision[];
}

export type PreferenceChannel = "sms" | "email" | "push";
export type PreferenceCategory = "clinical" | "administrative" | "outreach";

export interface PortalPreference {
  channel: PreferenceChannel;
  category: PreferenceCategory;
  choice: boolean | null;
  enabled: boolean;
  recordedVia: "clinic" | "myhealth" | null;
  updatedAt: string | null;
}

export interface PortalPreferences {
  destinations: Record<PreferenceChannel, string | null>;
  preferences: PortalPreference[];
}

/** The password was right and the account uses two-step verification (`POST /portal/auth/login`). */
export interface PortalMfaRequired {
  status: "mfa_required";
  challengeToken: string;
  /** The account has a passkey for the second step (migration 0108). */
  passkeys?: boolean;
}

/** `GET /portal/email` */
export interface PortalEmailStatus {
  email: string;
  verified: boolean;
  verifiedAt: string | null;
  pending: { emailMasked: string; isChange: boolean; expiresAt: string } | null;
}

/** On `GET /portal/me`: whether the clinic requires two-step verification, from which local date, and whether this account may only set it up now. */
export interface PortalMfaPolicy {
  required: boolean;
  requiredFrom: string | null;
  enrollmentRequired: boolean;
}

/** `GET /portal/mfa/devices` row: a browser remembered after the second step. */
/** A passkey of the account (migration 0108); the second step of signing in may use it instead of a code. */
export interface PortalPasskey {
  id: string;
  label: string;
  /** The passkey may be synced to the patient's other devices. */
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface PortalPasskeyList {
  /** This MyHealth address offers passkeys. */
  available: boolean;
  limit: number;
  passkeys: PortalPasskey[];
}

export interface PortalTrustedDevice {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  /** The browser this page is open in. */
  current: boolean;
}

/** `GET /portal/mfa` */
export interface PortalMfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
  emailVerified: boolean;
}

/** `POST /portal/mfa/setup` (`qrSvg` is drawn by the portal's own server from `otpauthUri`) */
export interface PortalMfaSetup {
  qrSvg?: string;
  setupKey: string;
  secret: string;
  otpauthUri: string;
}

/** `GET /portal/immunizations` row: a dose given (here, reported or from another provider), no staff notes. */
export interface PortalImmunization {
  id: string;
  vaccineName: string;
  vaccineProduct: string | null;
  dose: string | null;
  /** "2019", "2019-05", "2019-05-12" or an ISO instant, at the precision known. */
  occurrence: string;
  occurrencePrecision: "year" | "month" | "day" | "time";
  source: "administered_here" | "historical" | "external_import";
  /** The clinic, or who gave it as reported; null when not known. */
  where: string | null;
}

/** `GET /portal/health-history`: the patient's history as the clinic recorded it (no staff notes, entries in error left out). */
/** Recorded by the clinic, or reported by the patient (or someone acting for them) in MyHealth. */
export type HistoryRecordedVia = "staff" | "patient_portal";
export type HistoryUseStatus = "never" | "former" | "current" | "unknown";
export type FamilyRelationship =
  | "mother"
  | "father"
  | "sister"
  | "brother"
  | "sibling"
  | "half_sibling"
  | "daughter"
  | "son"
  | "child"
  | "maternal_grandmother"
  | "maternal_grandfather"
  | "paternal_grandmother"
  | "paternal_grandfather"
  | "maternal_aunt"
  | "maternal_uncle"
  | "paternal_aunt"
  | "paternal_uncle"
  | "cousin"
  | "other";

export interface PortalHealthHistory {
  procedures: Array<{
    id: string;
    description: string;
    /** "2019", "2019-05", "2019-05-12", or null when not known. */
    performed: string | null;
    performer: string | null;
    bodySite: string | null;
    source: "reported" | "recorded_here" | "external_import";
    recordedVia: HistoryRecordedVia;
  }>;
  conditions: Array<{
    id: string;
    description: string;
    onset: string | null;
    status: "active" | "resolved" | "unknown";
    source: "reported" | "recorded_here";
    recordedVia: HistoryRecordedVia;
  }>;
  /** Medicines taken that the clinic did not prescribe (prescribed elsewhere, over the counter, supplements), as told to it. */
  medications: Array<{
    id: string;
    medication: string;
    dose: string | null;
    reason: string | null;
    prescribedBy: string | null;
    started: string | null;
    status: "taking" | "stopped" | "unknown";
    stopped: string | null;
    source: "reported" | "recorded_here";
    recordedVia: HistoryRecordedVia;
    /** The patient may mark it stopped here: reported in MyHealth and not stopped yet. */
    canStop: boolean;
  }>;
  family: {
    state: "not_recorded" | "recorded" | "none_known" | "unknown";
    unknownReason: "adopted" | "not_known" | "declined_to_answer" | null;
    reviewedOn: string | null;
    entries: Array<{
      id: string;
      relative: string;
      condition: string;
      onsetAge: number | null;
      deceased: boolean | null;
      causeOfDeath: string | null;
      source: "reported" | "external_import";
      recordedVia: HistoryRecordedVia;
    }>;
  };
  /** Questionnaires completed in MyHealth, newest first. */
  submissions: Array<{ id: string; submittedAt: string; sections: Array<"procedure" | "condition" | "medication" | "family" | "social">; byProxy: boolean }>;
  social: {
    effectiveDate: string;
    recordedVia: HistoryRecordedVia;
    tobacco: string | null;
    tobaccoStatus: HistoryUseStatus | null;
    tobaccoType: string | null;
    tobaccoAmount: string | null;
    tobaccoQuitYear: number | null;
    alcohol: string | null;
    alcoholStatus: HistoryUseStatus | null;
    alcoholFrequency: string | null;
    occupation: string | null;
    occupationalExposures: string | null;
    livingSituation: string | null;
    physicalActivity: string | null;
    diet: string | null;
    /** True for someone acting for the patient: substance use and sexual history are shown only to the patient. */
    sensitiveWithheld: boolean;
    substanceUse: string | null;
    sexualHistory: string | null;
  } | null;
}

/** `POST /portal/health-history/submissions` body: the questionnaire answered in one go (no codes, no sensitive parts). */
export interface PortalHistorySubmission {
  medications?: Array<{
    medication: string;
    dose?: string;
    reason?: string;
    prescribedBy?: string;
    started?: string;
    status: "taking" | "stopped" | "unknown";
    stopped?: string;
  }>;
  conditions?: Array<{ description: string; onset?: string; status: "active" | "resolved" | "unknown"; diagnosedBy?: string }>;
  procedures?: Array<{ description: string; performed?: string; performer?: string; bodySite?: string }>;
  family?: Array<{
    relationship: FamilyRelationship;
    relationshipText?: string;
    condition: string;
    onsetAge?: number;
    deceased?: boolean;
    causeOfDeath?: string;
  }>;
  social?: {
    tobaccoStatus?: HistoryUseStatus | null;
    tobaccoType?: string | null;
    tobaccoAmount?: string | null;
    tobaccoQuitYear?: number | null;
    alcoholStatus?: HistoryUseStatus | null;
    alcoholFrequency?: string | null;
    occupation?: string | null;
    occupationalExposures?: string | null;
    livingSituation?: string | null;
    physicalActivity?: string | null;
    diet?: string | null;
  };
}

/** `POST /portal/health-history/submissions` → the submission recorded (or the first one, on a retry with the same key). */
export interface PortalHistorySubmissionResult {
  id: string;
  submittedAt: string;
  sections: PortalHealthHistory["submissions"][number]["sections"];
  entryIds: string[];
  byProxy: boolean;
  replayed: boolean;
}

export type MessageTopic = "general" | "appointment" | "results" | "medication" | "billing" | "other";

/** `GET /portal/message-threads` row: a conversation with the clinic. */
export interface PortalThread {
  id: string;
  topic: MessageTopic;
  subject: string;
  status: "open" | "closed";
  startedBy: "patient" | "staff";
  messageCount: number;
  lastMessageAt: string;
  lastMessageFrom: "patient" | "staff";
  /** The clinic wrote and the patient has not read it. */
  unread: boolean;
}

/** A file carried with a message (a photo or PDF the patient sent, or a document the clinic shared); opened behind a short-lived link. */
export interface PortalThreadAttachment {
  documentId: string;
  title: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface PortalThreadMessage {
  id: string;
  sender: "patient" | "staff";
  senderName: string | null;
  body: string;
  /** Written by a parent or guardian acting for the patient. */
  viaGuardian: boolean;
  createdAt: string;
  attachments: PortalThreadAttachment[];
}

export interface PortalThreadDetail extends PortalThread {
  messages: PortalThreadMessage[];
}

/** `GET /portal/push` */
export interface PortalPushStatus {
  /** The clinic's platform can send push (it has its key pair). */
  configured: boolean;
  vapidPublicKey: string | null;
  devices: Array<{ id: string; label: string; createdAt: string; lastSuccessAt: string | null }>;
  /** The device asking (by its browser address), when registered. */
  thisDeviceId: string | null;
}
