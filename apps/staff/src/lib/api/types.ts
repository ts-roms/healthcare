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
