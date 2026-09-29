import { ageInYears, maskPhone, todayInPhilippines } from "@healthcare/core";
import type {
  PatientAddressRecord,
  PatientConsentRecord,
  PatientContactPointRecord,
  PatientIdentifierRecord,
  PatientRecord,
  PatientRelationshipRecord,
} from "./patient.schema";

/** "DELA CRUZ, Juan Santos Jr." */
export function displayName(p: Pick<PatientRecord, "familyName" | "givenName" | "middleName" | "suffix">): string {
  const given = [p.givenName, p.middleName, p.suffix].filter(Boolean).join(" ");
  return `${p.familyName.toUpperCase()}, ${given}`;
}

/**
 * Minimal patient summary for search results and duplicate warnings:
 * enough to identify the right person, nothing clinical, contact masked.
 */
export interface PatientSummary {
  id: string;
  patientNumber: string;
  displayName: string;
  sex: string;
  birthDate: string;
  age: number;
  status: string;
  mergedIntoPatientId: string | null;
  primaryMobileMasked: string | null;
}

export function toSummary(p: PatientRecord, primaryMobile?: string | null): PatientSummary {
  return {
    id: p.id,
    patientNumber: p.patientNumber,
    displayName: displayName(p),
    sex: p.sex,
    birthDate: p.birthDate,
    age: ageInYears(p.birthDate, todayInPhilippines()),
    status: p.status,
    mergedIntoPatientId: p.mergedIntoPatientId,
    primaryMobileMasked: primaryMobile ? maskPhone(primaryMobile) : null,
  };
}

export interface PatientDetail {
  id: string;
  patientNumber: string;
  displayName: string;
  familyName: string;
  givenName: string;
  middleName: string | null;
  suffix: string | null;
  sex: string;
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
  contacts: Array<Pick<PatientContactPointRecord, "id" | "system" | "value" | "use" | "isPrimary">>;
  addresses: Array<Omit<PatientAddressRecord, "organizationId" | "patientId" | "status" | "createdBy" | "retiredAt" | "retiredBy">>;
  identifiers: Array<Pick<PatientIdentifierRecord, "id" | "type" | "value" | "issuer" | "validFrom" | "validUntil">>;
  relationships: Array<
    Pick<PatientRelationshipRecord, "id" | "relationship" | "relatedPatientId" | "name" | "contactNumber" | "isEmergencyContact" | "isLegalGuardian" | "notes">
  >;
  consents: ConsentView[];
  communicationPreferences: Array<{ channel: string; category: string; optedIn: boolean }>;
}

export interface ConsentView {
  id: string;
  consentType: string;
  decision: string;
  effectiveAt: string;
  expiresAt: string | null;
  capturedVia: string;
  documentId: string | null;
  notes: string | null;
  /** The staff user who recorded it; null when the patient recorded it in MyHealth. */
  recordedBy: string | null;
  recordedAt: string;
  /** Recorded by staff at the clinic, or by the patient in MyHealth (a withdrawal). */
  recordedVia: "staff" | "myhealth";
}

export function toConsentView(c: PatientConsentRecord): ConsentView {
  return {
    id: c.id,
    consentType: c.consentType,
    decision: c.decision,
    effectiveAt: c.effectiveAt.toISOString(),
    expiresAt: c.expiresAt?.toISOString() ?? null,
    capturedVia: c.capturedVia,
    documentId: c.documentId,
    notes: c.notes,
    recordedBy: c.recordedBy,
    recordedAt: c.recordedAt.toISOString(),
    recordedVia: c.recordedByPortalAccount ? "myhealth" : "staff",
  };
}
