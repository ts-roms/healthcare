import { describe, expect, it } from "vitest";
import type { PatientDetail } from "./api/types";
import { bannerSeverity, currentConsents, formatAddress, label, toBannerPatient, toVitalSigns } from "./patient-mapping";

const detail = {
  id: "8c7b1a6e-1111-4c2b-9d9e-000000000001",
  patientNumber: "P00000001",
  familyName: "Dela Cruz",
  givenName: "Juan",
  middleName: "Santos",
  suffix: "Jr.",
  sex: "intersex",
  birthDate: "1985-06-15",
  contacts: [
    { id: "c1", system: "email", value: "juan@example.com", use: "personal", isPrimary: true },
    { id: "c2", system: "mobile", value: "09171234567", use: "personal", isPrimary: false },
  ],
} as unknown as PatientDetail;

describe("toBannerPatient", () => {
  it("maps identity and never invents clinical data", () => {
    const p = toBannerPatient(detail);
    expect(p).toMatchObject({ mrn: "P00000001", familyName: "Dela Cruz", givenName: "Juan Santos Jr.", sex: "intersex", phone: "09171234567" });
    expect(p.allergies).toEqual([]);
    expect(p.medications).toEqual([]);
    expect(p.problems).toEqual([]);
  });
});

describe("allergies on the banner", () => {
  const allergy = {
    id: "a1",
    category: "medication",
    substance: "Penicillin",
    reaction: "Urticaria",
    severity: "moderate",
    criticality: "low",
    verification: "confirmed",
    recordedAt: "",
  } as const;

  it("maps the API allergy summary onto the banner", () => {
    const p = toBannerPatient(detail, { status: "has_allergies", lastReviewedAt: null, allergies: [allergy] });
    expect(p.allergies).toEqual([{ id: "a1", substance: "Penicillin", reaction: "Urticaria", severity: "moderate" }]);
  });

  it("never understates: high criticality is life-threatening, unknown severity is not mild", () => {
    expect(bannerSeverity({ severity: "mild", criticality: "high" })).toBe("life-threatening");
    expect(bannerSeverity({ severity: null, criticality: "unable_to_assess" })).toBe("moderate");
    expect(bannerSeverity({ severity: "severe", criticality: "low" })).toBe("severe");
  });

  it("leads with the most dangerous allergy", () => {
    const mild = { ...allergy, id: "m", substance: "Shellfish", severity: "mild" as const };
    const high = { ...allergy, id: "h", substance: "Penicillin", criticality: "high" as const };
    const p = toBannerPatient(detail, { status: "has_allergies", lastReviewedAt: null, allergies: [mild, high] });
    expect(p.allergies.map((a) => a.substance)).toEqual(["Penicillin", "Shellfish"]);
  });

  it("flags unconfirmed allergies in the details", () => {
    const p = toBannerPatient(detail, {
      status: "has_allergies",
      lastReviewedAt: null,
      allergies: [{ ...allergy, verification: "unconfirmed", reaction: null }],
    });
    expect(p.allergies[0]?.reaction).toBe("unconfirmed");
  });
});

describe("helpers", () => {
  it("maps API vitals, dropping missing measurements", () => {
    expect(
      toVitalSigns({
        id: "v",
        measuredAt: "2026-09-27T01:00:00Z",
        systolicMmhg: 120,
        diastolicMmhg: 80,
        heartRateBpm: null,
        respiratoryRateBpm: null,
        temperatureC: 36.8,
        spo2Percent: null,
        weightKg: null,
        heightCm: null,
      }),
    ).toEqual({
      recordedAt: "2026-09-27T01:00:00Z",
      systolic: 120,
      diastolic: 80,
      heartRate: undefined,
      respiratoryRate: undefined,
      temperatureC: 36.8,
      spo2: undefined,
      weightKg: undefined,
      heightCm: undefined,
    });
  });

  it("formats a PH address", () => {
    expect(
      formatAddress({
        id: "a",
        use: "home",
        line1: "12 Mabini St",
        barangay: "San Roque",
        cityMunicipality: "Quezon City",
        province: null,
        region: null,
        postalCode: "1100",
        country: "PH",
        psgcCode: null,
        isPrimary: true,
      }),
    ).toBe("12 Mabini St, Brgy. San Roque, Quezon City, 1100");
  });

  it("labels API enum values", () => {
    expect(label("philhealth_pin")).toBe("PhilHealth PIN");
    expect(label("legal_guardian")).toBe("Legal guardian");
    expect(label(null)).toBe("—");
  });

  it("keeps the latest decision per consent type", () => {
    const c = currentConsents([
      { consentType: "telemedicine", decision: "granted", recordedAt: "2026-01-01T00:00:00Z" },
      { consentType: "telemedicine", decision: "withdrawn", recordedAt: "2026-03-01T00:00:00Z" },
      { consentType: "data_processing", decision: "granted", recordedAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(c.map((x) => `${x.consentType}:${x.decision}`)).toEqual(["data_processing:granted", "telemedicine:withdrawn"]);
  });
});
