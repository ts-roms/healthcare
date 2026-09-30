import type { Bundle, CapabilityStatement, Condition, FamilyMemberHistory, FhirResource, MedicationStatement, Observation, Procedure } from "fhir/r4";
import { capabilityStatement, patientEverything, searchByPatient } from "./bundle";
import {
  historyResources,
  partialDateTime,
  toFamilyMemberHistory,
  toPastCondition,
  toPastProcedure,
  toReportedMedication,
  toSocialHistoryObservations,
} from "./history";
import { PAGE_SIZE } from "./search";
import type {
  FamilyHistorySource,
  FhirContext,
  PastConditionSource,
  PastProcedureSource,
  PatientRecordSource,
  ReportedMedicationSource,
  SocialHistorySource,
} from "./sources";

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
};
const P = "9e121d11-9636-4505-836b-66d13ba58f5e";
const DOC = "3499fee7-72e1-45e3-b25f-18a73144e638";

const procedure: PastProcedureSource = {
  id: "b1000000-0000-4000-8000-000000000001",
  source: "reported",
  reportedBy: "patient",
  description: "Appendectomy",
  codeSystem: "procedure",
  code: "APP-01",
  performedDate: "2010-01-01",
  performedPrecision: "year",
  performer: "Philippine General Hospital",
  bodySite: null,
  sourceDescription: null,
  declaredSource: null,
  recorderPractitionerId: DOC,
  recordedAt: "2026-09-29T01:00:00.000Z",
  enteredInErrorAt: null,
};
const medication: ReportedMedicationSource = {
  id: "b3000000-0000-4000-8000-000000000001",
  source: "reported",
  reportedBy: "patient",
  medication: "Losartan 50 mg tablet",
  codeSystem: null,
  code: null,
  dose: "1 tablet every morning",
  reason: "High blood pressure",
  prescribedBy: "Cardiologist at another hospital",
  startedDate: "2019-05-01",
  startedPrecision: "month",
  status: "taking",
  stoppedDate: null,
  stoppedPrecision: null,
  sourceDescription: null,
  recorderPractitionerId: DOC,
  recordedAt: "2026-09-29T01:00:00.000Z",
  stopRecordedAt: null,
  enteredInErrorAt: null,
};

const imported: PastProcedureSource = {
  ...procedure,
  id: "b1000000-0000-4000-8000-000000000002",
  source: "external_import",
  reportedBy: null,
  codeSystem: "http://snomed.info/sct",
  code: "80146002",
  performedDate: null,
  performedPrecision: null,
  declaredSource: "https://hospital.example.org/fhir",
  recorderPractitionerId: null,
};
const condition: PastConditionSource = {
  id: "b2000000-0000-4000-8000-000000000001",
  source: "reported",
  reportedBy: "relative",
  description: "Pulmonary tuberculosis",
  codeSystem: null,
  code: null,
  onsetDate: "2015-03-01",
  onsetPrecision: "month",
  reportedStatus: "resolved",
  diagnosedBy: "Rural health unit",
  sourceDescription: null,
  recorderPractitionerId: DOC,
  recordedAt: "2026-09-29T01:05:00.000Z",
  enteredInErrorAt: null,
};
const family: FamilyHistorySource = {
  id: "b3000000-0000-4000-8000-000000000001",
  source: "reported",
  relationship: "father",
  relationshipText: null,
  condition: "Type 2 diabetes",
  codeSystem: null,
  code: null,
  onsetAge: 45,
  deceased: true,
  causeOfDeath: "Stroke",
  declaredSource: null,
  recordedAt: "2026-09-29T01:10:00.000Z",
  enteredInErrorAt: null,
};
const social: SocialHistorySource = {
  id: "b4000000-0000-4000-8000-000000000001",
  effectiveDate: "2026-09-29",
  tobaccoStatus: "former",
  tobaccoType: "Cigarettes",
  tobaccoAmount: null,
  tobaccoQuitYear: 2015,
  alcoholStatus: "current",
  alcoholFrequency: "Weekends",
  substanceUse: "Cannabis, stopped 2018",
  occupation: "Jeepney driver",
  occupationalExposures: null,
  livingSituation: null,
  physicalActivity: null,
  diet: null,
  sexualHistory: "Declined to discuss",
  recordedAt: "2026-09-29T01:15:00.000Z",
  enteredInErrorAt: null,
};

describe("patient history as FHIR R4", () => {
  it("exports a reported past procedure at its precision, with who told and who recorded it, tagged reported", () => {
    const r: Procedure = toPastProcedure(ctx, P, procedure);
    expect(errors(r)).toEqual([]);
    expect(r).toMatchObject({
      status: "completed",
      performedDateTime: "2010",
      asserter: { reference: `Patient/${P}` },
      recorder: { reference: `Practitioner/${DOC}` },
      performer: [{ actor: { display: "Philippine General Hospital" } }],
      code: { coding: [{ system: "https://ids.example.ph/demo/codesystem/procedure", code: "APP-01" }] },
    });
    expect(r.meta?.tag?.[0]).toMatchObject({ code: "reported" });
    expect(r.category?.coding?.[0]?.code).toBe("past-procedure");
  });

  it("keeps an imported procedure's code system as received and tags it external-import", () => {
    const r = toPastProcedure(ctx, P, imported);
    expect(errors(r)).toEqual([]);
    expect(r.code?.coding?.[0]).toMatchObject({ system: "http://snomed.info/sct", code: "80146002" });
    expect(r.performedDateTime).toBeUndefined();
    expect(r.meta?.tag?.[0]?.code).toBe("external-import");
    expect(r.meta?.source).toBe("https://hospital.example.org/fhir");
  });

  it("exports a past condition as unconfirmed past medical history, never the problem list", () => {
    const r: Condition = toPastCondition(ctx, P, condition);
    expect(errors(r)).toEqual([]);
    expect(r.verificationStatus?.coding?.[0]?.code).toBe("unconfirmed");
    expect(r.clinicalStatus?.coding?.[0]?.code).toBe("resolved");
    expect(r.onsetDateTime).toBe("2015-03");
    expect(r.category?.[0]?.coding?.[0]?.code).toBe("past-medical-history");
    expect(JSON.stringify(r)).not.toContain("problem-list-item");
    expect(r.asserter).toEqual({ display: "A relative of the patient" });
    const unknown = toPastCondition(ctx, P, { ...condition, reportedStatus: "unknown" });
    expect(unknown.clinicalStatus).toBeUndefined();
    const inError = toPastCondition(ctx, P, { ...condition, enteredInErrorAt: "2026-09-30T00:00:00.000Z" });
    expect(inError.clinicalStatus).toBeUndefined();
    expect(inError.verificationStatus?.coding?.[0]?.code).toBe("entered-in-error");
    expect(inError.meta?.lastUpdated).toBe("2026-09-30T00:00:00.000Z");
    expect(errors(inError)).toEqual([]);
  });

  it("exports a relative's condition with the v3 RoleCode relationship, age at onset and cause of death", () => {
    const r: FamilyMemberHistory = toFamilyMemberHistory(ctx, P, family);
    expect(errors(r)).toEqual([]);
    expect(r.relationship.coding?.[0]).toMatchObject({ system: "http://terminology.hl7.org/CodeSystem/v3-RoleCode", code: "FTH" });
    expect(r.deceasedBoolean).toBe(true);
    expect(r.condition).toEqual([
      { code: { text: "Type 2 diabetes" }, onsetAge: { value: 45, unit: "years", system: "http://unitsofmeasure.org", code: "a" } },
      { code: { text: "Stroke" }, contributedToDeath: true },
    ]);
    const other = toFamilyMemberHistory(ctx, P, { ...family, relationship: "other", relationshipText: "Godmother", deceased: null, causeOfDeath: null });
    expect(other.relationship).toMatchObject({ coding: [{ code: "FAMMEMB" }], text: "Godmother" });
    expect(other.deceasedBoolean).toBeUndefined();
    expect(errors(other)).toEqual([]);
  });

  it("exports each part of a social history version as a social-history Observation; sensitive parts only when included", () => {
    const all = toSocialHistoryObservations(ctx, P, social, true);
    for (const o of all) expect(errors(o)).toEqual([]);
    expect(all.map((o) => o.code.coding?.[0]?.code)).toEqual(["tobacco", "alcohol", "substance-use", "occupation", "sexual-history"]);
    const tobacco = all[0] as Observation;
    expect(tobacco).toMatchObject({
      status: "final",
      effectiveDateTime: "2026-09-29",
      category: [{ coding: [{ code: "social-history" }] }],
      valueCodeableConcept: { coding: [{ code: "former" }], text: "Former — Cigarettes, quit 2015" },
    });
    const withheld = toSocialHistoryObservations(ctx, P, social, false);
    expect(withheld.map((o) => o.code.coding?.[0]?.code)).toEqual(["tobacco", "alcohol", "occupation"]);
    expect(JSON.stringify(withheld)).not.toContain("Cannabis");
  });

  it("gives partial dates at their precision", () => {
    expect(partialDateTime("2019-01-01", "year")).toBe("2019");
    expect(partialDateTime("2019-05-01", "month")).toBe("2019-05");
    expect(partialDateTime("2019-05-12", "day")).toBe("2019-05-12");
    expect(partialDateTime(null, null)).toBeUndefined();
  });

  const record = (sensitiveIncluded: boolean): PatientRecordSource => ({
    patient: {
      id: P,
      patientNumber: "P-000001",
      familyName: "Santos",
      givenName: "Maria",
      middleName: null,
      suffix: null,
      sex: "female",
      birthDate: "1980-01-01",
      civilStatus: null,
      status: "active",
      deceasedAt: null,
      mergedIntoPatientId: null,
      mergedRecordIds: [],
      updatedAt: "2026-09-29T00:00:00.000Z",
      identifiers: [],
      contacts: [],
      addresses: [],
      emergencyContacts: [],
    },
    facilities: [],
    practitioners: [{ id: DOC, displayName: "Dr. Cruz", profession: "physician", licenseNumber: null, specialty: null, status: "active" }],
    encounters: [],
    diagnoses: [],
    allergies: [],
    allergyReview: null,
    vitals: [],
    appointments: [],
    labOrders: [],
    prescriptions: [],
    carePlans: [],
    referrals: [],
    documents: [],
    externalHistory: [],
    dental: null,
    immunizations: [],
    clinicProcedures: [],
    history: {
      procedures: [procedure, imported],
      conditions: [condition],
      medications: [medication],
      family: [family],
      familyReview: null,
      social: [social],
      sensitiveIncluded,
    },
  });

  it("includes the history in $everything and searches, schema-valid, with a notice when sensitive parts are withheld", () => {
    const everything: Bundle = patientEverything(ctx, record(false), { count: PAGE_SIZE.max, offset: 0 });
    expect(errors(everything)).toEqual([]);
    const types = (everything.entry ?? []).filter((e) => e.search?.mode === "match").map((e) => (e.resource as FhirResource).resourceType);
    expect(types).toEqual(expect.arrayContaining(["Procedure", "Condition", "MedicationStatement", "FamilyMemberHistory", "Observation"]));
    const notices = (everything.entry ?? []).filter((e) => e.search?.mode === "outcome").map((e) => JSON.stringify(e.resource));
    expect(notices.some((n) => n.includes("Substance use and sexual history"))).toBe(true);

    const observations = searchByPatient(ctx, record(false), "Observation");
    expect(observations.total).toBe(3);
    expect((observations.entry ?? []).some((e) => e.search?.mode === "outcome" && JSON.stringify(e.resource).includes("Substance use"))).toBe(true);
    const included = searchByPatient(ctx, record(true), "Observation");
    expect(included.total).toBe(5);
    expect((included.entry ?? []).filter((e) => e.search?.mode === "outcome")).toEqual([
      expect.objectContaining({ resource: expect.objectContaining({ issue: [expect.objectContaining({ diagnostics: expect.stringContaining("dental") })] }) }),
    ]);
    const families = searchByPatient(ctx, record(true), "FamilyMemberHistory", { paging: { count: 50, offset: 0 }, lastUpdated: { ge: "2026-09-29" } });
    expect(families.total).toBe(1);
    expect(historyResources(ctx, P, record(true).history)).toHaveLength(2 + 1 + 1 + 1 + 5);
  });

  it("declares FamilyMemberHistory (with _lastUpdated) in the CapabilityStatement", () => {
    const capability: CapabilityStatement = capabilityStatement(ctx);
    const family = capability.rest?.[0]?.resource?.find((r) => r.type === "FamilyMemberHistory");
    expect(family?.searchParam?.map((p) => p.name)).toEqual(["patient", "_lastUpdated"]);
  });
});

describe("medications taken as MedicationStatement", () => {
  it("is active while taken, never a prescription, schema-valid", () => {
    const m: MedicationStatement = toReportedMedication(ctx, P, medication);
    expect(errors(m)).toEqual([]);
    expect(m).toMatchObject({
      status: "active",
      medicationCodeableConcept: { text: "Losartan 50 mg tablet" },
      effectivePeriod: { start: "2019-05" },
      dateAsserted: "2026-09-29T01:00:00.000Z",
      informationSource: { reference: `Patient/${P}` },
      reasonCode: [{ text: "High blood pressure" }],
      dosage: [{ text: "1 tablet every morning" }],
    });
    expect(m.category?.coding?.[0]?.code).toBe("medication-taken");
    expect(m.meta?.tag?.[0]?.code).toBe("reported");
    expect(JSON.stringify(m.note)).toContain("not a prescription of this organization");
  });

  it("is stopped once marked stopped, with the stop in its period and last-updated time", () => {
    const m = toReportedMedication(ctx, P, {
      ...medication,
      status: "stopped",
      stoppedDate: "2026-01-01",
      stoppedPrecision: "year",
      stopRecordedAt: "2026-09-30T02:00:00.000Z",
    });
    expect(errors(m)).toEqual([]);
    expect(m).toMatchObject({ status: "stopped", effectivePeriod: { start: "2019-05", end: "2026" }, meta: { lastUpdated: "2026-09-30T02:00:00.000Z" } });
    const inError = toReportedMedication(ctx, P, { ...medication, enteredInErrorAt: "2026-09-30T03:00:00.000Z" });
    expect(inError).toMatchObject({ status: "entered-in-error", meta: { lastUpdated: "2026-09-30T03:00:00.000Z" } });
  });
});
