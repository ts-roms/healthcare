import type { Patient, Sex } from "@healthcare/domain";
import type { PatientAddress, PatientDetail, PatientSex } from "./api/types";

const SEX: Record<PatientSex, Sex> = { male: "male", female: "female", intersex: "intersex", unknown: "unknown" };

/**
 * Adapts an API patient to the design system's patient banner.
 *
 * Allergies, medications and problems are empty because the API has no
 * clinical record yet (Phase 2). Render the banner with
 * `allergiesRecorded={false}` so the empty list reads "Allergies not recorded",
 * never "No known allergies".
 */
export function toBannerPatient(p: PatientDetail): Patient {
  const primaryMobile = p.contacts.find((c) => c.system === "mobile" && c.isPrimary) ?? p.contacts.find((c) => c.system === "mobile");
  return {
    id: p.id,
    mrn: p.patientNumber,
    givenName: [p.givenName, p.middleName, p.suffix].filter(Boolean).join(" "),
    familyName: p.familyName,
    birthDate: p.birthDate,
    sex: SEX[p.sex] ?? "unknown",
    phone: primaryMobile?.value,
    allergies: [],
    medications: [],
    problems: [],
  };
}

export function formatAddress(a: PatientAddress): string {
  return [a.line1, a.barangay ? `Brgy. ${a.barangay}` : null, a.cityMunicipality, a.province, a.postalCode].filter(Boolean).join(", ");
}

const LABELS: Record<string, string> = {
  philhealth_pin: "PhilHealth PIN",
  philsys_number: "PhilSys number",
  senior_citizen_id: "Senior citizen ID",
  pwd_id: "PWD ID",
  passport: "Passport",
  drivers_license: "Driver's license",
  hmo_member_id: "HMO member ID",
  external_mrn: "External MRN",
  data_processing: "Data processing (DPA)",
  treatment_general: "General treatment",
  telemedicine: "Telemedicine",
  data_sharing_hmo: "Sharing with HMO",
  data_sharing_philhealth: "Sharing with PhilHealth",
  portal_access: "Patient portal access",
  research: "Research",
  in_app: "In-app",
  sms: "SMS",
};

/** Human label for an API enum value: known labels first, else "snake_case" → "Snake case". */
export function label(value: string | null | undefined): string {
  if (!value) return "—";
  return LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

/** Latest decision per consent type (the API keeps consents append-only). */
export function currentConsents<T extends { consentType: string; recordedAt: string }>(consents: T[]): T[] {
  const latest = new Map<string, T>();
  for (const c of consents) {
    const prev = latest.get(c.consentType);
    if (!prev || c.recordedAt > prev.recordedAt) latest.set(c.consentType, c);
  }
  return [...latest.values()].sort((a, b) => a.consentType.localeCompare(b.consentType));
}
