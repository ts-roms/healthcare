import type {
  Bundle,
  CapabilityStatement,
  CarePlan,
  DocumentReference,
  FhirResource,
  Observation,
  OperationOutcome,
  Patient,
  Procedure,
  ServiceRequest,
} from "fhir/r4";
import { capabilityStatement, type CompartmentType, operationOutcome, patientEverything, searchByPatient } from "./bundle";
import {
  decodeCursor,
  DEFAULT_PAGING,
  encodeCursor,
  FhirSearchError,
  PAGE_SIZE,
  parseEverythingParameters,
  parseLastUpdated,
  parsePaging,
  parseSearchParameters,
  type SearchParameters,
} from "./search";
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
      source: "staff",
    },
  ],
  allergyReview: { noKnownAllergies: false, reviewedAt: "2026-01-01T00:00:00.000Z" },
  vitals: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      encounterId: ENC,
      measuredAt: "2026-09-27T01:05:00.000Z",
      recordedAt: "2026-09-27T01:05:00.000Z",
      enteredInErrorAt: null,
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
            performer: null,
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
            performer: null,
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
      supersededAt: null,
      replaces: [],
      related: [],
    },
  ],
  referrals: [],
  externalHistory: [],
  dental: { procedures: [], plans: [], examinations: [], chart: [], perioCharts: [] },
  immunizations: [],
  clinicProcedures: [],
  history: { procedures: [], conditions: [], medications: [], family: [], familyReview: null, social: [], sensitiveIncluded: true },
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

  it("maps archived laboratory reports: LOINC type, linked to the DiagnosticReport, newer version replaces the superseded one", () => {
    const ORDER = "88888888-8888-4888-8888-888888888888";
    const [V1, V2] = ["f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1", "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2"];
    const report = { category: "laboratory_report", contentType: "application/pdf", sizeBytes: 9000, related: [{ type: "DiagnosticReport", id: ORDER }] };
    const withReports: PatientRecordSource = {
      ...source,
      documents: [
        {
          ...report,
          id: V1,
          title: "Laboratory report L1",
          fileName: "L1.pdf",
          uploadedAt: "2026-09-27T04:01:00.000Z",
          supersededAt: "2026-09-27T05:01:00.000Z",
          replaces: [],
        },
        {
          ...report,
          id: V2,
          title: "Laboratory report L1 (update 2)",
          fileName: "L1-2.pdf",
          uploadedAt: "2026-09-27T05:01:00.000Z",
          supersededAt: null,
          replaces: [V1],
        },
      ],
    };
    const bundle = patientEverything(ctx, withReports);
    const docs = (bundle.entry ?? []).map((e) => e.resource as FhirResource).filter((r): r is DocumentReference => r.resourceType === "DocumentReference");
    expect(docs.map((d) => [d.id, d.status, d.meta?.lastUpdated])).toEqual([
      [V1, "superseded", "2026-09-27T05:01:00.000Z"],
      [V2, "current", "2026-09-27T05:01:00.000Z"],
    ]);
    expect(docs[1]).toMatchObject({
      type: { coding: [{ system: "http://loinc.org", code: "11502-2" }, { code: "laboratory_report" }] },
      relatesTo: [{ code: "replaces", target: { reference: `DocumentReference/${V1}` } }],
      context: { related: [{ reference: `DiagnosticReport/${ORDER}` }] },
    });
    for (const d of docs) expect(errors(d)).toEqual([]);
    const present = new Set((bundle.entry ?? []).map((e) => `${e.resource?.resourceType}/${e.resource?.id}`));
    const references = [...JSON.stringify(bundle).matchAll(/"reference":"([A-Za-z]+\/[^"]+)"/g)].map((m) => m[1]);
    expect(references.filter((r) => !present.has(r!))).toEqual([]);
    // A superseded version changed when it was superseded: _lastUpdated sees that time.
    const since = searchByPatient(ctx, withReports, "DocumentReference", { paging: DEFAULT_PAGING, lastUpdated: { ge: "2026-09-27T05:00:00Z" } });
    expect(since.total).toBe(2);
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

  describe("referrals", () => {
    const CARDIO = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";
    // The internal referral's id is its letter's (the referral_letter document above); the external one has a reply document that is not exported.
    const withReferrals: PatientRecordSource = {
      ...source,
      practitioners: [
        ...source.practitioners,
        { id: CARDIO, displayName: "Dr. Jose Cruz", profession: "physician", specialty: "Cardiology", licenseNumber: "0765432", status: "active" },
      ],
      referrals: [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          referralNumber: "RF00000001",
          kind: "internal",
          status: "accepted",
          urgency: "emergency",
          encounterId: ENC,
          referringPractitionerId: DR,
          toPractitionerId: CARDIO,
          externalProvider: null,
          externalFacility: null,
          externalContact: null,
          specialty: "Cardiology",
          reason: "Uncontrolled hypertension despite two agents",
          clinicalSummary: "BP 160/100 on amlodipine and losartan.",
          diagnosisIds: ["44444444-4444-4444-8444-444444444444"],
          issuedAt: "2026-09-27T01:35:00.000Z",
          replyDocumentId: null,
        },
        {
          id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
          referralNumber: "RF00000002",
          kind: "external",
          status: "completed",
          urgency: "routine",
          encounterId: ENC,
          referringPractitionerId: DR,
          toPractitionerId: null,
          externalProvider: "Dr. Ana Santos",
          externalFacility: "Heart Center Hospital",
          externalContact: "+63 2 8925 2401",
          specialty: null,
          reason: "Second opinion",
          clinicalSummary: null,
          diagnosisIds: [],
          issuedAt: "2026-09-27T01:36:00.000Z",
          replyDocumentId: "efefefef-efef-4fef-8fef-efefefefefef",
        },
        {
          id: "cececece-cece-4ece-8ece-cececececece",
          referralNumber: "RF00000003",
          kind: "external",
          status: "cancelled",
          urgency: "urgent",
          encounterId: ENC,
          referringPractitionerId: DR,
          toPractitionerId: null,
          externalProvider: "City General Hospital",
          externalFacility: null,
          externalContact: null,
          specialty: "Nephrology",
          reason: "Rising creatinine",
          clinicalSummary: null,
          diagnosisIds: [],
          issuedAt: "2026-09-27T01:37:00.000Z",
          replyDocumentId: null,
        },
      ],
    };
    const bundle = patientEverything(ctx, withReferrals, { count: PAGE_SIZE.max, offset: 0 });
    const all = (bundle.entry ?? []).map((e) => e.resource as FhirResource);
    const request = (id: string) => all.find((r) => r.resourceType === "ServiceRequest" && r.id === id) as ServiceRequest;

    it("maps referrals to ServiceRequest (category Patient referral; emergency as stat) valid against the R4 schema, every reference resolved", () => {
      const internal = request("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
      expect(internal).toMatchObject({
        identifier: [{ system: `${ctx.identifierBase}/referral-number`, value: "RF00000001" }],
        status: "active",
        intent: "order",
        priority: "stat",
        category: [{ coding: [{ system: "http://snomed.info/sct", code: "3457005", display: "Patient referral" }], text: "Referral" }],
        code: { text: "Cardiology" },
        subject: { reference: `Patient/${P}` },
        encounter: { reference: `Encounter/${ENC}` },
        authoredOn: "2026-09-27T01:35:00.000Z",
        requester: { reference: `Practitioner/${DR}` },
        performer: [{ reference: `Practitioner/${CARDIO}` }],
        reasonCode: [{ text: "Uncontrolled hypertension despite two agents" }],
        reasonReference: [{ reference: "Condition/44444444-4444-4444-8444-444444444444" }],
        supportingInfo: [{ reference: "DocumentReference/dddddddd-dddd-4ddd-8ddd-dddddddddddd" }],
      });
      expect(internal.note?.map((n) => n.text)).toEqual([
        "BP 160/100 on amlodipine and losartan.",
        "Urgency as written by the referrer: emergency",
        "Referral status: Accepted by the practitioner referred to",
      ]);
      expect(internal.contained).toBeUndefined();

      const external = request("cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd");
      expect(external).toMatchObject({ status: "completed", priority: "routine", code: { text: "Referral" } });
      expect(external.performer).toEqual([
        { reference: "#referral-recipient", display: "Dr. Ana Santos" },
        { reference: "#referral-recipient-organization", display: "Heart Center Hospital" },
      ]);
      expect(external.contained).toEqual([
        {
          resourceType: "Organization",
          id: "referral-recipient-organization",
          name: "Heart Center Hospital",
          telecom: [{ system: "other", value: "+63 2 8925 2401" }],
        },
        { resourceType: "Practitioner", id: "referral-recipient", name: [{ text: "Dr. Ana Santos" }] },
      ]);
      // The reply document is not part of the export: no dangling reference.
      expect(external.supportingInfo).toBeUndefined();

      const cancelled = request("cececece-cece-4ece-8ece-cececececece");
      expect(cancelled).toMatchObject({ status: "revoked", priority: "urgent", performerType: { text: "Nephrology" } });
      expect(cancelled.performer).toEqual([{ reference: "#referral-recipient-organization", display: "City General Hospital" }]);

      expect(errors(bundle)).toEqual([]);
      for (const r of [internal, external, cancelled]) expect(errors(r)).toEqual([]);
      const present = new Set(all.map((r) => `${r.resourceType}/${r.id}`));
      const references = JSON.stringify(bundle).match(/"reference":"([A-Za-z]+\/[^"]+)"/g) ?? [];
      expect(references.map((r) => r.slice(13, -1)).filter((r) => !present.has(r))).toEqual([]);
    });

    it("serves referrals with lab test requests on ServiceRequest?patient=, and drops the letter reference when documents are withheld", () => {
      const search = searchByPatient(ctx, withReferrals, "ServiceRequest");
      const ids = (search.entry ?? []).filter((e) => e.search?.mode === "match").map((e) => e.resource?.id);
      expect(ids).toEqual(
        expect.arrayContaining(["dddddddd-dddd-4ddd-8ddd-dddddddddddd", "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd", "cececece-cece-4ece-8ece-cececececece"]),
      );
      expect(search.total).toBe(searchByPatient(ctx, source, "ServiceRequest").total! + 3);
      expect(errors(search)).toEqual([]);
      const withheld = searchByPatient(ctx, { ...withReferrals, documents: null }, "ServiceRequest");
      const letter = withheld.entry?.find((e) => e.resource?.id === "dddddddd-dddd-4ddd-8ddd-dddddddddddd")?.resource as ServiceRequest;
      expect(letter.supportingInfo).toBeUndefined();
      expect(errors(withheld)).toEqual([]);
    });

    it("documents referrals on ServiceRequest in the CapabilityStatement", () => {
      const serviceRequest = capabilityStatement(ctx).rest?.[0]?.resource?.find((r) => r.type === "ServiceRequest");
      expect(serviceRequest?.documentation).toContain("3457005");
      expect(serviceRequest?.documentation).toContain("stat for an emergency referral");
    });
  });

  it("declares every served type, paging and _lastUpdated where supported", () => {
    const capability: CapabilityStatement = capabilityStatement(ctx);
    const resources = capability.rest?.[0]?.resource ?? [];
    expect(resources.map((r) => r.type)).toEqual(expect.arrayContaining(["Patient", "DocumentReference", "Binary"]));
    const withLastUpdated = resources.filter((r) => r.searchParam?.some((p) => p.name === "_lastUpdated")).map((r) => r.type);
    expect(withLastUpdated.sort()).toEqual([
      "DocumentReference",
      "FamilyMemberHistory",
      "Immunization",
      "MedicationRequest",
      "MedicationStatement",
      "Observation",
      "Procedure",
    ]);
  });
});

describe("FHIR paging", () => {
  const all = patientEverything(ctx, source, { count: PAGE_SIZE.max, offset: 0 });
  const allMatches = (all.entry ?? []).filter((e) => e.search?.mode === "match").map((e) => e.fullUrl);

  it("pages $everything in a stable order with self/next/previous links and the full total", () => {
    const seen: Array<string | undefined> = [];
    let paging = parsePaging({ _count: "7" });
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
      // The first page is reached by offset; every next link carries a cursor, and a cursor page has no previous link.
      if (paging.cursor) expect(link("self")).toBe(`${ctx.baseUrl}/Patient/${P}/$everything?_count=7&_cursor=${encodeCursor(paging.cursor)}`);
      else expect(link("self")).toBe(`${ctx.baseUrl}/Patient/${P}/$everything?_count=7&_offset=0`);
      expect(link("previous")).toBeUndefined();
      const next = link("next");
      if (!next) break;
      expect(next).toContain("_cursor=");
      paging = parsePaging(Object.fromEntries(new URL(next).searchParams));
    }
    expect(seen).toEqual(allMatches);
    expect(seen[0]).toBe(`${ctx.baseUrl}/Patient/${P}`);
    // Offset paging still gives previous links (random access), and walks the same order.
    const third = patientEverything(ctx, source, { count: 7, offset: 14 });
    expect(third.link?.find((l) => l.relation === "previous")?.url).toBe(`${ctx.baseUrl}/Patient/${P}/$everything?_count=7&_offset=7`);
    expect((third.entry ?? []).filter((e) => e.search?.mode === "match").map((e) => e.fullUrl)).toEqual(allMatches.slice(14, 21));
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

  it("follows next links by cursor: pages never overlap or skip when a resource is added or removed in between", () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as FhirSearchError).code;
      }
      return undefined;
    };
    // The cursor names the last match of the page; it is opaque to clients and refused when it is not ours.
    const cursor = { resourceType: "Observation", id: "77777777-7777-4777-8777-777777777777-bp" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(parsePaging({ _cursor: encodeCursor(cursor) })).toEqual({ count: PAGE_SIZE.default, offset: 0, cursor });
    expect(code(() => parsePaging({ _cursor: "not-a-cursor!" }))).toBe("invalid");
    expect(code(() => parsePaging({ _cursor: encodeCursor(cursor), _offset: "3" }))).toBe("invalid");

    // Walk the record three at a time while a vital-sign set disappears and a diagnosis appears between pages.
    const first = patientEverything(ctx, source, { count: 3, offset: 0 });
    const firstUrls = (first.entry ?? []).filter((e) => e.search?.mode === "match").map((e) => e.fullUrl);
    const next1 = first.link?.find((l) => l.relation === "next")?.url;
    expect(next1).toContain("_cursor=");
    expect(next1).not.toContain("_offset=");
    expect(first.link?.some((l) => l.relation === "previous")).toBe(false);
    const changed = {
      ...source,
      vitals: [],
      diagnoses: [...source.diagnoses, { ...source.diagnoses[0]!, id: "00000000-0000-4000-8000-000000000001", code: "A00", display: "Added later" }],
    };
    const second = patientEverything(ctx, changed, parsePaging(Object.fromEntries(new URL(next1!).searchParams)));
    const secondUrls = (second.entry ?? []).filter((e) => e.search?.mode === "match").map((e) => e.fullUrl);
    // Nothing from the first page repeats, and nothing after the cursor is skipped.
    expect(secondUrls.some((u) => firstUrls.includes(u))).toBe(false);
    const changedAll = (patientEverything(ctx, changed, { count: PAGE_SIZE.max, offset: 0 }).entry ?? [])
      .filter((e) => e.search?.mode === "match")
      .map((e) => e.fullUrl);
    const afterCursor = changedAll.slice(changedAll.findIndex((u) => u === firstUrls[firstUrls.length - 1]) + 1);
    expect(secondUrls).toEqual(afterCursor.slice(0, 3));
    // A cursor page has no previous link; the total is the whole changed result.
    expect(second.link?.some((l) => l.relation === "previous")).toBe(false);
    expect(second.total).toBe(changedAll.length);
    // A cursor whose resource is gone starts where it would have been.
    const gone = patientEverything(ctx, changed, { count: 3, offset: 0, cursor: { resourceType: "Observation", id: "zzz" } });
    expect((gone.entry ?? []).filter((e) => e.search?.mode === "match")[0]?.resource?.resourceType).not.toBe("Observation");
  });

  it("parses _type and _since for $everything: _since only with _type naming reliable types", () => {
    const options = { compartmentTypes: ["Encounter", "Observation", "MedicationRequest"], reliableTypes: ["Observation", "MedicationRequest"] };
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as FhirSearchError).code;
      }
      return undefined;
    };
    expect(parseEverythingParameters({ _type: "Observation, MedicationRequest", _since: "2026-09-01T00:00:00+08:00" }, options)).toEqual({
      paging: DEFAULT_PAGING,
      types: ["Observation", "MedicationRequest"],
      since: "2026-09-01T00:00:00+08:00",
    });
    expect(parseEverythingParameters({ _type: "Encounter" }, options).types).toEqual(["Encounter"]);
    expect(code(() => parseEverythingParameters({ _since: "2026-09-01T00:00:00Z" }, options))).toBe("not-supported");
    expect(code(() => parseEverythingParameters({ _type: "Encounter,Observation", _since: "2026-09-01T00:00:00Z" }, options))).toBe("not-supported");
    expect(code(() => parseEverythingParameters({ _type: "Observation", _since: "2026-09-01" }, options))).toBe("invalid");
    expect(code(() => parseEverythingParameters({ _type: "Nonsense" }, options))).toBe("invalid");
    expect(code(() => parseEverythingParameters({ start: "2026-01-01" }, options))).toBe("not-supported");
    expect(code(() => parseEverythingParameters({ _lastUpdated: "ge2026-01-01" }, options))).toBe("not-supported");
  });

  it("limits $everything to _type and to resources changed since an instant", () => {
    const typed = patientEverything(ctx, source, { paging: { count: PAGE_SIZE.max, offset: 0 }, types: ["Observation"] });
    const types = new Set((typed.entry ?? []).filter((e) => e.search?.mode === "match").map((e) => e.resource?.resourceType));
    expect([...types].sort()).toEqual(["Observation", "Patient"]);
    expect(typed.link?.find((l) => l.relation === "self")?.url).toContain("_type=Observation");
    // Vital signs recorded 27 Sep; a since after that leaves only what changed later (and the Patient only if it did).
    const since = patientEverything(ctx, source, { paging: { count: PAGE_SIZE.max, offset: 0 }, types: ["Observation"], since: "2026-09-27T12:00:00Z" });
    const left = (since.entry ?? []).filter((e) => e.search?.mode === "match").map((e) => e.resource);
    expect(left.every((r) => r?.resourceType !== "Patient" || Date.parse(r.meta?.lastUpdated ?? "") >= Date.parse("2026-09-27T12:00:00Z"))).toBe(true);
    expect(
      left.filter((r) => r?.resourceType === "Observation").every((r) => Date.parse(r?.meta?.lastUpdated ?? "") >= Date.parse("2026-09-27T12:00:00Z")),
    ).toBe(true);
    expect(since.total).toBeLessThan(typed.total ?? 0);
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
    const next = bundle.link?.find((l) => l.relation === "next")?.url ?? "";
    expect(next.startsWith(`${ctx.baseUrl}/MedicationRequest?patient=${P}&_lastUpdated=ge2026-09-01&_count=1&_cursor=`)).toBe(true);
    expect(decodeCursor(new URL(next).searchParams.get("_cursor")!)).toEqual({
      resourceType: "MedicationRequest",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-1",
    });
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
    // Observations carry a reliable last-updated time: vital signs record when marked entered in error (migration 0104).
    const inError = {
      ...source,
      vitals: source.vitals.map((v) => ({ ...v, status: "entered_in_error" as const, enteredInErrorAt: "2026-10-01T00:00:00.000Z" })),
    };
    const vitalsSince = searchByPatient(ctx, inError, "Observation", { paging: DEFAULT_PAGING, lastUpdated: { ge: "2026-10-01" } });
    expect((vitalsSince.entry ?? []).filter((e) => e.search?.mode === "match").every((e) => e.resource?.resourceType === "Observation")).toBe(true);
    expect(vitalsSince.total).toBeGreaterThan(0);
    expect(searchByPatient(ctx, source, "Observation", { paging: DEFAULT_PAGING, lastUpdated: { ge: "2026-10-01" } }).total).toBe(0);
    expect(parseSearchParameters({ _count: "5" }, { type: "Encounter", lastUpdated: false })).toEqual({ paging: { count: 5, offset: 0 }, lastUpdated: {} });
  });
});

describe("FHIR export of send-out results and records from other systems", () => {
  const RL = "12121212-1212-4121-8121-121212121212";
  const referenceLab = { id: RL, name: "Metro Reference Laboratory", accreditationReference: "DOH-LIC-TEST-001" };
  const TAG = { system: "https://ids.example.ph/demo/codesystem/record-source", code: "external-import", display: "Imported from another system" };
  const IDS = {
    importedAllergy: "13131313-1313-4131-8131-131313131313",
    condition: "e1000000-0000-4000-8000-000000000001",
    conditionInError: "e1000000-0000-4000-8000-000000000002",
    observation: "e1000000-0000-4000-8000-000000000003",
    reported: "e1000000-0000-4000-8000-000000000004",
    prescribedElsewhere: "e1000000-0000-4000-8000-000000000005",
    document: "e1000000-0000-4000-8000-000000000006",
  };
  type Entry = PatientRecordSource["externalHistory"][number];
  const entry = (id: string, fields: Partial<Entry>): Entry => ({
    id,
    kind: "condition",
    category: null,
    display: "Entry",
    codeSystem: null,
    code: null,
    valueText: null,
    statusText: null,
    effectiveText: null,
    declaredSource: "https://hospital.test.invalid/fhir",
    status: "active",
    recordedAt: "2026-09-20T02:00:00.000Z",
    enteredInErrorAt: null,
    ...fields,
  });
  const order = source.labOrders[0]!;
  const extended: PatientRecordSource = {
    ...source,
    allergies: [
      ...source.allergies,
      {
        id: IDS.importedAllergy,
        category: "food",
        substance: "Shrimp",
        reaction: "Urticaria",
        severity: "mild",
        criticality: "low",
        // Stored unconfirmed by the import; the export states it whatever the row says.
        verification: "confirmed",
        status: "active",
        recordedAt: "2026-09-20T02:00:00.000Z",
        source: "external_import",
      },
    ],
    labOrders: [
      {
        ...order,
        items: order.items.map((i) => (i.testCode === "fbs" && i.result ? { ...i, result: { ...i.result, performer: referenceLab } } : i)),
      },
    ],
    externalHistory: [
      entry(IDS.condition, {
        category: "problem-list-item",
        display: "Type 2 diabetes mellitus",
        codeSystem: "http://hl7.org/fhir/sid/icd-10",
        code: "E11.9",
        statusText: "active · confirmed",
        effectiveText: "2019-05",
      }),
      entry(IDS.conditionInError, {
        display: "Asthma",
        statusText: "active",
        effectiveText: "sometime in 2010",
        status: "entered_in_error",
        enteredInErrorAt: "2026-09-21T02:00:00.000Z",
        declaredSource: "not a uri",
      }),
      entry(IDS.observation, {
        kind: "observation",
        category: "laboratory",
        display: "Hemoglobin A1c",
        codeSystem: "http://loinc.org",
        code: "4548-4",
        valueText: "7.2 % (High) ref. 4 – 5.6",
        statusText: "final",
        effectiveText: "2026-08-01T08:00:00+08:00",
      }),
      entry(IDS.reported, {
        kind: "medication",
        category: "reported",
        display: "Metformin 500 mg tablet",
        valueText: "1 tablet twice daily",
        statusText: "active",
        effectiveText: "2026-01-15",
      }),
      entry(IDS.prescribedElsewhere, {
        kind: "medication",
        category: "prescribed_elsewhere",
        display: "Losartan 50 mg tablet",
        statusText: "cancelled",
        effectiveText: "2026-02-01T09:00:00Z",
        recordedAt: "2026-09-25T02:00:00.000Z",
      }),
      entry(IDS.document, {
        kind: "document",
        category: "Discharge summary",
        display: "Discharge summary, Hospital X",
        valueText: "summary.pdf, application/pdf, 120 KB (file not imported)",
        statusText: "current",
        effectiveText: "2026-07-01T10:00:00+08:00",
      }),
    ],
  };
  const bundle = patientEverything(ctx, extended, { count: PAGE_SIZE.max, offset: 0 });
  const all = (bundle.entry ?? []).map((e) => e.resource as FhirResource);
  const byId = <T extends FhirResource>(id: string) => all.find((r) => r.id === id) as T;
  type Loose = FhirResource & Record<string, unknown>;

  it("keeps every resource valid against the official R4 JSON schema, every reference resolved", () => {
    expect(errors(bundle)).toEqual([]);
    for (const resource of all) expect({ id: resource.id, errors: errors(resource) }).toEqual({ id: resource.id, errors: [] });
    const present = new Set(all.map((r) => `${r.resourceType}/${r.id}`));
    const references = [...JSON.stringify(bundle).matchAll(/"reference":"([A-Za-z]+\/[^"]+)"/g)].map((m) => m[1]);
    expect(references.filter((r) => !present.has(r!))).toEqual([]);
  });

  it("names the reference laboratory that performed a send-out as a contained Organization, without an unconfigured identifier", () => {
    const fbs = byId<Observation>("99999999-9999-4999-8999-999999999992");
    expect(fbs.performer).toEqual([{ reference: `#reference-lab-${RL}`, display: "Metro Reference Laboratory" }]);
    expect(fbs.contained).toEqual([
      { resourceType: "Organization", id: `reference-lab-${RL}`, type: [{ text: "Reference laboratory" }], name: "Metro Reference Laboratory" },
    ]);
    // In-house results are unchanged: the organization performs them.
    const hbsag = byId<Observation>("99999999-9999-4999-8999-999999999994");
    expect(hbsag.performer).toEqual([{ reference: `Organization/${ctx.organization.id}` }]);
    expect(hbsag).not.toHaveProperty("contained");
    const report = byId<Loose>("88888888-8888-4888-8888-888888888888");
    expect(report["performer"]).toEqual([
      { reference: `Organization/${ctx.organization.id}` },
      { reference: `#reference-lab-${RL}`, display: "Metro Reference Laboratory" },
    ]);
    expect(report["contained"]).toHaveLength(1);
    // Without send-outs: no contained resources at all.
    expect(JSON.stringify(patientEverything(ctx, source))).not.toContain("contained");
  });

  it("gives the accreditation reference as an identifier only with a configured system", () => {
    const configured: FhirContext = {
      ...ctx,
      identifierSystems: { ...ctx.identifierSystems, reference_laboratory_accreditation: "https://ids.test.invalid/lab-licence" },
    };
    const fbs = (patientEverything(configured, extended).entry ?? [])
      .map((e) => e.resource as Observation)
      .find((r) => r.id === "99999999-9999-4999-8999-999999999992");
    expect(fbs?.contained?.[0]).toMatchObject({
      identifier: [{ system: "https://ids.test.invalid/lab-licence", value: "DOH-LIC-TEST-001", type: { text: "Accreditation / licence reference" } }],
    });
    expect(errors(fbs as Observation)).toEqual([]);
  });

  it("flags imported allergies with the external-source tag, always unconfirmed; staff allergies are unchanged", () => {
    expect(byId(IDS.importedAllergy)).toMatchObject({
      meta: { tag: [TAG] },
      verificationStatus: { coding: [{ code: "unconfirmed" }] },
      clinicalStatus: { coding: [{ code: "active" }] },
    });
    expect(byId("66666666-6666-4666-8666-666666666666")).not.toHaveProperty("meta");
  });

  it("maps external history to Condition, Observation, MedicationStatement and DocumentReference, tagged and never as the platform's own", () => {
    const condition = byId<Loose>(IDS.condition);
    expect(condition).toMatchObject({
      resourceType: "Condition",
      meta: { lastUpdated: "2026-09-20T02:00:00.000Z", source: "https://hospital.test.invalid/fhir", tag: [TAG] },
      clinicalStatus: { coding: [{ code: "active" }] },
      verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "unconfirmed" }] },
      category: [{ coding: [{ code: "problem-list-item" }] }],
      code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "E11.9", display: "Type 2 diabetes mellitus" }] },
      onsetDateTime: "2019-05",
    });
    expect(condition).not.toHaveProperty("encounter");
    expect(condition["note"]).toEqual([
      { text: "Imported from another system; not verified by this organization." },
      { text: "Status at the source: active · confirmed" },
    ]);

    // Entered in error: like a diagnosis in error (status kept, no clinical status); a declared source that is not a URI is left out.
    const inError = byId<Loose>(IDS.conditionInError);
    expect(inError).toMatchObject({ verificationStatus: { coding: [{ code: "entered-in-error" }] }, onsetString: "sometime in 2010" });
    expect(inError).not.toHaveProperty("clinicalStatus");
    expect(inError["meta"]).toEqual({ lastUpdated: "2026-09-21T02:00:00.000Z", tag: [TAG] });

    const observation = byId<Observation>(IDS.observation);
    expect(observation).toMatchObject({
      status: "final",
      category: [{ coding: [{ code: "laboratory" }] }],
      code: { coding: [{ system: "http://loinc.org", code: "4548-4" }] },
      valueString: "7.2 % (High) ref. 4 – 5.6",
      effectiveDateTime: "2026-08-01T08:00:00+08:00",
      meta: { tag: [TAG] },
    });
    for (const property of ["performer", "issued", "basedOn", "encounter", "contained"]) expect(observation).not.toHaveProperty(property);

    expect(byId(IDS.reported)).toMatchObject({
      resourceType: "MedicationStatement",
      status: "active",
      medicationCodeableConcept: { text: "Metformin 500 mg tablet" },
      dosage: [{ text: "1 tablet twice daily" }],
      effectiveDateTime: "2026-01-15",
    });
    const elsewhere = byId<Loose>(IDS.prescribedElsewhere);
    expect(elsewhere).toMatchObject({ resourceType: "MedicationStatement", status: "unknown" });
    expect(JSON.stringify(elsewhere["note"])).toContain("Status at the source: cancelled");
    expect(JSON.stringify(elsewhere["note"])).toContain("Prescribed elsewhere");

    const document = byId<DocumentReference>(IDS.document);
    expect(document).toMatchObject({
      status: "current",
      type: { text: "Discharge summary" },
      description: "Discharge summary, Hospital X",
      date: "2026-07-01T10:00:00+08:00",
      content: [{ attachment: { title: "summary.pdf, application/pdf, 120 KB (file not imported)" } }],
    });
    expect(document).not.toHaveProperty("custodian");
    expect(JSON.stringify(document)).not.toContain("Binary");
    expect(all.filter((r) => r.resourceType === "Encounter")).toHaveLength(source.encounters.length);
  });

  it("searches external history by type, with _lastUpdated where reliable, and withholds document descriptions with documents", () => {
    const search = (type: CompartmentType, lastUpdated: SearchParameters["lastUpdated"] = {}) =>
      searchByPatient(ctx, extended, type, { paging: DEFAULT_PAGING, lastUpdated });
    expect(search("MedicationStatement").total).toBe(2);
    expect(search("MedicationStatement", { ge: "2026-09-25" }).entry?.map((e) => e.resource?.id)).toEqual([IDS.prescribedElsewhere]);
    expect(search("Condition").total).toBe(4); // 2 diagnoses + 2 external conditions
    expect(search("Observation").total).toBe(11); // 8 vital signs + 2 laboratory results + 1 external
    expect(search("DocumentReference").total).toBe(2);
    expect(search("DocumentReference", { ge: "2026-09-20", le: "2026-09-20" }).entry?.map((e) => e.resource?.id)).toEqual([IDS.document]);
    expect(errors(search("MedicationStatement"))).toEqual([]);
    const withheld = patientEverything(ctx, { ...extended, documents: null });
    expect(withheld.entry?.some((e) => e.resource?.resourceType === "DocumentReference")).toBe(false);
    expect(withheld.entry?.some((e) => e.resource?.resourceType === "MedicationStatement")).toBe(true);
  });
});

describe("FHIR export of the dental record", () => {
  const DENTIST = "d0000000-0000-4000-8000-000000000001";
  const DENC = "d0000000-0000-4000-8000-000000000002";
  const D = {
    exam: "d1000000-0000-4000-8000-000000000001",
    examInError: "d1000000-0000-4000-8000-000000000002",
    procedure: "d2000000-0000-4000-8000-000000000001",
    procedureInError: "d2000000-0000-4000-8000-000000000002",
    cleaning: "d2000000-0000-4000-8000-000000000003",
    plan: "d3000000-0000-4000-8000-000000000001",
    declinedPlan: "d3000000-0000-4000-8000-000000000002",
    state16: "d4000000-0000-4000-8000-000000000016",
    state26: "d4000000-0000-4000-8000-000000000026",
    state36: "d4000000-0000-4000-8000-000000000036",
    perio: "d5000000-0000-4000-8000-000000000001",
    perio16: "d5000000-0000-4000-8000-000000000016",
    image: "d6000000-0000-4000-8000-000000000001",
    imageDocument: "d6000000-0000-4000-8000-000000000002",
  };
  const local = (key: string) => `https://ids.example.ph/demo/codesystem/${key}`;
  const dental: PatientRecordSource = {
    ...source,
    practitioners: [
      ...source.practitioners,
      { id: DENTIST, displayName: "Dr. Ana Santos", profession: "dentist", specialty: null, licenseNumber: "0654321", status: "active" },
    ],
    encounters: [...source.encounters, { ...source.encounters[0]!, id: DENC, practitionerId: DENTIST, appointmentId: null, visitTypeName: "Dental" }],
    documents: [
      ...source.documents!,
      {
        id: D.imageDocument,
        category: "imaging",
        title: "Bitewing right",
        fileName: "bw-right.jpg",
        contentType: "image/jpeg",
        sizeBytes: 120000,
        uploadedAt: "2026-09-27T02:00:00.000Z",
        supersededAt: null,
        replaces: [],
        related: [],
        dentalImage: {
          id: D.image,
          kind: "bitewing",
          teeth: ["16", "46"],
          takenOn: "2026-09-27",
          encounterId: DENC,
          status: "recorded",
          recordedAt: "2026-09-27T02:05:00.000Z",
          enteredInErrorAt: null,
        },
      },
    ],
    dental: {
      examinations: [
        {
          id: D.exam,
          facilityId: FAC,
          encounterId: DENC,
          practitionerId: DENTIST,
          oralHygiene: "fair",
          notes: "Gingiva slightly inflamed",
          status: "recorded",
          recordedAt: "2026-09-27T01:10:00.000Z",
          enteredInErrorAt: null,
        },
        {
          id: D.examInError,
          facilityId: FAC,
          encounterId: DENC,
          practitionerId: DENTIST,
          oralHygiene: null,
          notes: "Wrong patient",
          status: "entered_in_error",
          recordedAt: "2026-09-27T01:05:00.000Z",
          enteredInErrorAt: "2026-09-27T01:06:00.000Z",
        },
      ],
      procedures: [
        {
          id: D.procedure,
          facilityId: FAC,
          encounterId: DENC,
          practitionerId: DENTIST,
          code: "D-RESIN-2",
          name: "Composite restoration, two surfaces",
          tooth: "16",
          surfaces: ["M", "O"],
          notes: "Shade A2",
          planId: D.plan,
          status: "recorded",
          performedAt: "2026-09-27T01:30:00.000Z",
          enteredInErrorAt: null,
        },
        {
          id: D.procedureInError,
          facilityId: FAC,
          encounterId: DENC,
          practitionerId: DENTIST,
          code: "D-EXT",
          name: "Extraction",
          tooth: "36",
          surfaces: [],
          notes: null,
          planId: null,
          status: "entered_in_error",
          performedAt: "2026-09-27T01:35:00.000Z",
          enteredInErrorAt: "2026-09-28T16:30:00.000Z",
        },
        {
          id: D.cleaning,
          facilityId: FAC,
          encounterId: DENC,
          practitionerId: DENTIST,
          code: "D-PROPH",
          name: "Oral prophylaxis",
          tooth: null,
          surfaces: [],
          notes: null,
          planId: null,
          status: "recorded",
          performedAt: "2026-09-27T01:40:00.000Z",
          enteredInErrorAt: null,
        },
      ],
      plans: [
        {
          id: D.plan,
          practitionerId: DENTIST,
          title: "Restorative plan",
          notes: "Two phases",
          status: "in_progress",
          decisionNote: "Options and fees explained",
          decidedAt: "2026-09-27T01:20:00.000Z",
          discontinuedReason: null,
          createdAt: "2026-09-27T01:15:00.000Z",
          items: [
            {
              id: "i1",
              phase: 1,
              code: "D-RESIN-2",
              name: "Composite restoration, two surfaces",
              tooth: "16",
              surfaces: ["M", "O"],
              note: null,
              status: "completed",
              procedureId: D.procedure,
            },
            { id: "i2", phase: 2, code: "D-CROWN", name: "Crown", tooth: "26", surfaces: [], note: "After RCT", status: "accepted", procedureId: null },
            { id: "i3", phase: 2, code: "D-SEAL", name: "Sealant", tooth: "37", surfaces: ["O"], note: null, status: "declined", procedureId: null },
          ],
        },
        {
          id: D.declinedPlan,
          practitionerId: DENTIST,
          title: "Orthodontic referral",
          notes: null,
          status: "declined",
          decisionNote: "Patient prefers to wait",
          decidedAt: "2026-09-27T01:21:00.000Z",
          discontinuedReason: null,
          createdAt: "2026-09-27T01:16:00.000Z",
          items: [
            { id: "i4", phase: 1, code: "D-CONSULT", name: "Consultation", tooth: null, surfaces: [], note: null, status: "declined", procedureId: null },
          ],
        },
      ],
      chart: [
        {
          id: D.state16,
          tooth: "16",
          findings: [{ condition: "restoration", surfaces: ["M", "O"] }],
          note: null,
          source: { type: "procedure", id: D.procedure },
          encounterId: DENC,
          practitionerId: DENTIST,
          recordedAt: "2026-09-27T01:30:00.000Z",
        },
        {
          id: D.state26,
          tooth: "26",
          findings: [
            { condition: "caries", surfaces: ["D"] },
            { condition: "root_canal", surfaces: [] },
          ],
          note: "Deep lesion",
          source: { type: "examination", id: D.exam },
          encounterId: DENC,
          practitionerId: DENTIST,
          recordedAt: "2026-09-27T01:10:00.000Z",
        },
        {
          id: D.state36,
          tooth: "36",
          findings: [],
          note: null,
          source: { type: "examination", id: D.exam },
          encounterId: DENC,
          practitionerId: DENTIST,
          recordedAt: "2026-09-27T01:10:00.000Z",
        },
      ],
      perioCharts: [
        {
          id: D.perio,
          facilityId: FAC,
          encounterId: DENC,
          practitionerId: DENTIST,
          notes: "Localized pockets",
          status: "recorded",
          recordedAt: "2026-09-27T01:25:00.000Z",
          enteredInErrorAt: null,
          teeth: [
            {
              id: D.perio16,
              tooth: "16",
              mobility: 1,
              furcation: 2,
              sites: [
                { site: "MB", probingDepth: 5, gingivalMargin: 1, bleeding: true, suppuration: false, plaque: true },
                { site: "B", probingDepth: 3, gingivalMargin: -1, bleeding: false, suppuration: false, plaque: false },
              ],
            },
          ],
        },
      ],
    },
  };
  const bundle = patientEverything(ctx, dental, { count: PAGE_SIZE.max, offset: 0 });
  const all = (bundle.entry ?? []).map((e) => e.resource as FhirResource);
  const byId = <T extends FhirResource>(id: string) => all.find((r) => r.id === id) as T;

  it("keeps every dental resource valid against the official R4 JSON schema, every reference resolved", () => {
    expect(errors(bundle)).toEqual([]);
    for (const r of all) expect({ id: `${r.resourceType}/${r.id}`, errors: errors(r) }).toEqual({ id: `${r.resourceType}/${r.id}`, errors: [] });
    const present = new Set(all.map((r) => `${r.resourceType}/${r.id}`));
    const references = [...JSON.stringify(bundle).matchAll(/"reference":"([A-Za-z]+\/[^"]+)"/g)].map((m) => m[1]);
    expect(references.filter((r) => !present.has(r!))).toEqual([]);
    expect(present.has(`Practitioner/${DENTIST}`)).toBe(true);
  });

  it("maps procedures with the organization's local code, the FDI tooth and surfaces as bodySite, the dentist and the plan", () => {
    const procedure = byId<Procedure>(D.procedure);
    expect(procedure).toMatchObject({
      status: "completed",
      meta: { lastUpdated: "2026-09-27T01:30:00.000Z" },
      code: { coding: [{ system: local("dental-procedure"), code: "D-RESIN-2", display: "Composite restoration, two surfaces" }] },
      subject: { reference: `Patient/${P}` },
      encounter: { reference: `Encounter/${DENC}` },
      performedDateTime: "2026-09-27T01:30:00.000Z",
      performer: [{ actor: { reference: `Practitioner/${DENTIST}` } }],
      location: { reference: `Location/${FAC}` },
      basedOn: [{ reference: `CarePlan/${D.plan}` }],
      note: [{ text: "Shade A2" }],
    });
    expect(procedure.bodySite?.map((b) => [b.coding?.[0]?.system, b.coding?.[0]?.code])).toEqual([
      [local("fdi-tooth"), "16"],
      [local("tooth-surface"), "M"],
      [local("tooth-surface"), "O"],
    ]);
    const inError = byId<Procedure>(D.procedureInError);
    expect(inError).toMatchObject({ status: "entered-in-error", meta: { lastUpdated: "2026-09-28T16:30:00.000Z" } });
    expect(byId<Procedure>(D.cleaning)).not.toHaveProperty("bodySite");
    // No licensed dental code system (CDT/ADA, SNOMED CT body structures) is claimed.
    expect(JSON.stringify([procedure, inError])).not.toMatch(/ada\.org|snomed/);
  });

  it("uses a configured code system only where one is configured", () => {
    const configured = { ...ctx, codeSystems: { "dental-procedure": "https://codes.example.ph/licensed-dental" } };
    const procedure = patientEverything(configured, dental, { count: PAGE_SIZE.max, offset: 0 }).entry?.find((e) => e.resource?.id === D.procedure)
      ?.resource as Procedure;
    expect(procedure.code?.coding?.[0]?.system).toBe("https://codes.example.ph/licensed-dental");
    expect(procedure.bodySite?.[0]?.coding?.[0]?.system).toBe(local("fdi-tooth"));
  });

  it("maps treatment plans to CarePlan with the patient's decision per item and the performed procedure as outcome", () => {
    const plan = byId<CarePlan>(D.plan);
    expect(plan).toMatchObject({
      status: "active",
      intent: "plan",
      category: [{ text: "dental" }],
      title: "Restorative plan",
      author: { reference: `Practitioner/${DENTIST}` },
    });
    expect(plan.note).toEqual([{ text: "Patient's decision: Options and fees explained", time: "2026-09-27T01:20:00.000Z" }]);
    expect(
      plan.activity?.map((a) => [a.detail?.code?.coding?.[0]?.code, a.detail?.status, a.detail?.statusReason?.text, a.outcomeReference?.[0]?.reference]),
    ).toEqual([
      ["D-RESIN-2", "completed", undefined, `Procedure/${D.procedure}`],
      ["D-CROWN", "not-started", "Accepted by the patient", undefined],
      ["D-SEAL", "cancelled", "Declined by the patient", undefined],
    ]);
    expect(plan.activity?.[1]?.detail?.description).toBe("Phase 2: Crown — tooth 26. After RCT");
    expect(plan.activity?.[2]?.detail?.description).toBe("Phase 2: Sealant — tooth 37 O");
    const declined = byId<CarePlan>(D.declinedPlan);
    expect(declined.status).toBe("revoked");
    expect(declined.note?.[0]?.text).toBe("Declined by the patient.");
  });

  it("maps the examination and the current chart as exam Observations: tooth as bodySite, findings per surface, sound teeth", () => {
    const exam = byId<Observation>(D.exam);
    expect(exam).toMatchObject({
      status: "final",
      category: [{ coding: [{ code: "exam" }] }],
      code: { coding: [{ system: local("dental-observation"), code: "dental-examination" }] },
      component: [{ valueCodeableConcept: { coding: [{ system: local("oral-hygiene"), code: "fair" }] } }],
      note: [{ text: "Gingiva slightly inflamed" }],
    });
    expect(byId<Observation>(D.examInError).status).toBe("entered-in-error");
    const tooth26 = byId<Observation>(D.state26);
    expect(tooth26.bodySite?.coding?.[0]).toEqual({ system: local("fdi-tooth"), code: "26", display: "Tooth 26" });
    expect(tooth26.derivedFrom).toEqual([{ reference: `Observation/${D.exam}` }]);
    expect(tooth26.component?.map((c) => [c.code.coding?.[0]?.code, c.valueCodeableConcept?.coding?.[0]?.code ?? c.valueBoolean])).toEqual([
      ["caries", "D"],
      ["root_canal", true],
    ]);
    expect(byId<Observation>(D.state16).partOf).toEqual([{ reference: `Procedure/${D.procedure}` }]);
    expect(byId<Observation>(D.state36).valueCodeableConcept?.coding?.[0]).toMatchObject({ system: local("tooth-condition"), code: "sound" });
  });

  it("maps a periodontal chart to a panel with one Observation per tooth, a component per site measurement", () => {
    const panel = byId<Observation>(D.perio);
    expect(panel.hasMember).toEqual([{ reference: `Observation/${D.perio16}` }]);
    const tooth = byId<Observation>(D.perio16);
    expect(tooth.bodySite?.coding?.[0]?.code).toBe("16");
    const values = Object.fromEntries(
      (tooth.component ?? []).map((c) => [c.code.coding?.[0]?.code, c.valueQuantity?.value ?? c.valueInteger ?? c.valueBoolean]),
    );
    expect(values).toEqual({
      "tooth-mobility": 1,
      furcation: 2,
      "probing-depth-MB": 5,
      "gingival-margin-MB": 1,
      "bleeding-on-probing-MB": true,
      "plaque-MB": true,
      "suppuration-MB": false,
      "probing-depth-B": 3,
      "gingival-margin-B": -1,
      "bleeding-on-probing-B": false,
      "plaque-B": false,
      "suppuration-B": false,
    });
    expect(tooth.component?.find((c) => c.code.coding?.[0]?.code === "probing-depth-MB")?.valueQuantity).toEqual({
      value: 5,
      unit: "mm",
      system: "http://unitsofmeasure.org",
      code: "mm",
    });
  });

  it("describes dental images on their DocumentReference and marks one entered in error", () => {
    const image = byId<DocumentReference>(D.imageDocument);
    expect(image).toMatchObject({
      status: "current",
      meta: { lastUpdated: "2026-09-27T02:05:00.000Z" },
      category: [{ coding: [{ system: local("dental-image-kind"), code: "bitewing", display: "Bitewing radiograph" }] }],
      description: "Bitewing right (teeth 16, 46, FDI)",
      context: { encounter: [{ reference: `Encounter/${DENC}` }], period: { start: "2026-09-27" } },
      content: [{ attachment: { url: `${ctx.baseUrl}/Binary/${D.imageDocument}` } }],
    });
    const inError = {
      ...dental.documents![1]!,
      dentalImage: { ...dental.documents![1]!.dentalImage!, status: "entered_in_error" as const, enteredInErrorAt: "2026-09-29T00:00:00.000Z" },
    };
    const withError = patientEverything(ctx, { ...dental, documents: [dental.documents![0]!, inError] });
    const marked = withError.entry?.find((e) => e.resource?.id === D.imageDocument)?.resource as DocumentReference;
    expect(marked).toMatchObject({ status: "entered-in-error", meta: { lastUpdated: "2026-09-29T00:00:00.000Z" } });
    expect(errors(marked)).toEqual([]);
  });

  it("searches Procedure by patient with _lastUpdated, and dental items appear in the Observation and CarePlan searches", () => {
    const search = (type: CompartmentType, lastUpdated: SearchParameters["lastUpdated"] = {}) =>
      searchByPatient(ctx, dental, type, { paging: DEFAULT_PAGING, lastUpdated });
    expect(search("Procedure").total).toBe(3);
    expect(search("Procedure", { ge: "2026-09-29" }).entry?.map((e) => e.resource?.id)).toEqual([D.procedureInError]);
    expect(search("CarePlan").total).toBe(3); // 1 care plan + 2 dental plans
    expect(search("Observation").total).toBe(10 + 2 + 3 + 2); // vital signs and results + examinations + chart + perio panel and tooth
    const paged = searchByPatient(ctx, dental, "Procedure", { paging: { count: 2, offset: 0 }, lastUpdated: {} });
    expect(paged.entry).toHaveLength(2);
    expect(paged.link?.find((l) => l.relation === "next")?.url).toMatch(new RegExp(`^${ctx.baseUrl}/Procedure\\?patient=${P}&_count=2&_cursor=`));
    expect(errors(search("Procedure"))).toEqual([]);
  });

  it("withholds the dental record with a notice when the caller may not read it; dental images stay with the documents", () => {
    const withheld = patientEverything(ctx, { ...dental, dental: null }, { count: PAGE_SIZE.max, offset: 0 });
    const ids = new Set((withheld.entry ?? []).map((e) => e.resource?.id));
    for (const id of [D.procedure, D.plan, D.exam, D.state16, D.perio, D.perio16]) expect(ids.has(id)).toBe(false);
    expect(ids.has(D.imageDocument)).toBe(true);
    const notices = (withheld.entry ?? []).filter((e) => e.search?.mode === "outcome").map((e) => (e.resource as OperationOutcome).issue[0]?.diagnostics);
    expect(notices).toEqual([expect.stringContaining("dental.record.read")]);
    expect(withheld.total).toBe((bundle.total ?? 0) - 12);
    const observations = searchByPatient(ctx, { ...dental, dental: null }, "Observation");
    expect(observations.total).toBe(10);
    expect(observations.entry?.filter((e) => e.search?.mode === "outcome")).toHaveLength(1);
    expect(searchByPatient(ctx, { ...dental, dental: null }, "Encounter").entry?.some((e) => e.search?.mode === "outcome")).toBe(false);
    expect(errors(withheld)).toEqual([]);
  });
});
