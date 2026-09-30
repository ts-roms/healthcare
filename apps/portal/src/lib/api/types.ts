import type { SessionTokens } from "@healthcare/web-session";

/** `POST /portal/auth/{activate,login,refresh}` */
export interface PortalTokenResponse extends SessionTokens {
  status: "authenticated";
  tokenType: "Bearer";
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
  account: { email: string };
  /** The patient's clinic's time zone: dates and times in MyHealth are shown in it (a visit uses its own facility's). */
  timeZone: string;
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
}

export interface PortalAppointments {
  upcoming: PortalAppointment[];
  past: PortalAppointment[];
}

export type PortalResultFlag = "normal" | "low" | "high" | "critical_low" | "critical_high" | "abnormal";

/** `GET /portal/results` row: a released result the laboratory allows patients to see. */
export interface PortalResult {
  id: string;
  testId: string;
  testName: string;
  orderId: string;
  orderNumber: string;
  resultType: "numeric" | "text" | "coded";
  valueNumeric: number | null;
  valueText: string | null;
  valueCoded: string | null;
  unit: string | null;
  flag: PortalResultFlag | null;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  collectedAt: string | null;
  releasedAt: string | null;
  corrected: boolean;
  /** The partner (reference) laboratory that performed the test; null: the clinic's own laboratory. */
  performingLaboratory: string | null;
}

/** `GET /portal/results/trend?testId=` */
export interface PortalTrend {
  analyte: string;
  testName: string;
  unit: string | null;
  points: PortalResult[];
}

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
  }>;
  rules: { minLeadMinutes: number; maxAdvanceDays: number; maxUpcoming: number; changeCutoffMinutes: number };
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

export interface PortalDocuments {
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
}

export interface PortalConsent {
  consentType: ConsentType;
  current: PortalConsentDecision | null;
  inEffect: boolean;
  canWithdraw: boolean;
  history: PortalConsentDecision[];
}
