/**
 * What the FHIR mapping needs, in the interoperability layer's own terms. The
 * API fills these from the domains' read models; this library never imports
 * a domain (libs/interoperability/CLAUDE.md: internal and external models are
 * separate). Dates are ISO strings (instants) or YYYY-MM-DD (calendar dates).
 */

export interface FhirContext {
  /** Absolute base of this FHIR endpoint, e.g. https://api.example.ph/api/v1/fhir/r4 (for Bundle fullUrls). */
  baseUrl: string;
  /** Namespace for the platform's own identifiers, e.g. "https://ids.example.ph/demo" (no trailing slash). */
  identifierBase: string;
  organization: OrganizationSource;
  /**
   * URIs for national identifiers (PhilHealth PIN, PhilSys number, PRC license…). No official URIs are on record, so
   * each defaults to a namespace under `identifierBase` until configured (an integration dependency).
   */
  identifierSystems?: Partial<Record<string, string>>;
  /** URIs for internal diagnosis coding system keys (e.g. "icd-10" → http://hl7.org/fhir/sid/icd-10). */
  codeSystems?: Partial<Record<string, string>>;
}

/**
 * Where a record came from: the platform's own staff, or another system through an accepted FHIR import (it is then
 * flagged as externally sourced in the export and never presented as this organization's own record).
 */
export type RecordSource = "staff" | "external_import";

export interface OrganizationSource {
  id: string;
  code: string;
  name: string;
}

export interface FacilitySource {
  id: string;
  code: string;
  name: string;
  facilityType: string;
  addressLine: string | null;
  barangay: string | null;
  cityMunicipality: string | null;
  province: string | null;
  region: string | null;
  postalCode: string | null;
  contactNumber: string | null;
  email: string | null;
  licenseNumber: string | null;
  status: string;
}

export interface PatientSource {
  id: string;
  patientNumber: string;
  familyName: string;
  givenName: string;
  middleName: string | null;
  suffix: string | null;
  sex: "male" | "female" | "intersex" | "unknown" | string;
  birthDate: string;
  civilStatus: string | null;
  status: "active" | "inactive" | "deceased" | "merged" | string;
  deceasedAt: string | null;
  mergedIntoPatientId: string | null;
  updatedAt: string;
  identifiers: Array<{ type: string; value: string; issuer: string | null; validFrom: string | null; validUntil: string | null }>;
  contacts: Array<{ system: "mobile" | "phone" | "email" | string; value: string; use: string; isPrimary: boolean }>;
  addresses: Array<{
    use: string;
    line1: string | null;
    barangay: string | null;
    cityMunicipality: string;
    province: string | null;
    region: string | null;
    postalCode: string | null;
    /** ISO 3166 alpha-2; Philippines when absent. */
    country?: string | null;
  }>;
  emergencyContacts: Array<{ name: string | null; relationship: string; contactNumber: string | null }>;
}

export interface PractitionerSource {
  id: string;
  displayName: string;
  profession: string;
  specialty: string | null;
  licenseNumber: string | null;
  status: string;
}

export interface EncounterSource {
  id: string;
  facilityId: string;
  practitionerId: string;
  modality: "in_person" | "telemedicine" | string;
  status: "in_progress" | "completed" | "entered_in_error";
  visitTypeName: string | null;
  chiefComplaint: string | null;
  startedAt: string;
  completedAt: string | null;
  appointmentId: string | null;
}

export interface DiagnosisSource {
  id: string;
  encounterId: string;
  codeSystemKey: string | null;
  codeSystemVersion: string | null;
  code: string | null;
  display: string;
  rank: "primary" | "secondary";
  certainty: "provisional" | "confirmed" | "refuted";
  status: "active" | "resolved" | "entered_in_error";
  isChronic: boolean;
  recordedAt: string;
}

export interface AllergySource {
  id: string;
  category: string;
  substance: string;
  reaction: string | null;
  severity: "mild" | "moderate" | "severe" | null;
  criticality: "low" | "high" | "unable_to_assess";
  verification: "unconfirmed" | "confirmed";
  status: string;
  recordedAt: string;
  /** `external_import`: accepted from an import (always unconfirmed); exported with the external-source tag. */
  source: RecordSource | string;
}

export interface AllergyReviewSource {
  noKnownAllergies: boolean;
  reviewedAt: string;
}

export interface VitalsSource {
  id: string;
  encounterId: string | null;
  measuredAt: string;
  status: "final" | "entered_in_error";
  systolicMmhg: number | null;
  diastolicMmhg: number | null;
  heartRateBpm: number | null;
  respiratoryRateBpm: number | null;
  temperatureC: number | null;
  spo2Percent: number | null;
  weightKg: number | null;
  heightCm: number | null;
}

export interface AppointmentSource {
  id: string;
  facilityId: string;
  practitionerId: string;
  practitionerName: string | null;
  visitTypeName: string;
  modality: string;
  status: "booked" | "confirmed" | "checked_in" | "completed" | "cancelled" | "no_show";
  startsAt: string;
  endsAt: string;
  reason: string | null;
  cancellationReason: string | null;
}

export interface LabOrderSource {
  id: string;
  facilityId: string;
  orderNumber: string;
  status: "active" | "completed" | "cancelled";
  priority: "routine" | "stat" | "scheduled" | string;
  orderedAt: string;
  encounterId: string | null;
  orderingPractitionerId: string | null;
  clinicalIndication: string | null;
  items: LabItemSource[];
}

export interface LabItemSource {
  id: string;
  testCode: string;
  testName: string;
  loincCode: string | null;
  status: string;
  /** The current released result, if any. */
  result: LabResultSource | null;
}

export interface LabResultSource {
  id: string;
  versionNumber: number;
  resultType: "numeric" | "text" | "coded";
  valueNumeric: number | null;
  valueText: string | null;
  valueCoded: string | null;
  unit: string | null;
  flag: "normal" | "low" | "high" | "critical_low" | "critical_high" | "abnormal" | null;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  comment: string | null;
  collectedAt: string | null;
  releasedAt: string | null;
  /** The reference laboratory that performed the test (a send-out); null when the organization's own laboratory did. */
  performer: ReferenceLaboratorySource | null;
}

/** A reference laboratory as recorded by the organization (nothing about it is verified by the platform). */
export interface ReferenceLaboratorySource {
  id: string;
  /** The name the result was attributed to when it was entered (a snapshot: what the report says). */
  name: string;
  /** The accreditation / licence reference as recorded by staff; exported only with a configured identifier system. */
  accreditationReference: string | null;
}

export interface PrescriptionSource {
  id: string;
  prescriptionNumber: string;
  status: "active" | "cancelled" | "replaced" | string;
  encounterId: string | null;
  prescriberPractitionerId: string;
  issuedAt: string;
  /** When the prescription was cancelled or replaced (its only change after issue); null while active. */
  cancelledAt: string | null;
  items: Array<{
    lineNumber: number;
    genericName: string;
    brandName: string | null;
    strength: string | null;
    dosageForm: string | null;
    doseAmount: number | null;
    doseUnit: string | null;
    route: string | null;
    frequency: string | null;
    frequencyText: string | null;
    asNeeded: boolean;
    asNeededReason: string | null;
    durationValue: number | null;
    durationUnit: string | null;
    quantity: number | null;
    quantityUnit: string | null;
    refills: number;
    instructions: string | null;
  }>;
}

export interface CarePlanSource {
  id: string;
  title: string;
  category: string;
  status: "draft" | "active" | "on_hold" | "completed" | "cancelled";
  description: string | null;
  startDate: string;
  endDate: string | null;
  authorPractitionerId: string | null;
  createdAt: string;
  activities: Array<{
    id: string;
    kind: string;
    description: string;
    status: "planned" | "scheduled" | "in_progress" | "completed" | "cancelled";
    dueDate: string | null;
  }>;
}

/**
 * A stored document of the patient (metadata only; the file stays in private object storage), uploaded by staff or
 * generated by the platform (archived laboratory reports). Only documents that are available for download are
 * exported: pending uploads and archived (withdrawn) documents are not.
 */
export interface DocumentSource {
  id: string;
  category: string;
  title: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** When the upload was verified (or the document generated). */
  uploadedAt: string;
  /**
   * When a newer version replaced it (it is then `superseded`), e.g. a later archived version of the same laboratory
   * report. Null while current.
   */
  supersededAt: string | null;
  /** Exported documents this one replaces (earlier versions). */
  replaces: string[];
  /** Resources the document belongs to, e.g. the DiagnosticReport of an archived laboratory report. */
  related: Array<{ type: string; id: string }>;
}

/**
 * An entry of the patient's external history: a Condition, Observation, medication or document description received
 * from another system and accepted by staff from a FHIR import. Kept as received (as text), never a diagnosis,
 * laboratory result, vital sign, prescription or stored document of the platform. Append-only: the only change is
 * being marked entered in error (database trigger), so `enteredInErrorAt ?? recordedAt` is a reliable last-updated time.
 */
export interface ExternalHistorySource {
  id: string;
  kind: "condition" | "observation" | "medication" | "document";
  /**
   * condition: the sender's condition category code; observation: "laboratory", "vital-signs" or "other"; medication:
   * "reported" (a MedicationStatement) or "prescribed_elsewhere" (a MedicationRequest); document: the type as text.
   */
  category: string | null;
  display: string;
  codeSystem: string | null;
  code: string | null;
  /** The value / dosage / attachment summary, as text. */
  valueText: string | null;
  /** The status as received (condition: "clinical · verification"). */
  statusText: string | null;
  /** The date as received (onset, effective, authored or document date). */
  effectiveText: string | null;
  /** The sending system as it declared itself (`Bundle.meta.source`; not verified). */
  declaredSource: string | null;
  status: "active" | "entered_in_error";
  recordedAt: string;
  enteredInErrorAt: string | null;
}

/** A performed dental procedure (the organization's own procedure code; no national dental code set is assumed). */
export interface DentalProcedureSource {
  id: string;
  facilityId: string;
  encounterId: string;
  practitionerId: string;
  code: string;
  name: string;
  /** FDI / ISO 3950 two-digit tooth code, when the procedure is on a tooth. */
  tooth: string | null;
  /** M, D, O, I, B, L. */
  surfaces: string[];
  notes: string | null;
  status: "recorded" | "entered_in_error";
  performedAt: string;
  enteredInErrorAt: string | null;
}

/** One tooth of the current dental chart (latest state; teeth never charted are absent; no findings = sound). */
export interface DentalChartToothSource {
  tooth: string;
  findings: Array<{ condition: string; surfaces: string[] }>;
  source: { type: "examination" | "procedure"; id: string };
  recordedAt: string;
}

/** A periodontal chart with its measurements per examined tooth. */
export interface DentalPerioChartSource {
  id: string;
  encounterId: string;
  practitionerId: string;
  status: "recorded" | "entered_in_error";
  recordedAt: string;
  teeth: Array<{
    tooth: string;
    mobility: number | null;
    furcation: number | null;
    sites: Array<{ site: string; probingDepth: number | null; gingivalMargin: number | null; bleeding: boolean; suppuration: boolean; plaque: boolean }>;
  }>;
}

export interface DentalSource {
  procedures: DentalProcedureSource[];
  chart: DentalChartToothSource[];
  perioCharts: DentalPerioChartSource[];
}

/** Everything about one patient that the platform exports. */
export interface PatientRecordSource {
  patient: PatientSource;
  facilities: FacilitySource[];
  practitioners: PractitionerSource[];
  encounters: EncounterSource[];
  diagnoses: DiagnosisSource[];
  allergies: AllergySource[];
  allergyReview: AllergyReviewSource | null;
  vitals: VitalsSource[];
  appointments: AppointmentSource[];
  labOrders: LabOrderSource[];
  prescriptions: PrescriptionSource[];
  carePlans: CarePlanSource[];
  /** The patient's documents, or null when the caller may not see documents (they are then withheld, with a notice). */
  documents: DocumentSource[] | null;
  /** External history accepted from imports (document descriptions are withheld with documents, when `documents` is null). */
  externalHistory: ExternalHistorySource[];
  /** The dental record (procedures, current chart findings, periodontal charts); absent when the platform has none. */
  dental?: DentalSource;
}
