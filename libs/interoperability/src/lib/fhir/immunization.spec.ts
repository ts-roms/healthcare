import type { Bundle, CapabilityStatement, FhirResource, Immunization } from "fhir/r4";
import { capabilityStatement, patientEverything, searchByPatient } from "./bundle";
import { occurrenceDateTime, toImmunization } from "./immunization";
import { PAGE_SIZE } from "./search";
import type { FhirContext, ImmunizationSource, PatientRecordSource } from "./sources";

type Validate = ((data: unknown) => boolean) & { errors?: unknown[] | null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Validator = require("@asymmetrik/fhir-json-schema-validator") as new () => {
  ajv: { compile(schema: object): Validate };
  schema: { $schema: string; definitions: object };
};
const fhir = new Validator();
const validators = new Map<string, Validate>();

function errors(resource: { resourceType: string }): unknown[] {
  let validate = validators.get(resource.resourceType);
  if (!validate) {
    validate = fhir.ajv.compile({ $schema: fhir.schema.$schema, definitions: fhir.schema.definitions, $ref: `#/definitions/${resource.resourceType}` });
    validators.set(resource.resourceType, validate);
  }
  return validate(resource) ? [] : (validate.errors ?? []);
}

const ctx: FhirContext = {
  baseUrl: "https://api.example.ph/api/v1/fhir/r4",
  identifierBase: "https://ids.example.ph/demo",
  organization: { id: "0b9f0f6e-0000-4000-8000-000000000001", code: "demo", name: "Demo Health" },
  codeSystems: { "licensed-set": "https://codes.example.org/vaccines" },
};
const P = "9e121d11-9636-4505-836b-66d13ba58f5e";
const FAC = "ecd2e1c3-74a3-41dd-b5c0-63a2f0499422";
const NURSE = "3499fee7-72e1-45e3-b25f-18a73144e638";
const ENC = "11111111-1111-4111-8111-111111111111";

const given: ImmunizationSource = {
  id: "a1000000-0000-4000-8000-000000000001",
  source: "administered_here",
  status: "completed",
  notDoneReason: null,
  notDoneReasonText: null,
  vaccineName: "Influenza vaccine",
  vaccineCodeSystem: "vaccine",
  vaccineCode: "FLU-Q",
  vaccineManufacturer: "Example Biologics",
  doseLabel: null,
  doseNumber: 1,
  occurrenceDate: "2026-09-29",
  occurrencePrecision: "time",
  occurredAt: "2026-09-29T01:30:00.000Z",
  facilityId: FAC,
  encounterId: ENC,
  performerPractitionerId: NURSE,
  performerName: "Nurse Reyes",
  lotNumber: "FL2026A",
  expiryDate: "2027-06-30",
  route: "Intramuscular",
  site: "Left deltoid",
  doseQuantity: 0.5,
  doseUnit: "mL",
  sourceDescription: null,
  declaredSource: null,
  adverseReaction: "Soreness at the site",
  adverseReactionRecordedAt: "2026-09-29T02:00:00.000Z",
  recordedAt: "2026-09-29T01:31:00.000Z",
  enteredInErrorAt: null,
};

const reported: ImmunizationSource = {
  ...given,
  id: "a1000000-0000-4000-8000-000000000002",
  source: "historical",
  vaccineName: "Measles-containing vaccine",
  vaccineCodeSystem: null,
  vaccineCode: null,
  vaccineManufacturer: null,
  doseNumber: null,
  doseLabel: "Booster",
  occurrenceDate: "2019-01-01",
  occurrencePrecision: "year",
  occurredAt: null,
  facilityId: null,
  encounterId: null,
  performerPractitionerId: null,
  performerName: "Barangay health station",
  lotNumber: null,
  expiryDate: null,
  route: null,
  site: null,
  doseQuantity: null,
  doseUnit: null,
  sourceDescription: "Vaccination card",
  adverseReaction: null,
  adverseReactionRecordedAt: null,
};

const notGiven: ImmunizationSource = {
  ...given,
  id: "a1000000-0000-4000-8000-000000000003",
  status: "not_done",
  notDoneReason: "refused",
  notDoneReasonText: "Parent prefers to wait",
  lotNumber: null,
  expiryDate: null,
  route: null,
  site: null,
  doseQuantity: null,
  doseUnit: null,
  adverseReaction: null,
  adverseReactionRecordedAt: null,
  performerPractitionerId: null,
};

const imported: ImmunizationSource = {
  ...reported,
  id: "a1000000-0000-4000-8000-000000000004",
  source: "external_import",
  vaccineCodeSystem: "http://example.org/their-codes",
  vaccineCode: "X1",
  occurrenceDate: "2021-05-01",
  occurrencePrecision: "month",
  sourceDescription: "Recorded by the sender",
  declaredSource: "https://ehr.example.org",
  enteredInErrorAt: "2026-09-30T00:00:00.000Z",
};

describe("FHIR R4 Immunization", () => {
  it("maps a dose given here with its lot, route, site, performer, encounter and reaction", () => {
    const r = toImmunization(ctx, P, given);
    expect(errors(r)).toEqual([]);
    expect(r).toMatchObject({
      status: "completed",
      primarySource: true,
      occurrenceDateTime: "2026-09-29T01:30:00.000Z",
      vaccineCode: {
        coding: [{ system: "https://ids.example.ph/demo/codesystem/vaccine", code: "FLU-Q", display: "Influenza vaccine" }],
        text: "Influenza vaccine",
      },
      lotNumber: "FL2026A",
      expirationDate: "2027-06-30",
      site: { text: "Left deltoid" },
      route: { text: "Intramuscular" },
      doseQuantity: { value: 0.5, unit: "mL" },
      performer: [{ actor: { reference: `Practitioner/${NURSE}` } }],
      encounter: { reference: `Encounter/${ENC}` },
      location: { reference: `Location/${FAC}` },
      manufacturer: { display: "Example Biologics" },
      protocolApplied: [{ doseNumberString: "1" }],
      reaction: [{ date: "2026-09-29T02:00:00.000Z", detail: { display: "Soreness at the site" } }],
    });
    // Reliable last-updated time: the reaction added after recording.
    expect(r.meta?.lastUpdated).toBe("2026-09-29T02:00:00.000Z");
    expect(r.reportOrigin).toBeUndefined();
  });

  it("uses a configured code system for the catalogue's key", () => {
    const r = toImmunization(ctx, P, { ...given, vaccineCodeSystem: "licensed-set" });
    expect(r.vaccineCode.coding?.[0]?.system).toBe("https://codes.example.org/vaccines");
  });

  it("maps a reported dose with a partial date, not a primary source, reportOrigin as text", () => {
    const r = toImmunization(ctx, P, reported);
    expect(errors(r)).toEqual([]);
    expect(r).toMatchObject({
      status: "completed",
      primarySource: false,
      occurrenceDateTime: "2019",
      reportOrigin: { text: "Vaccination card" },
      vaccineCode: { text: "Measles-containing vaccine" },
      performer: [{ actor: { display: "Barangay health station" } }],
      protocolApplied: [{ doseNumberString: "Booster" }],
    });
    expect(r.vaccineCode.coding).toBeUndefined();
  });

  it("maps a dose not given with the reason (HL7 ActReason) and the clinician's words", () => {
    const r = toImmunization(ctx, P, notGiven);
    expect(errors(r)).toEqual([]);
    expect(r.status).toBe("not-done");
    expect(r.statusReason).toEqual({
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ActReason", code: "PATOBJ", display: "patient objection" }],
      text: "Parent prefers to wait",
    });
    const other = toImmunization(ctx, P, { ...notGiven, notDoneReason: "other", notDoneReasonText: "Febrile today" });
    expect(other.statusReason).toEqual({ text: "Febrile today" });
    expect(errors(other)).toEqual([]);
  });

  it("tags an imported dose, keeps the sender's code system, and marks an entry in error", () => {
    const r = toImmunization(ctx, P, imported);
    expect(errors(r)).toEqual([]);
    expect(r.status).toBe("entered-in-error");
    expect(r.occurrenceDateTime).toBe("2021-05");
    expect(r.meta?.tag?.[0]?.code).toBe("external-import");
    expect(r.meta?.source).toBe("https://ehr.example.org");
    expect(r.vaccineCode.coding?.[0]).toMatchObject({ system: "http://example.org/their-codes", code: "X1" });
    expect(r.meta?.lastUpdated).toBe("2026-09-30T00:00:00.000Z");
  });

  it("writes each precision as an R4 dateTime", () => {
    expect(occurrenceDateTime({ occurrenceDate: "2019-01-01", occurrencePrecision: "year", occurredAt: null })).toBe("2019");
    expect(occurrenceDateTime({ occurrenceDate: "2019-05-01", occurrencePrecision: "month", occurredAt: null })).toBe("2019-05");
    expect(occurrenceDateTime({ occurrenceDate: "2019-05-12", occurrencePrecision: "day", occurredAt: null })).toBe("2019-05-12");
  });

  it("is served by $everything, Immunization?patient= (with _lastUpdated) and declared in the CapabilityStatement", () => {
    const record: PatientRecordSource = {
      patient: {
        id: P,
        patientNumber: "P00000001",
        familyName: "Dela Cruz",
        givenName: "Juan",
        middleName: null,
        suffix: null,
        sex: "male",
        birthDate: "1980-03-04",
        civilStatus: null,
        status: "active",
        deceasedAt: null,
        mergedIntoPatientId: null,
        updatedAt: "2026-09-01T00:00:00.000Z",
        identifiers: [],
        contacts: [],
        addresses: [],
        emergencyContacts: [],
      },
      facilities: [
        {
          id: FAC,
          code: "main",
          name: "Main clinic",
          facilityType: "clinic",
          addressLine: null,
          barangay: null,
          cityMunicipality: "Quezon City",
          province: null,
          region: null,
          postalCode: null,
          contactNumber: null,
          email: null,
          licenseNumber: null,
          status: "active",
        },
      ],
      practitioners: [{ id: NURSE, displayName: "Nurse Reyes", profession: "nurse", specialty: null, licenseNumber: null, status: "active" }],
      encounters: [
        {
          id: ENC,
          facilityId: FAC,
          practitionerId: NURSE,
          modality: "in_person",
          status: "in_progress",
          visitTypeName: null,
          chiefComplaint: null,
          startedAt: "2026-09-29T01:00:00.000Z",
          completedAt: null,
          appointmentId: null,
        },
      ],
      diagnoses: [],
      allergies: [],
      allergyReview: null,
      vitals: [],
      appointments: [],
      labOrders: [],
      prescriptions: [],
      carePlans: [],
      documents: [],
      externalHistory: [],
      dental: null,
      referrals: [],
      immunizations: [given, reported, notGiven, imported],
      history: { procedures: [], conditions: [], medications: [], family: [], familyReview: null, social: [], sensitiveIncluded: true },
    };
    const everything: Bundle = patientEverything(ctx, record, { count: PAGE_SIZE.max, offset: 0 });
    const resources = (everything.entry ?? []).map((e) => e.resource as FhirResource);
    expect(resources.filter((r) => r.resourceType === "Immunization")).toHaveLength(4);
    for (const r of resources) expect({ type: r.resourceType, errors: errors(r) }).toEqual({ type: r.resourceType, errors: [] });
    // Every reference resolves inside the bundle (Practitioner, Location, Encounter, Patient).
    const present = new Set(resources.map((r) => `${r.resourceType}/${r.id}`));
    for (const i of resources.filter((r): r is Immunization => r.resourceType === "Immunization")) {
      for (const reference of [i.patient.reference, i.encounter?.reference, i.location?.reference, ...(i.performer ?? []).map((p) => p.actor.reference)]) {
        if (reference) expect(present.has(reference)).toBe(true);
      }
    }
    const search = searchByPatient(ctx, record, "Immunization", { paging: { count: 50, offset: 0 }, lastUpdated: { ge: "2026-09-30" } });
    expect(search.total).toBe(1);
    const statement: CapabilityStatement = capabilityStatement(ctx);
    const declared = statement.rest?.[0]?.resource?.find((r) => r.type === "Immunization");
    expect(declared?.searchParam?.map((p) => p.name)).toEqual(["patient", "_lastUpdated"]);
  });
});
