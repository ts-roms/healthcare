import type { Allergy, Patient, Severity, Sex, VitalSigns } from "@healthcare/domain";
import type { AllergyRecord, AllergySummary, PatientAddress, PatientDetail, PatientSex, VitalsRecord } from "./api/types";

const SEX: Record<PatientSex, Sex> = { male: "male", female: "female", intersex: "intersex", unknown: "unknown" };

/**
 * Adapts an API patient (and, when the viewer may see it, the allergy summary)
 * to the design system's patient banner. Without a summary the allergy list is
 * empty: render the banner with `allergiesHidden` so it never implies "no allergies".
 */
export function toBannerPatient(p: PatientDetail, allergies?: AllergySummary): Patient {
  const primaryMobile = p.contacts.find((c) => c.system === "mobile" && c.isPrimary) ?? p.contacts.find((c) => c.system === "mobile");
  return {
    id: p.id,
    mrn: p.patientNumber,
    givenName: [p.givenName, p.middleName, p.suffix].filter(Boolean).join(" "),
    familyName: p.familyName,
    birthDate: p.birthDate,
    sex: SEX[p.sex] ?? "unknown",
    phone: primaryMobile?.value,
    allergies: sortByDanger(allergies?.allergies.map(toBannerAllergy) ?? []),
    medications: [],
    problems: [],
  };
}

/**
 * High criticality means a potential for a life-threatening reaction, so it is
 * shown at the highest level even when the recorded severity is lower or unknown.
 * An unknown severity is never shown as "mild".
 */
export function bannerSeverity(a: Pick<AllergyRecord, "severity" | "criticality">): Severity {
  if (a.criticality === "high") return "life-threatening";
  return a.severity ?? "moderate";
}

const DANGER: Record<Severity, number> = { "life-threatening": 0, severe: 1, moderate: 2, mild: 3 };

/** Most dangerous first, so the banner leads with what matters at the bedside. */
export function sortByDanger<T extends { severity: Severity }>(items: T[]): T[] {
  return [...items].sort((a, b) => DANGER[a.severity] - DANGER[b.severity]);
}

function toBannerAllergy(a: AllergyRecord): Allergy {
  const details = [a.reaction, a.verification === "unconfirmed" ? "unconfirmed" : null, a.criticality === "high" ? "high criticality" : null].filter(Boolean);
  return { id: a.id, substance: a.substance, reaction: details.join(" · ") || undefined, severity: bannerSeverity(a) };
}

export function toVitalSigns(v: VitalsRecord): VitalSigns {
  const n = (x: number | null) => x ?? undefined;
  return {
    recordedAt: v.measuredAt,
    systolic: n(v.systolicMmhg),
    diastolic: n(v.diastolicMmhg),
    heartRate: n(v.heartRateBpm),
    respiratoryRate: n(v.respiratoryRateBpm),
    temperatureC: n(v.temperatureC),
    spo2: n(v.spo2Percent),
    weightKg: n(v.weightKg),
    heightCm: n(v.heightCm),
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
