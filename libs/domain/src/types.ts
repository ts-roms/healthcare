/**
 * Core clinical domain types shared by every UI surface.
 * Shapes are intentionally FHIR-inspired but simplified for the UI layer.
 */

export type Sex = "female" | "male" | "intersex" | "other" | "unknown";

export type BloodType = "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-";

export type Severity = "mild" | "moderate" | "severe" | "life-threatening";

export interface Allergy {
  id: string;
  substance: string;
  reaction?: string;
  severity: Severity;
}

export interface Medication {
  id: string;
  name: string;
  dose: string;
  frequency: string;
  route?: string;
  startedOn?: string;
  prescriber?: string;
  status: "active" | "paused" | "stopped";
}

export interface Problem {
  id: string;
  code?: string;
  description: string;
  onset?: string;
  status: "active" | "resolved" | "inactive";
}

export interface Patient {
  id: string;
  mrn: string;
  givenName: string;
  familyName: string;
  birthDate: string;
  sex: Sex;
  bloodType?: BloodType;
  phone?: string;
  photoUrl?: string;
  philHealth?: { number: string; verified: boolean };
  allergies: Allergy[];
  medications: Medication[];
  problems: Problem[];
}

export interface VitalSigns {
  recordedAt: string;
  systolic?: number;
  diastolic?: number;
  heartRate?: number;
  respiratoryRate?: number;
  temperatureC?: number;
  spo2?: number;
  weightKg?: number;
  heightCm?: number;
}

/** Interpretation flag of a lab observation relative to its reference range. */
export type LabFlag = "normal" | "low" | "high" | "critical-low" | "critical-high" | "abnormal";

export interface LabObservation {
  id: string;
  code: string;
  name: string;
  value: number | string;
  unit?: string;
  referenceLow?: number;
  referenceHigh?: number;
  referenceText?: string;
  flag: LabFlag;
}

export type LabOrderStatus = "ordered" | "collected" | "received" | "processing" | "awaiting-verification" | "verified" | "rejected" | "review";

export type SpecimenType = "blood" | "serum" | "plasma" | "urine" | "stool" | "swab" | "csf";

export interface Specimen {
  id: string;
  type: SpecimenType;
  container?: string;
  collectedAt?: string;
  receivedAt?: string;
  rejectedReason?: string;
}

export interface LabOrder {
  id: string;
  accession: string;
  patientId: string;
  patientName: string;
  patientAge: number;
  patientSex: Sex;
  test: string;
  department: "hematology" | "chemistry" | "microscopy" | "immunology" | "microbiology";
  priority: "routine" | "urgent" | "stat";
  status: LabOrderStatus;
  orderedAt: string;
  orderedBy: string;
  specimen?: Specimen;
  observations: LabObservation[];
}

export interface LabTrendPoint {
  date: string;
  value: number;
}

export type EncounterType = "consultation" | "follow-up" | "telemedicine" | "dental" | "laboratory" | "procedure" | "emergency";

export type EncounterStatus = "planned" | "waiting" | "in-progress" | "unsigned" | "completed" | "cancelled";

export interface ClinicalNoteSections {
  chiefComplaint: string;
  hpi: string;
  examination: string;
  diagnosis: string;
  plan: string;
}

export interface Diagnosis {
  code: string;
  display: string;
  primary?: boolean;
}

export interface Encounter {
  id: string;
  patientId: string;
  type: EncounterType;
  status: EncounterStatus;
  date: string;
  provider: string;
  facility: string;
  reason: string;
  note?: Partial<ClinicalNoteSections>;
  diagnoses?: Diagnosis[];
}

export type TimelineEventKind = "encounter" | "telemedicine" | "lab" | "prescription" | "dental" | "referral" | "billing" | "document";

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  date: string;
  title: string;
  detail?: string;
  flag?: "critical" | "abnormal";
}

export interface CarePlanGoal {
  id: string;
  description: string;
  target?: string;
  due?: string;
  status: "not-started" | "in-progress" | "achieved" | "missed";
}

export interface CarePlan {
  id: string;
  title: string;
  condition: string;
  startedOn: string;
  reviewOn?: string;
  goals: CarePlanGoal[];
}

export type AppointmentStatus = "booked" | "confirmed" | "arrived" | "in-progress" | "completed" | "no-show" | "cancelled";

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  provider: string;
  start: string;
  durationMin: number;
  type: EncounterType;
  mode: "in-person" | "online";
  status: AppointmentStatus;
  reason?: string;
}

/** "ready": triaged and waiting for the provider. */
export type QueueStatus = "waiting" | "vitals" | "ready" | "with-provider" | "for-billing" | "done";

export interface QueueEntry {
  id: string;
  ticket: string;
  patientName: string;
  station: string;
  status: QueueStatus;
  arrivedAt: string;
  priority?: "senior" | "pwd" | "pregnant" | "urgent" | "emergency";
}

export interface PrescriptionItem {
  id: string;
  drug: string;
  strength: string;
  form: string;
  sig: string;
  quantity: number;
  refills: number;
}

// ---- Dental -----------------------------------------------------------------

/** FDI two-digit tooth number, e.g. 11–18, 21–28, 31–38, 41–48. */
export type ToothNumber = number;

export type ToothCondition = "healthy" | "caries" | "filled" | "missing" | "extraction" | "root-canal" | "crown";

export type ToothSurface = "mesial" | "distal" | "buccal" | "lingual" | "occlusal";

export interface ToothRecord {
  tooth: ToothNumber;
  condition: ToothCondition;
  surfaces: ToothSurface[];
  notes?: string;
}

export type DentalChart = Record<ToothNumber, ToothRecord>;

// ---- Audit ------------------------------------------------------------------

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: "created" | "viewed" | "updated" | "signed" | "verified" | "printed" | "deleted";
  target: string;
  detail?: string;
}

export interface Provider {
  id: string;
  name: string;
  specialty: string;
}

export interface Facility {
  id: string;
  name: string;
  kind: "clinic" | "laboratory" | "dental" | "hospital";
}
