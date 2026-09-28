import type { ExchangeOutcome } from "@healthcare/interoperability";
import {
  buildYakapPackage,
  isYakapReady,
  PhilHealthYakapHandler,
  type PhilHealthYakapGateway,
  UnconfiguredPhilHealthYakapGateway,
  type YakapEncounterPackage,
  type YakapEncounterSource,
  yakapReadiness,
  type YakapRegistrationSource,
} from "./yakap";

const source = (overrides: Partial<YakapEncounterSource> = {}, encounter: Partial<YakapEncounterSource["encounter"]> = {}): YakapEncounterSource => ({
  encounter: {
    id: "enc-1",
    patientId: "pat-1",
    facilityId: "fac-1",
    facilityName: "Main clinic",
    date: "2026-09-27",
    startedAt: "2026-09-27T01:00:00.000Z",
    completedAt: "2026-09-27T01:20:00.000Z",
    modality: "in_person",
    status: "completed",
    visitTypeName: "Consultation",
    clinician: { name: "Dr. Cruz", profession: "physician", licenseNumber: "0123456" },
    ...encounter,
  },
  patient: {
    id: "pat-1",
    patientNumber: "P00000001",
    familyName: "Dela Cruz",
    givenName: "Juan",
    middleName: null,
    suffix: null,
    sex: "male",
    birthDate: "1980-03-04",
    philhealthPin: "12-345678901-2",
  },
  diagnoses: [
    { codeSystemKey: "icd-10", code: "I10", display: "Essential hypertension", rank: "secondary", certainty: "confirmed", status: "active" },
    { codeSystemKey: "ICD-10", code: "E11.9", display: "Type 2 diabetes mellitus", rank: "primary", certainty: "confirmed", status: "active" },
    { codeSystemKey: "icd-10", code: "J06.9", display: "Upper respiratory infection", rank: "secondary", certainty: "provisional", status: "entered_in_error" },
    { codeSystemKey: "icd-10", code: "A09", display: "Gastroenteritis", rank: "secondary", certainty: "refuted", status: "active" },
    { codeSystemKey: null, code: null, display: "Fatigue", rank: "secondary", certainty: "provisional", status: "active" },
  ],
  prescriptions: [
    {
      prescriptionNumber: "RX-2",
      status: "active",
      issuedAt: "2026-09-27T01:15:00.000Z",
      items: [{ genericName: "Metformin", brandName: null, strength: "500 mg", dosageForm: "tablet", quantity: 60, quantityUnit: "tablets" }],
    },
    { prescriptionNumber: "RX-1", status: "superseded", issuedAt: "2026-09-27T01:10:00.000Z", items: [] },
    { prescriptionNumber: "RX-3", status: "cancelled", issuedAt: "2026-09-27T01:16:00.000Z", items: [] },
  ],
  labOrders: [
    {
      orderNumber: "LAB-1",
      status: "active",
      orderedAt: "2026-09-27T01:12:00.000Z",
      tests: [
        { code: "hba1c", name: "HbA1c", loincCode: "4548-4", status: "pending_collection" },
        { code: "fbs", name: "FBS", loincCode: null, status: "cancelled" },
      ],
    },
    { orderNumber: "LAB-2", status: "cancelled", orderedAt: "2026-09-27T01:13:00.000Z", tests: [] },
  ],
  ...overrides,
});
const participation = { participationReference: "YK-0001", validFrom: "2026-01-01", validUntil: "2026-12-31" };
const registration: YakapRegistrationSource = {
  status: "registered",
  effectiveDate: "2026-02-01",
  externalReference: "REG-77",
  recordedAt: "2026-09-01T00:00:00.000Z",
};
const failing = (...args: Parameters<typeof yakapReadiness>) =>
  yakapReadiness(...args)
    .filter((c) => !c.ok)
    .map((c) => c.code);

describe("PhilHealth YAKAP (platform side only)", () => {
  it("names what the platform's own records are missing", () => {
    expect(failing(source(), participation, registration)).toEqual([]);
    expect(isYakapReady(yakapReadiness(source(), participation, registration))).toBe(true);
    expect(failing(source({}, { status: "in_progress" }), participation, registration)).toEqual(["encounter_not_signed"]);
    expect(failing(source({ patient: { ...source().patient, philhealthPin: null } }), participation, registration)).toEqual(["member_pin_missing"]);
    expect(failing(source(), null, registration)).toEqual(["participation_missing"]);
    expect(failing(source({}, { date: "2027-01-02" }), participation, registration)).toEqual(["participation_not_valid"]);
    expect(failing(source({ diagnoses: source().diagnoses.slice(2) }), participation, registration)).toEqual(["diagnosis_code_missing"]);
    expect(failing(source(), participation, null)).toEqual(["registration_missing"]);
  });

  it("does not judge PhilHealth's answer: any recorded registration answer satisfies the check", () => {
    for (const status of ["registered", "not_registered", "pending", "unknown"] as const) {
      expect(failing(source(), participation, { ...registration, status })).toEqual([]);
    }
  });

  it("builds a format-neutral package of what is in effect", () => {
    const pkg = buildYakapPackage(source(), participation, registration);
    expect(pkg).toEqual<YakapEncounterPackage>({
      model: "platform-yakap-1",
      facility: { id: "fac-1", name: "Main clinic", participationReference: "YK-0001" },
      patient: source().patient,
      registration: { status: "registered", effectiveDate: "2026-02-01", reference: "REG-77", recordedAt: "2026-09-01T00:00:00.000Z" },
      encounter: {
        id: "enc-1",
        date: "2026-09-27",
        startedAt: "2026-09-27T01:00:00.000Z",
        completedAt: "2026-09-27T01:20:00.000Z",
        modality: "in_person",
        visitType: "Consultation",
        clinician: { name: "Dr. Cruz", profession: "physician", licenseNumber: "0123456" },
      },
      diagnoses: [
        { codeSystem: "icd-10", code: "E11.9", display: "Type 2 diabetes mellitus", primary: true, certainty: "confirmed" },
        { codeSystem: "icd-10", code: "I10", display: "Essential hypertension", primary: false, certainty: "confirmed" },
      ],
      prescriptions: [
        {
          prescriptionNumber: "RX-2",
          issuedAt: "2026-09-27T01:15:00.000Z",
          items: [{ genericName: "Metformin", brandName: null, strength: "500 mg", dosageForm: "tablet", quantity: 60, quantityUnit: "tablets" }],
        },
      ],
      labOrders: [{ orderNumber: "LAB-1", orderedAt: "2026-09-27T01:12:00.000Z", tests: [{ code: "hba1c", name: "HbA1c", loincCode: "4548-4" }] }],
    });
  });

  it("keeps nothing PhilHealth-specific in the package: no benefit, capitation or eligibility fields", () => {
    const keys = Object.keys(buildYakapPackage(source(), participation, registration)).sort();
    expect(keys).toEqual(["diagnoses", "encounter", "facility", "labOrders", "model", "patient", "prescriptions", "registration"]);
  });

  it("the unconfigured gateway is a dependency and transmits nothing", async () => {
    const gateway = new UnconfiguredPhilHealthYakapGateway();
    expect(gateway.specification).toMatchObject({ system: "philhealth-yakap", status: "dependency", specificationVersion: null });
    await expect(gateway.submitEncounter()).resolves.toEqual({ outcome: "not_configured" });
  });

  it("the worker handler passes the sealed package and the idempotency key to the gateway", async () => {
    const received: Array<[YakapEncounterPackage, string]> = [];
    const gateway: PhilHealthYakapGateway = {
      specification: new UnconfiguredPhilHealthYakapGateway().specification,
      submitEncounter: (pkg, key): Promise<ExchangeOutcome> => {
        received.push([pkg, key]);
        return Promise.resolve({ outcome: "accepted", externalReference: "YK-TX-1" });
      },
    };
    const handler = new PhilHealthYakapHandler(gateway);
    expect([handler.system, handler.operation]).toEqual(["philhealth-yakap", "submit_encounter"]);
    const pkg = buildYakapPackage(source(), participation, registration);
    await expect(handler.send(pkg, "key-12345678")).resolves.toEqual({ outcome: "accepted", externalReference: "YK-TX-1" });
    expect(received).toEqual([[pkg, "key-12345678"]]);
  });
});
