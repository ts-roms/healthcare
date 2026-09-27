import { describe, expect, it } from "vitest";
import type { PatientDetail } from "./api/types";
import { currentConsents, formatAddress, label, toBannerPatient } from "./patient-mapping";

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

describe("helpers", () => {
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
