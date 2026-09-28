import type { ImportedAllergy, ImportedCondition, ImportedDocument, ImportedMedication, ImportedObservation, ImportedPatient } from "./inbound-model";
import { mapInboundEntries, registrationDraft, toAllergyInput, toExternalHistory } from "./inbound-mapping";
import { FhirImportError, IMPORT_LIMITS, parseImport } from "./inbound-validation";

// The official FHIR R4 JSON schema (dev dependency), to hold the samples to the specification as well.
type Validate = ((data: unknown) => boolean) & { errors?: unknown[] | null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Validator = require("@asymmetrik/fhir-json-schema-validator") as new () => {
  ajv: { compile(schema: object): Validate };
  schema: { $schema: string; definitions: object };
};
const fhir = new Validator();
const validators = new Map<string, Validate>();
function officiallyValid(resource: { resourceType: string }): boolean {
  let validate = validators.get(resource.resourceType);
  if (!validate) {
    validate = fhir.ajv.compile({ $schema: fhir.schema.$schema, definitions: fhir.schema.definitions, $ref: `#/definitions/${resource.resourceType}` });
    validators.set(resource.resourceType, validate);
  }
  return validate(resource);
}

const PIN_SYSTEM = "https://ids.example.ph/configured/philhealth";
const ctx = { identifierSystems: { philhealth_pin: PIN_SYSTEM } };

const patient = {
  resourceType: "Patient",
  id: "p1",
  identifier: [
    { system: PIN_SYSTEM, value: "12-345678901-2" },
    { system: "https://other.example/mrn", value: "MRN-9" },
  ],
  name: [{ use: "official", family: "Dela Cruz", given: ["Juan", "Santos"] }],
  gender: "male",
  birthDate: "1980-03-04",
  telecom: [
    { system: "phone", use: "mobile", value: "0917 123 4567" },
    { system: "email", value: "juan@example.ph" },
  ],
  address: [{ line: ["12 Mabini St."], city: "Makati City", district: "Metro Manila", postalCode: "1210" }],
};
const allergy = {
  resourceType: "AllergyIntolerance",
  id: "a1",
  clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }] },
  verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", code: "confirmed" }] },
  category: ["medication"],
  criticality: "high",
  code: { coding: [{ system: "http://snomed.info/sct", code: "764146007", display: "Penicillin" }], text: "Penicillin" },
  patient: { reference: "urn:uuid:3f1d1c1e-0000-4000-8000-000000000001" },
  reaction: [{ manifestation: [{ text: "Hives" }], severity: "moderate" }],
};
const condition = {
  resourceType: "Condition",
  clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
  code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "E11.9", display: "Type 2 diabetes mellitus without complications" }] },
  subject: { reference: "Patient/p1" },
  onsetDateTime: "2019-05",
};
const observation = {
  resourceType: "Observation",
  status: "final",
  category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
  code: { coding: [{ system: "http://loinc.org", code: "4548-4", display: "Hemoglobin A1c" }] },
  subject: { reference: "Patient/p1" },
  effectiveDateTime: "2026-08-01T09:00:00+08:00",
  valueQuantity: { value: 7.2, unit: "%", system: "http://unitsofmeasure.org", code: "%" },
  interpretation: [{ text: "High" }],
  referenceRange: [{ high: { value: 5.6, unit: "%" } }],
};
const bloodPressure = {
  resourceType: "Observation",
  status: "final",
  category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
  code: { coding: [{ system: "http://loinc.org", code: "85354-9" }], text: "Blood pressure" },
  subject: { reference: "Patient/p1" },
  effectiveDateTime: "2026-08-01",
  component: [
    { code: { text: "Systolic" }, valueQuantity: { value: 130, unit: "mm[Hg]" } },
    { code: { text: "Diastolic" }, valueQuantity: { value: 85, unit: "mm[Hg]" } },
  ],
};
const medicationStatement = {
  resourceType: "MedicationStatement",
  status: "active",
  medicationCodeableConcept: { text: "Metformin 500 mg tablet" },
  subject: { reference: "Patient/p1" },
  dosage: [{ text: "1 tablet twice daily" }],
};
const medicationRequest = {
  resourceType: "MedicationRequest",
  status: "active",
  intent: "order",
  medicationCodeableConcept: { text: "Amlodipine 5 mg tablet" },
  subject: { reference: "Patient/p1" },
  authoredOn: "2026-07-01",
  dosageInstruction: [{ text: "Once daily" }],
};
const documentReference = {
  resourceType: "DocumentReference",
  status: "current",
  type: { text: "Discharge summary" },
  subject: { reference: "Patient/p1" },
  date: "2026-07-02T10:00:00+08:00",
  description: "Discharge summary, City Hospital",
  content: [{ attachment: { contentType: "application/pdf", url: "https://hospital.example/docs/1", size: 204800, title: "discharge.pdf" } }],
};
const practitioner = { resourceType: "Practitioner", id: "dr1", name: [{ family: "Reyes" }] };

const bundle = {
  resourceType: "Bundle",
  type: "collection",
  identifier: { system: "https://hospital.example/bundles", value: "b-1" },
  meta: { source: "https://hospital.example/fhir" },
  entry: [
    { fullUrl: "urn:uuid:3f1d1c1e-0000-4000-8000-000000000001", resource: patient },
    { resource: allergy },
    { resource: condition },
    { resource: observation },
    { resource: bloodPressure },
    { resource: medicationStatement },
    { resource: medicationRequest },
    { resource: documentReference },
    { resource: practitioner },
  ],
};

function errorOf(body: unknown): FhirImportError {
  try {
    parseImport(body);
  } catch (error) {
    if (error instanceof FhirImportError) return error;
    throw error;
  }
  throw new Error("expected FhirImportError");
}

describe("inbound validation", () => {
  it("accepts a collection Bundle that the official R4 schema also accepts", () => {
    expect(officiallyValid(bundle)).toBe(true);
    const parsed = parseImport(bundle);
    expect(parsed).toMatchObject({
      sourceKind: "bundle",
      bundleType: "collection",
      bundleIdentifier: { system: "https://hospital.example/bundles", value: "b-1" },
      declaredSource: "https://hospital.example/fhir",
    });
    expect(parsed.entries.map((e) => e.resourceType)).toEqual([
      "Patient",
      "AllergyIntolerance",
      "Condition",
      "Observation",
      "Observation",
      "MedicationStatement",
      "MedicationRequest",
      "DocumentReference",
      "Practitioner",
    ]);
  });

  it("accepts a single supported resource", () => {
    const parsed = parseImport(allergy);
    expect(parsed).toMatchObject({ sourceKind: "resource", bundleType: null, bundleIdentifier: null });
    expect(parsed.entries).toHaveLength(1);
  });

  const invalid = (resource: object, expression: string) => {
    const body = { resourceType: "Bundle", type: "collection", entry: [{ resource: JSON.parse(JSON.stringify(resource)) }] };
    const error = errorOf(body);
    expect(error.status).toBe(400);
    expect(error.issues.map((i) => i.expression)).toContain(expression);
  };

  it.each([
    ["an Observation without code", { ...observation, code: undefined }, "Bundle.entry[0].resource.code"],
    ["an unknown Observation status", { ...observation, status: "done" }, "Bundle.entry[0].resource.status"],
    ["an AllergyIntolerance without patient", { ...allergy, patient: undefined }, "Bundle.entry[0].resource.patient"],
    ["a malformed date", { ...condition, onsetDateTime: "04/03/2019" }, "Bundle.entry[0].resource.onsetDateTime"],
    ["an empty string", { ...medicationStatement, dosage: [{ text: "" }] }, "Bundle.entry[0].resource.dosage[0].text"],
    ["an invalid id", { ...practitioner, id: "not valid!" }, "Bundle.entry[0].resource.id"],
  ])("rejects %s — as the official schema does", (_label, resource, expression) => {
    expect(officiallyValid(JSON.parse(JSON.stringify(resource)))).toBe(false);
    invalid(resource, expression);
  });

  // R4 rules the JSON schema cannot express (required primitives, which may come as "_element"; choice-element
  // cardinality; minimum repeats) are checked as well.
  it.each([
    ["an Observation without status", { ...observation, status: undefined }, "Bundle.entry[0].resource.status"],
    ["two value[x]", { ...observation, valueString: "high" }, "Bundle.entry[0].resource.valueString"],
    ["a MedicationRequest without medication[x]", { ...medicationRequest, medicationCodeableConcept: undefined }, "Bundle.entry[0].resource.medication[x]"],
    ["a DocumentReference with no content", { ...documentReference, content: [] }, "Bundle.entry[0].resource.content"],
  ])("rejects %s (an R4 rule beyond the JSON schema)", (_label, resource, expression) => invalid(resource, expression));

  it.each(["transaction", "batch", "message", "history"])("refuses a %s Bundle as not supported", (type) => {
    const error = errorOf({ ...bundle, type });
    expect(error.status).toBe(422);
    expect(error.issues[0]).toMatchObject({ code: "not-supported", expression: "Bundle.type" });
  });

  it("refuses non-resources, empty Bundles, several patients and oversized imports", () => {
    expect(errorOf([allergy]).status).toBe(400);
    expect(errorOf({ foo: 1 }).status).toBe(400);
    expect(errorOf({ resourceType: "Bundle", type: "collection" }).issues[0]!.code).toBe("required");
    expect(errorOf({ resourceType: "Bundle", type: "collection", entry: [{ resource: patient }, { resource: { ...patient, id: "p2" } }] }).status).toBe(422);
    const many = {
      resourceType: "Bundle",
      type: "collection",
      entry: Array.from({ length: IMPORT_LIMITS.maxEntries + 1 }, () => ({ resource: practitioner })),
    };
    expect(errorOf(many)).toMatchObject({ status: 413 });
    const large = { ...medicationStatement, note: [{ text: "x".repeat(IMPORT_LIMITS.maxBytes) }] };
    expect(errorOf(large).issues[0]!.code).toBe("too-costly");
  });

  it("does not interpret (or validate) resource types it does not import beyond their type and id", () => {
    const odd = { resourceType: "Immunization", id: "i1", whatever: { nested: true } };
    expect(parseImport(odd).entries[0]!.resourceType).toBe("Immunization");
  });
});

describe("inbound mapping", () => {
  const items = mapInboundEntries(ctx, parseImport(bundle));
  const [p, a, c, o, bp, ms, mr, d, other] = items as [
    ImportedPatient,
    ImportedAllergy,
    ImportedCondition,
    ImportedObservation,
    ImportedObservation,
    ImportedMedication,
    ImportedMedication,
    ImportedDocument,
    { kind: string; acceptable: boolean },
  ];

  it("reads the Patient, recognising only configured identifier systems", () => {
    expect(p).toMatchObject({ kind: "patient", familyName: "Dela Cruz", givenNames: ["Juan", "Santos"], sex: "male", birthDate: "1980-03-04" });
    expect(p.identifiers).toEqual([
      { system: PIN_SYSTEM, value: "12-345678901-2", type: "philhealth_pin" },
      { system: "https://other.example/mrn", value: "MRN-9", type: null },
    ]);
    expect(mapInboundEntries({}, parseImport(patient))[0]).toMatchObject({ identifiers: [{ type: null }, { type: null }] });
  });

  it("drafts a registration from the Patient and refuses one without the required demographics", () => {
    expect(registrationDraft(p)).toEqual({
      familyName: "Dela Cruz",
      givenName: "Juan Santos",
      sex: "male",
      birthDate: "1980-03-04",
      contacts: [
        { system: "mobile", value: "0917 123 4567" },
        { system: "email", value: "juan@example.ph" },
      ],
      addresses: [{ line1: "12 Mabini St.", cityMunicipality: "Makati City", province: "Metro Manila", postalCode: "1210" }],
      identifiers: [{ type: "philhealth_pin", value: "12-345678901-2" }],
    });
    const partial = mapInboundEntries(ctx, parseImport({ ...patient, birthDate: "1980" }))[0] as ImportedPatient;
    expect(registrationDraft(partial)).toBeUndefined();
    expect(partial.notes.join(" ")).toContain("missing");
    const other = mapInboundEntries(ctx, parseImport({ ...patient, gender: "other" }))[0] as ImportedPatient;
    expect(other.sex).toBeNull();
  });

  it("maps an AllergyIntolerance of the import's patient to an unconfirmed clinic allergy", () => {
    expect(a).toMatchObject({
      kind: "allergy",
      acceptable: true,
      subject: "import_patient",
      substance: "Penicillin",
      category: "medication",
      criticality: "high",
      severity: "moderate",
      reaction: "Hives",
    });
    expect(toAllergyInput(a)).toEqual({ category: "medication", substance: "Penicillin", reaction: "Hives", severity: "moderate", criticality: "high" });
  });

  it("does not accept allergies that are refuted, resolved, 'no known allergy' or about another patient", () => {
    const map = (r: object) => mapInboundEntries(ctx, { entries: [{ index: 0, fullUrl: null, resourceType: "AllergyIntolerance", resource: r as never }] })[0]!;
    const verification = (code: string) => ({ coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", code }] });
    expect(map({ ...allergy, verificationStatus: verification("refuted") }).acceptable).toBe(false);
    expect(map({ ...allergy, verificationStatus: verification("entered-in-error") }).acceptable).toBe(false);
    expect(map({ ...allergy, clinicalStatus: { coding: [{ code: "resolved" }] } }).acceptable).toBe(false);
    expect(map({ ...allergy, code: { coding: [{ system: "http://snomed.info/sct", code: "716186003", display: "No known allergy" }] } }).acceptable).toBe(
      false,
    );
    expect(map({ ...allergy, code: undefined }).acceptable).toBe(false);
    // Another patient: a bundle whose Patient is p1 and an allergy about Patient/p2.
    const items2 = mapInboundEntries(
      ctx,
      parseImport({ ...bundle, entry: [{ resource: patient }, { resource: { ...allergy, patient: { reference: "Patient/p2" } } }] }),
    );
    expect(items2[1]).toMatchObject({ subject: "other_patient", acceptable: false });
    // No Patient in the import: acceptable, with a warning to check the match.
    expect(map(allergy)).toMatchObject({ subject: "not_stated", acceptable: true });
  });

  it("maps a Condition to external history", () => {
    expect(c).toMatchObject({
      kind: "condition",
      acceptable: true,
      display: "Type 2 diabetes mellitus without complications",
      clinicalStatus: "active",
      onset: "2019-05",
    });
    expect(toExternalHistory(c)).toEqual({
      kind: "condition",
      category: null,
      display: "Type 2 diabetes mellitus without complications",
      codeSystem: "http://hl7.org/fhir/sid/icd-10",
      code: "E11.9",
      valueText: null,
      statusText: "active",
      effectiveText: "2019-05",
    });
  });

  it("maps laboratory and vital-sign Observations to external history, never to results or vitals", () => {
    expect(o).toMatchObject({ category: "laboratory", display: "Hemoglobin A1c", value: "7.2 %", interpretation: "High", referenceRange: "… – 5.6 %" });
    expect(toExternalHistory(o)).toMatchObject({
      kind: "observation",
      category: "laboratory",
      code: "4548-4",
      valueText: "7.2 % (High) ref. … – 5.6 %",
      statusText: "final",
    });
    expect(bp).toMatchObject({ category: "vital-signs", value: "Systolic 130 mm[Hg]; Diastolic 85 mm[Hg]" });
    const inError = mapInboundEntries(ctx, parseImport({ ...observation, status: "entered-in-error" }))[0]!;
    expect(inError.acceptable).toBe(false);
  });

  it("maps medications to external medication history (a MedicationRequest is not a prescription here)", () => {
    expect(toExternalHistory(ms)).toMatchObject({
      kind: "medication",
      category: "reported",
      display: "Metformin 500 mg tablet",
      valueText: "1 tablet twice daily",
    });
    expect(toExternalHistory(mr)).toMatchObject({
      kind: "medication",
      category: "prescribed_elsewhere",
      display: "Amlodipine 5 mg tablet",
      effectiveText: "2026-07-01",
    });
    expect(mr.notes.join(" ")).toContain("not as a prescription");
  });

  it("keeps only DocumentReference metadata", () => {
    expect(d.attachments).toEqual([
      { contentType: "application/pdf", title: "discharge.pdf", size: 204800, inline: false, url: "https://hospital.example/docs/1" },
    ]);
    expect(toExternalHistory(d)).toMatchObject({
      kind: "document",
      category: "Discharge summary",
      display: "Discharge summary, City Hospital",
      valueText: "discharge.pdf, application/pdf, 200 KB (file not imported)",
    });
  });

  it("keeps other resource types as not supported", () => {
    expect(other).toMatchObject({ kind: "not_supported", acceptable: false });
  });
});
