import type { Bundle, CapabilityStatement, DocumentReference, FhirResource, Observation, OperationOutcome, Patient } from "fhir/r4";
import { capabilityStatement, operationOutcome, patientEverything, searchByPatient } from "./bundle";
import { DEFAULT_PAGING, FhirSearchError, PAGE_SIZE, parseLastUpdated, parsePaging, parseSearchParameters, type SearchParameters } from "./search";
import type { FhirContext, PatientRecordSource } from "./sources";

// The official FHIR R4 (4.0) JSON schema, bundled by this validator (dev dependency). Each resource is checked against
// its own type's definition (the umbrella schema's oneOf reports every other resource type as a mismatch).
type Validate = ((data: unknown) => boolean) & { errors?: unknown[] | null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Validator = require("@asymmetrik/fhir-json-schema-validator") as new () => {
  ajv: { compile(schema: object): Validate };
  schema: { $schema: string; definitions: object };
};
const fhir = new Validator();
const validators = new Map<string, Validate>();

const ctx: FhirContext = {
  baseUrl: "https://api.example.ph/api/v1/fhir/r4",
  identifierBase: "https://ids.example.ph/demo",
  organization: { id: "0b9f0f6e-0000-4000-8000-000000000001", code: "demo", name: "Demo Health" },
  identifierSystems: { philhealth_pin: "https://ids.example.ph/demo/configured/philhealth" },
};

const P = "9e121d11-9636-4505-836b-66d13ba58f5e";
const FAC = "ecd2e1c3-74a3-41dd-b5c0-63a2f0499422";
const DR = "3499fee7-72e1-45e3-b25f-18a73144e638";
const ENC = "11111111-1111-4111-8111-111111111111";

const source: PatientRecordSource = {
  patient: {
    id: P,
    patientNumber: "P00000001",
    familyName: "Dela Cruz",
    givenName: "Juan",
    middleName: "Santos",
    suffix: "Jr.",
    sex: "male",
    birthDate: "1980-03-04",
    civilStatus: "married",
    status: "active",
    deceasedAt: null,
    mergedIntoPatientId: null,
    updatedAt: "2026-09-28T01:00:00.000Z",
    identifiers: [
      { type: "philhealth_pin", value: "12-345678901-2", issuer: "PhilHealth", validFrom: null, validUntil: null },
      { type: "senior_citizen_id", value: "OSCA-1", issuer: null, validFrom: "2025-01-01", validUntil: null },
    ],
    contacts: [
      { system: "mobile", value: "+639171234567", use: "personal", isPrimary: true },
      { system: "email", value: "juan@example.ph", use: "personal", isPrimary: false },
    ],
    addresses: [
      { use: "home", line1: "12 Mabini St.", barangay: "San Isidro", cityMunicipality: "Quezon City", province: null, region: "NCR", postalCode: "1100" },
    ],
    emergencyContacts: [{ name: "Maria Dela Cruz", relationship: "spouse", contactNumber: "+639179999999" }],
  },
  facilities: [
    {
      id: FAC,
      code: "main",
      name: "Main Clinic",
      facilityType: "clinic",
      addressLine: "1 Rizal Ave.",
      barangay: "Poblacion",
      cityMunicipality: "Makati",
      province: null,
      region: "NCR",
      postalCode: "1210",
      contactNumber: "+6328123456",
      email: null,
      licenseNumber: "LTO-0001",
      status: "active",
    },
  ],
  practitioners: [
    { id: DR, displayName: "Dr. Elena Reyes", profession: "physician", specialty: "Internal Medicine", licenseNumber: "0123456", status: "active" },
  ],
  encounters: [
    {
      id: ENC,
      facilityId: FAC,
      practitionerId: DR,
      modality: "in_person",
      status: "completed",
      visitTypeName: "Consultation",
      chiefComplaint: "Dizziness",
      startedAt: "2026-09-27T01:00:00.000Z",
      completedAt: "2026-09-27T01:30:00.000Z",
      appointmentId: "22222222-2222-4222-8222-222222222222",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      facilityId: FAC,
      practitionerId: DR,
      modality: "telemedicine",
      status: "entered_in_error",
      visitTypeName: null,
      chiefComplaint: null,
      startedAt: "2026-09-20T01:00:00.000Z",
      completedAt: null,
      appointmentId: null,
    },
  ],
  diagnoses: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      encounterId: ENC,
      codeSystemKey: "icd-10",
      codeSystemVersion: "2019",
      code: "I10",
      display: "Essential (primary) hypertension",
      rank: "primary",
      certainty: "confirmed",
      status: "active",
      isChronic: true,
      recordedAt: "2026-09-27T01:20:00.000Z",
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      encounterId: ENC,
      codeSystemKey: null,
      codeSystemVersion: null,
      code: null,
      display: "Dizziness, for evaluation",
      rank: "secondary",
      certainty: "provisional",
      status: "entered_in_error",
      isChronic: false,
      recordedAt: "2026-09-27T01:21:00.000Z",
    },
  ],
  allergies: [
    {
      id: "66666666-6666-4666-8666-666666666666",
      category: "medication",
      substance: "Penicillin",
      reaction: "Hives",
      severity: "moderate",
      criticality: "high",
      verification: "confirmed",
      status: "active",
      recordedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  allergyReview: { noKnownAllergies: false, reviewedAt: "2026-01-01T00:00:00.000Z" },
  vitals: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      encounterId: ENC,
      measuredAt: "2026-09-27T01:05:00.000Z",
      status: "final",
      systolicMmhg: 150,
      diastolicMmhg: 95,
      heartRateBpm: 88,
      respiratoryRateBpm: 18,
      temperatureC: 36.8,
      spo2Percent: 98,
      weightKg: 70,
      heightCm: 170,
    },
  ],
  appointments: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      facilityId: FAC,
      practitionerId: DR,
      practitionerName: "Dr. Elena Reyes",
      visitTypeName: "Consultation",
      modality: "in_person",
      status: "completed",
      startsAt: "2026-09-27T01:00:00.000Z",
      endsAt: "2026-09-27T01:30:00.000Z",
      reason: "BP check",
      cancellationReason: null,
    },
  ],
  labOrders: [
    {
      id: "88888888-8888-4888-8888-888888888888",
      facilityId: FAC,
      orderNumber: "LO00000001",
      status: "active",
      priority: "stat",
      orderedAt: "2026-09-27T01:25:00.000Z",
      encounterId: ENC,
      orderingPractitionerId: DR,
      clinicalIndication: "Hypertension work-up",
      items: [
        {
          id: "99999999-9999-4999-8999-999999999991",
          testCode: "fbs",
          testName: "Fasting blood sugar",
          loincCode: "1558-6",
          status: "released",
          result: {
            id: "99999999-9999-4999-8999-999999999992",
            versionNumber: 2,
            resultType: "numeric",
            valueNumeric: 6.2,
            valueText: null,
            valueCoded: null,
            unit: "mmol/L",
            flag: "high",
            refLow: 3.9,
            refHigh: 5.5,
            refText: null,
            comment: "Corrected: transcription error",
            collectedAt: "2026-09-27T02:00:00.000Z",
            releasedAt: "2026-09-27T05:00:00.000Z",
          },
        },
        {
          id: "99999999-9999-4999-8999-999999999993",
          testCode: "hbsag",
          testName: "HBsAg",
          loincCode: null,
          status: "released",
          result: {
            id: "99999999-9999-4999-8999-999999999994",
            versionNumber: 1,
            resultType: "coded",
            valueNumeric: null,
            valueText: null,
            valueCoded: "Non-reactive",
            unit: null,
            flag: "normal",
            refLow: null,
            refHigh: null,
            refText: "Non-reactive",
            comment: null,
            collectedAt: "2026-09-27T02:00:00.000Z",
            releasedAt: "2026-09-27T04:00:00.000Z",
          },
        },
        { id: "99999999-9999-4999-8999-999999999995", testCode: "lipid", testName: "Lipid profile", loincCode: null, status: "received", result: null },
      ],
    },
  ],
  prescriptions: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      prescriptionNumber: "RX00000001",
      status: "active",
      encounterId: ENC,
      prescriberPractitionerId: DR,
      issuedAt: "2026-09-27T01:28:00.000Z",
      cancelledAt: null,
      items: [
        {
          lineNumber: 1,
          genericName: "Amlodipine",
          brandName: null,
          strength: "5 mg",
          dosageForm: "tablet",
          doseAmount: 1,
          doseUnit: "tablet",
          route: "oral",
          frequency: "once_daily",
          frequencyText: null,
          asNeeded: false,
          asNeededReason: null,
          durationValue: 30,
          durationUnit: "days",
          quantity: 30,
          quantityUnit: "tablet",
          refills: 2,
          instructions: "Take in the morning",
        },
        {
          lineNumber: 2,
          genericName: "Paracetamol",
          brandName: "Biogesic",
          strength: "500 mg",
          dosageForm: "tablet",
          doseAmount: 1,
          doseUnit: "tablet",
          route: "oral",
          frequency: "every_4_hours",
          frequencyText: "every 4 hours",
          asNeeded: true,
          asNeededReason: "headache",
          durationValue: null,
          durationUnit: null,
          quantity: 10,
          quantityUnit: "tablet",
          refills: 0,
          instructions: null,
        },
      ],
    },
  ],
  carePlans: [
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      title: "Hypertension care plan",
      category: "chronic_disease",
      status: "active",
      description: null,
      startDate: "2026-09-27",
      endDate: null,
      authorPractitionerId: DR,
      createdAt: "2026-09-27T01:29:00.000Z",
      activities: [
        { id: "c1", kind: "follow_up_appointment", description: "BP follow-up", status: "planned", dueDate: "2026-10-27" },
        { id: "c2", kind: "lifestyle", description: "Reduce salt", status: "in_progress", dueDate: null },
      ],
    },
  ],
  documents: [
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      category: "referral_letter",
      title: "Referral to cardiology",
      fileName: "referral-reyes.pdf",
      contentType: "application/pdf",
      sizeBytes: 48213,
      uploadedAt: "2026-09-27T01:40:00.000Z",
    },
  ],
};

function errors(resource: { resourceType: string }): unknown[] {
  let validate = validators.get(resource.resourceType);
  if (!validate) {
    validate = fhir.ajv.compile({ $schema: fhir.schema.$schema, definitions: fhir.schema.definitions, $ref: `#/definitions/${resource.resourceType}` });
    validators.set(resource.resourceType, validate);
  }
  if (validate(resource)) return [];
  // The bundled schema was generated from R4 4.0.0, whose fhirVersion value set predates the 4.0.1 technical correction we declare.
  return (validate.errors ?? []).filter(
    (e) => !(e as { dataPath?: string }).dataPath?.endsWith(".fhirVersion") || (resource as { fhirVersion?: string }).fhirVersion !== "4.0.1",
  );
}

describe("FHIR R4 mapping", () => {
  const everything = patientEverything(ctx, source, DEFAULT_PAGING, new Date("2026-09-28T00:00:00Z"));
  const resources = (everything.entry ?? []).map((e) => e.resource as FhirResource);
  const find = <T extends FhirResource>(type: T["resourceType"], id?: string) => resources.find((r) => r.resourceType === type && (!id || r.id === id)) as T;

  it("produces a Bundle and resources that are valid against the official R4 JSON schema", () => {
    expect(errors(everything)).toEqual([]);
    for (const resource of resources)
      expect({ id: `${resource.resourceType}/${resource.id}`, errors: errors(resource) }).toEqual({
        id: `${resource.resourceType}/${resource.id}`,
        errors: [],
      });
    expect(errors(capabilityStatement(ctx))).toEqual([]);
    expect(errors(operationOutcome("not-found", "Patient not found"))).toEqual([]);
  });

  it("resolves every reference inside the Bundle", () => {
    const present = new Set(resources.map((r) => `${r.resourceType}/${r.id}`));
    const references = JSON.stringify(everything).match(/"reference":"([A-Za-z]+\/[^"]+)"/g) ?? [];
    const missing = references.map((r) => r.slice(13, -1)).filter((r) => !present.has(r));
    expect(missing).toEqual([]);
  });

  it("maps the patient with the patient number, configured and local identifier systems, and a Philippine address", () => {
    const patient = find<Patient>("Patient");
    expect(patient.identifier).toEqual([
      expect.objectContaining({ system: "https://ids.example.ph/demo/patient-number", value: "P00000001", use: "usual" }),
      expect.objectContaining({ system: "https://ids.example.ph/demo/configured/philhealth", value: "12-345678901-2", assigner: { display: "PhilHealth" } }),
      expect.objectContaining({ system: "https://ids.example.ph/demo/identifier/senior-citizen-id", period: { start: "2025-01-01" } }),
    ]);
    expect(patient.name).toEqual([{ use: "official", family: "Dela Cruz", given: ["Juan", "Santos"], suffix: ["Jr."], text: "DELA CRUZ, Juan Santos Jr." }]);
    expect(patient.telecom).toEqual([
      { system: "phone", value: "+639171234567", use: "mobile", rank: 1 },
      { system: "email", value: "juan@example.ph" },
    ]);
    expect(patient.address).toEqual([
      { use: "home", type: "physical", line: ["12 Mabini St.", "Brgy. San Isidro"], city: "Quezon City", state: "NCR", postalCode: "1100", country: "PH" },
    ]);
    expect(patient.maritalStatus?.coding?.[0]).toMatchObject({ code: "M" });
  });

  it("maps diagnoses with ICD-10 and respects entered-in-error", () => {
    const hypertension = find<FhirResource & { code?: unknown; clinicalStatus?: unknown }>("Condition", "44444444-4444-4444-8444-444444444444");
    expect(hypertension.code).toEqual({
      coding: [{ system: "http://hl7.org/fhir/sid/icd-10", version: "2019", code: "I10", display: "Essential (primary) hypertension" }],
      text: "Essential (primary) hypertension",
    });
    const retracted = find<FhirResource & { clinicalStatus?: unknown; verificationStatus?: { coding?: Array<{ code?: string }> } }>(
      "Condition",
      "55555555-5555-4555-8555-555555555555",
    );
    expect(retracted.clinicalStatus).toBeUndefined();
    expect(retracted.verificationStatus?.coding?.[0]?.code).toBe("entered-in-error");
  });

  it("maps vital signs with LOINC and UCUM, blood pressure as components, and computes BMI", () => {
    const bp = find<Observation>("Observation", "77777777-7777-4777-8777-777777777777-bp");
    expect(bp.code.coding?.[0]).toMatchObject({ system: "http://loinc.org", code: "85354-9" });
    expect(bp.component?.map((c) => [c.code.coding?.[0]?.code, c.valueQuantity?.value, c.valueQuantity?.code])).toEqual([
      ["8480-6", 150, "mm[Hg]"],
      ["8462-4", 95, "mm[Hg]"],
    ]);
    expect(find<Observation>("Observation", "77777777-7777-4777-8777-777777777777-bmi").valueQuantity).toMatchObject({ value: 24.2, code: "kg/m2" });
  });

  it("maps laboratory results with LOINC, interpretation, reference range and corrections; the report is partial while a test is pending", () => {
    const fbs = find<Observation>("Observation", "99999999-9999-4999-8999-999999999992");
    expect(fbs).toMatchObject({
      status: "corrected",
      valueQuantity: { value: 6.2, unit: "mmol/L" },
      interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "H" }] }],
      referenceRange: [{ low: { value: 3.9, unit: "mmol/L" }, high: { value: 5.5, unit: "mmol/L" } }],
      basedOn: [{ reference: "ServiceRequest/99999999-9999-4999-8999-999999999991" }],
    });
    expect(fbs.code.coding?.[0]).toEqual({ system: "http://loinc.org", code: "1558-6", display: "Fasting blood sugar" });
    const report = find<FhirResource & { status: string; result?: unknown[] }>("DiagnosticReport");
    expect(report.status).toBe("partial");
    expect(report.result).toHaveLength(2);
    const pending = find<FhirResource & { status: string; priority?: string }>("ServiceRequest", "99999999-9999-4999-8999-999999999995");
    expect(pending).toMatchObject({ status: "active", priority: "stat" });
  });

  it("maps prescriptions line by line, grouped by the prescription number", () => {
    const lines = resources.filter((r) => r.resourceType === "MedicationRequest") as Array<
      FhirResource & { groupIdentifier?: { value?: string }; dosageInstruction?: Array<{ text?: string; asNeededCodeableConcept?: unknown }> }
    >;
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.groupIdentifier?.value === "RX00000001")).toBe(true);
    expect(lines[0]?.dosageInstruction?.[0]?.text).toBe("1 tablet, oral, once daily, for 30 days");
    expect(lines[1]?.dosageInstruction?.[0]?.asNeededCodeableConcept).toEqual({ text: "headache" });
  });

  it("lists patient matches first and shared resources as includes, and searches one type", () => {
    expect(everything.entry?.[0]?.resource?.resourceType).toBe("Patient");
    expect(everything.total).toBe(resources.filter((_, i) => everything.entry?.[i]?.search?.mode === "match").length);
    expect(everything.entry?.filter((e) => e.search?.mode === "include").map((e) => e.resource?.resourceType)).toEqual([
      "Organization",
      "Location",
      "Practitioner",
    ]);
    const observations: Bundle = searchByPatient(ctx, source, "Observation");
    expect(observations.entry?.every((e) => e.resource?.resourceType === "Observation")).toBe(true);
    expect(observations.total).toBe(10); // 8 vital-sign observations + 2 laboratory results
    expect(errors(observations)).toEqual([]);
  });

  it("states no known allergies only when reviewed and nothing is active", () => {
    const nka = patientEverything(ctx, { ...source, allergies: [], allergyReview: { noKnownAllergies: true, reviewedAt: "2026-02-02T00:00:00.000Z" } });
    const allergy = nka.entry?.find((e) => e.resource?.resourceType === "AllergyIntolerance")?.resource;
    expect(allergy).toMatchObject({ code: { coding: [{ system: "http://snomed.info/sct", code: "716186003" }] } });
    expect(errors(allergy as FhirResource)).toEqual([]);
    const none = patientEverything(ctx, { ...source, allergies: [], allergyReview: null });
    expect(none.entry?.some((e) => e.resource?.resourceType === "AllergyIntolerance")).toBe(false);
  });

  it("maps stored documents as DocumentReference with an authenticated content URL on this endpoint", () => {
    const doc = find<DocumentReference>("DocumentReference");
    expect(doc).toMatchObject({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      meta: { lastUpdated: "2026-09-27T01:40:00.000Z" },
      status: "current",
      type: { coding: [{ system: "https://ids.example.ph/demo/codesystem/document-category", code: "referral_letter", display: "Referral letter" }] },
      subject: { reference: `Patient/${P}` },
      description: "Referral to cardiology",
      content: [
        {
          attachment: {
            contentType: "application/pdf",
            url: "https://api.example.ph/api/v1/fhir/r4/Binary/dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            size: 48213,
            title: "referral-reyes.pdf",
          },
        },
      ],
    });
    expect(everything.entry?.some((e) => e.search?.mode === "outcome")).toBe(false);
  });

  it("withholds documents with a notice when the caller may not read them", () => {
    const withheld = patientEverything(ctx, { ...source, documents: null });
    expect(withheld.entry?.some((e) => e.resource?.resourceType === "DocumentReference")).toBe(false);
    const notices = withheld.entry?.filter((e) => e.search?.mode === "outcome") ?? [];
    expect(notices).toHaveLength(1);
    expect((notices[0]?.resource as OperationOutcome).issue[0]).toMatchObject({ severity: "information", code: "suppressed" });
    expect(errors(withheld)).toEqual([]);
    expect(errors(notices[0]?.resource as OperationOutcome)).toEqual([]);
    expect(withheld.total).toBe((everything.total ?? 0) - 1);
  });

  it("declares every served type, paging and _lastUpdated where supported", () => {
    const capability: CapabilityStatement = capabilityStatement(ctx);
    const resources = capability.rest?.[0]?.resource ?? [];
    expect(resources.map((r) => r.type)).toEqual(expect.arrayContaining(["Patient", "DocumentReference", "Binary"]));
    const withLastUpdated = resources.filter((r) => r.searchParam?.some((p) => p.name === "_lastUpdated")).map((r) => r.type);
    expect(withLastUpdated.sort()).toEqual(["DocumentReference", "MedicationRequest"]);
  });
});

describe("FHIR paging", () => {
  const all = patientEverything(ctx, source, { count: PAGE_SIZE.max, offset: 0 });
  const allMatches = (all.entry ?? []).filter((e) => e.search?.mode === "match").map((e) => e.fullUrl);

  it("pages $everything in a stable order with self/next/previous links and the full total", () => {
    const seen: Array<string | undefined> = [];
    let paging = { count: 7, offset: 0 };
    for (let guard = 0; guard < 20; guard++) {
      const page = patientEverything(ctx, source, paging);
      expect(errors(page)).toEqual([]);
      expect(page.total).toBe(allMatches.length);
      const matches = (page.entry ?? []).filter((e) => e.search?.mode === "match");
      expect(matches.length).toBeLessThanOrEqual(7);
      seen.push(...matches.map((e) => e.fullUrl));
      // Includes are the shared resources this page references (other matches may be on other pages).
      const present = new Set((page.entry ?? []).map((e) => `${e.resource?.resourceType}/${e.resource?.id}`));
      const shared = [...JSON.stringify(page).matchAll(/"reference":"((Organization|Location|Practitioner)\/[^"]+)"/g)].map((m) => m[1]);
      expect(shared.filter((r) => !present.has(r!))).toEqual([]);
      const included = (page.entry ?? []).filter((e) => e.search?.mode === "include").map((e) => `${e.resource?.resourceType}/${e.resource?.id}`);
      expect(included.filter((r) => !shared.includes(r))).toEqual([]);

      const link = (relation: string) => page.link?.find((l) => l.relation === relation)?.url;
      expect(link("self")).toBe(`${ctx.baseUrl}/Patient/${P}/$everything?_count=7&_offset=${paging.offset}`);
      if (paging.offset === 0) expect(link("previous")).toBeUndefined();
      else expect(link("previous")).toBe(`${ctx.baseUrl}/Patient/${P}/$everything?_count=7&_offset=${paging.offset - 7}`);
      const next = link("next");
      if (!next) break;
      paging = { count: 7, offset: Number(new URL(next).searchParams.get("_offset")) };
    }
    expect(seen).toEqual(allMatches);
    expect(seen[0]).toBe(`${ctx.baseUrl}/Patient/${P}`);
  });

  it("orders deterministically whatever order the source rows come in", () => {
    const reversed = {
      ...source,
      vitals: [...source.vitals].reverse(),
      prescriptions: source.prescriptions.map((p) => ({ ...p, items: [...p.items].reverse() })),
    };
    const urls = (patientEverything(ctx, reversed, { count: PAGE_SIZE.max, offset: 0 }).entry ?? []).map((e) => e.fullUrl);
    expect(urls).toEqual((all.entry ?? []).map((e) => e.fullUrl));
  });

  it("returns only the total for _count=0 and an empty page past the end", () => {
    const counted = searchByPatient(ctx, source, "Observation", { paging: { count: 0, offset: 0 }, lastUpdated: {} });
    expect(counted.total).toBe(10);
    expect(counted).not.toHaveProperty("entry");
    expect(counted.link?.map((l) => l.relation)).toEqual(["self"]);
    const past = searchByPatient(ctx, source, "Observation", { paging: { count: 4, offset: 40 }, lastUpdated: {} });
    expect(past).not.toHaveProperty("entry");
    expect(past.link?.find((l) => l.relation === "previous")?.url).toBe(`${ctx.baseUrl}/Observation?patient=${P}&_count=4&_offset=6`);
    expect(errors(past)).toEqual([]);
  });

  it("parses _count and _offset: default, maximum, and invalid values", () => {
    expect(parsePaging({})).toEqual({ count: PAGE_SIZE.default, offset: 0 });
    expect(parsePaging({ _count: "10", _offset: "20" })).toEqual({ count: 10, offset: 20 });
    expect(parsePaging({ _count: "100000" })).toEqual({ count: PAGE_SIZE.max, offset: 0 });
    for (const query of [{ _count: "-1" }, { _count: "ten" }, { _offset: "1.5" }, { _count: ["1", "2"] }]) {
      expect(() => parsePaging(query)).toThrow(FhirSearchError);
    }
  });
});

describe("FHIR _lastUpdated", () => {
  const RX2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const later: typeof source = {
    ...source,
    prescriptions: [
      ...source.prescriptions,
      // Issued 2026-09-01, cancelled 2026-09-29 (Manila): last updated at the cancellation.
      {
        ...source.prescriptions[0]!,
        id: RX2,
        prescriptionNumber: "RX00000002",
        status: "cancelled",
        issuedAt: "2026-09-01T02:00:00.000Z",
        cancelledAt: "2026-09-28T16:30:00.000Z",
        items: [source.prescriptions[0]!.items[0]!],
      },
    ],
  };
  const search = (lastUpdated: SearchParameters["lastUpdated"]) =>
    (searchByPatient(ctx, later, "MedicationRequest", { paging: DEFAULT_PAGING, lastUpdated }).entry ?? []).map((e) => e.resource?.id);

  it("filters on meta.lastUpdated with ge and le, dates as whole days in Manila time", () => {
    expect(search({})).toHaveLength(3);
    expect(search({ ge: "2026-09-29" })).toEqual([`${RX2}-1`]); // 2026-09-28T16:30Z is 2026-09-29 00:30 in Manila
    expect(search({ le: "2026-09-28" })).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-2"]);
    expect(search({ le: "2026-09-27" })).toHaveLength(2); // issued 2026-09-27T01:28Z, the whole day included
    expect(search({ ge: "2026-09-27T01:28:00Z", le: "2026-09-27T01:28:00Z" })).toHaveLength(2);
    expect(search({ ge: "2026-09-28T16:30:00.001Z" })).toEqual([]);
    const bundle = searchByPatient(ctx, later, "MedicationRequest", { paging: { count: 1, offset: 0 }, lastUpdated: { ge: "2026-09-01" } });
    expect(bundle.link?.find((l) => l.relation === "next")?.url).toBe(
      `${ctx.baseUrl}/MedicationRequest?patient=${P}&_lastUpdated=ge2026-09-01&_count=1&_offset=1`,
    );
    expect(errors(bundle)).toEqual([]);
  });

  it("filters documents by their upload time", () => {
    const documents = (lastUpdated: SearchParameters["lastUpdated"]) =>
      searchByPatient(ctx, source, "DocumentReference", { paging: DEFAULT_PAGING, lastUpdated }).total;
    expect(documents({ ge: "2026-09-27T01:40:00.000Z" })).toBe(1);
    expect(documents({ le: "2026-09-27T09:39:59+08:00" })).toBe(0);
  });

  it("parses ge/le only, once each, and refuses types without a reliable last-updated time", () => {
    expect(parseLastUpdated(["ge2026-09-01", "le2026-09-30T23:59:59+08:00"])).toEqual({ ge: "2026-09-01", le: "2026-09-30T23:59:59+08:00" });
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as FhirSearchError).code;
      }
      return undefined;
    };
    expect(code(() => parseLastUpdated("2026-09-01"))).toBe("not-supported");
    expect(code(() => parseLastUpdated("gt2026-09-01"))).toBe("not-supported");
    expect(code(() => parseLastUpdated(["ge2026-09-01", "ge2026-09-02"]))).toBe("invalid");
    expect(code(() => parseLastUpdated("ge2026-02-30"))).toBe("invalid");
    expect(code(() => parseLastUpdated("ge2026-09-01T10:00:00"))).toBe("invalid"); // an instant needs its time zone
    expect(code(() => parseSearchParameters({ _lastUpdated: "ge2026-09-01" }, { type: "Encounter", lastUpdated: false }))).toBe("not-supported");
    expect(parseSearchParameters({ _count: "5" }, { type: "Encounter", lastUpdated: false })).toEqual({ paging: { count: 5, offset: 0 }, lastUpdated: {} });
  });
});
