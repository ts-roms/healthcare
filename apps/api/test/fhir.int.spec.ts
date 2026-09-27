import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

// The official FHIR R4 JSON schema (bundled by this dev dependency); each resource is checked against its own type.
type Validate = ((data: unknown) => boolean) & { errors?: Array<{ dataPath?: string }> | null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Validator = require("@asymmetrik/fhir-json-schema-validator") as new () => {
  ajv: { compile(schema: object): Validate };
  schema: { $schema: string; definitions: object };
};
const fhir = new Validator();
const validators = new Map<string, Validate>();
function schemaErrors(resource: { resourceType: string; fhirVersion?: string }) {
  let validate = validators.get(resource.resourceType);
  if (!validate) {
    validate = fhir.ajv.compile({ $schema: fhir.schema.$schema, definitions: fhir.schema.definitions, $ref: `#/definitions/${resource.resourceType}` });
    validators.set(resource.resourceType, validate);
  }
  if (validate(resource)) return [];
  // The bundled schema predates the 4.0.1 technical correction in its fhirVersion value set.
  return (validate.errors ?? []).filter((e) => !(e.dataPath?.endsWith(".fhirVersion") && resource.fhirVersion === "4.0.1"));
}

interface Resource {
  resourceType: string;
  id: string;
  [key: string]: unknown;
}
interface Bundle extends Resource {
  total: number;
  entry: Array<{ fullUrl: string; resource: Resource; search: { mode: string } }>;
}

/**
 * The read-only FHIR R4 interface (docs/interoperability/fhir.md): a patient's
 * record mapped from the internal model, valid against the official schema,
 * released laboratory results only, organization-scoped, permission-gated,
 * audited, with OperationOutcome errors.
 */
describe("FHIR R4 interface", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let medtech: string;
  let practitionerId: string;
  let doctorUserId: string;
  let patientId: string;
  let encounterId: string;

  const get = (url: string, token = admin) => ctx.http().get(`/api/v1/fhir/r4${url}`).set(as(token, tenant.facilityId));
  const staff = (token: string) => ({ post: (url: string) => ctx.http().post(url).set(as(token, tenant.facilityId)) });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "fhir-org");
    await createStaff(ctx.pool, tenant, "admin@fhir.ph", ["org_admin"]);
    ({ practitionerId, userId: doctorUserId } = await createClinician(ctx, tenant, "reyes@fhir.ph", ["physician"]));
    await createStaff(ctx.pool, tenant, "medtech@fhir.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    admin = (await login(ctx, "admin@fhir.ph")).accessToken;
    medtech = (await login(ctx, "medtech@fhir.ph")).accessToken;
    doctor = (await login(ctx, "reyes@fhir.ph")).accessToken;
    patientId = (await staff(admin).post("/api/v1/patients").send(juan).expect(201)).body.id;

    const q = (sql: string, params: unknown[]) => ctx.pool.query(sql, params);
    encounterId = (
      await q(
        `INSERT INTO encounter (organization_id, facility_id, patient_id, practitioner_id, started_by, chief_complaint)
         VALUES ($1, $2, $3, $4, $5, 'Polyuria') RETURNING id`,
        [tenant.organizationId, tenant.facilityId, patientId, practitionerId, doctorUserId],
      )
    ).rows[0].id;
    await q(
      `INSERT INTO diagnosis (organization_id, patient_id, encounter_id, code_system_key, code, display, rank, certainty, is_chronic, recorded_by, updated_by)
       VALUES ($1, $2, $3, 'icd-10', 'E11.9', 'Type 2 diabetes mellitus without complications', 'primary', 'confirmed', true, $4, $4)`,
      [tenant.organizationId, patientId, encounterId, doctorUserId],
    );
    await q(
      `INSERT INTO vital_sign_set (organization_id, facility_id, patient_id, encounter_id, measured_at, measured_by, systolic_mmhg, diastolic_mmhg, heart_rate_bpm, weight_kg, height_cm)
       VALUES ($1, $2, $3, $4, now(), $5, 130, 85, 82, 82, 168)`,
      [tenant.organizationId, tenant.facilityId, patientId, encounterId, doctorUserId],
    );
    await staff(admin).post(`/api/v1/patients/${patientId}/allergies`).send({ category: "medication", substance: "Penicillin", reaction: "Hives" }).expect(201);
    await staff(doctor)
      .post("/api/v1/prescriptions")
      .send({
        encounterId,
        items: [
          {
            genericName: "Metformin",
            strength: "500 mg",
            dosageForm: "tablet",
            doseAmount: 1,
            doseUnit: "tablet",
            route: "oral",
            frequency: "twice_daily",
            durationValue: 30,
            durationUnit: "days",
            quantity: 60,
            quantityUnit: "tablets",
            instructions: "Take with meals",
          },
        ],
      })
      .expect(201);
    await staff(doctor)
      .post("/api/v1/care-plans")
      .send({
        patientId,
        title: "Diabetes care plan",
        category: "chronic_disease",
        startDate: manilaDate(0),
        authorPractitionerId: practitionerId,
        activities: [{ kind: "laboratory_monitoring", description: "HbA1c every 3 months", assignee: "care_team", dueDate: manilaDate(90) }],
      })
      .expect(201);

    // Laboratory: one order released, one still being worked on.
    const post = (path: string, body: object) => staff(admin).post(`/api/v1/laboratory${path}`).send(body).expect(201);
    const chem = (await post("/departments", { code: "chem", name: "Chemistry" })).body.id;
    const serum = (await post("/specimen-types", { code: "serum", name: "Serum" })).body.id;
    const test = async (code: string, loincCode?: string) =>
      (await post("/tests", { code, name: code.toUpperCase(), departmentId: chem, specimenTypeId: serum, resultType: "numeric", unit: "mmol/L", loincCode }))
        .body.id;
    const fbs = await test("fbs", "1558-6");
    const k = await test("potassium");
    await post(`/tests/${fbs}/reference-ranges`, { low: 3.9, high: 5.5 });
    const resulted = async (testId: string, value: number) => {
      const order = await staff(doctor)
        .post("/api/v1/laboratory/orders")
        .send({ patientId, encounterId, testIds: [testId] })
        .expect(201);
      const item = order.body.items[0];
      const specimen = (
        await staff(medtech)
          .post(`/api/v1/laboratory/orders/${order.body.id}/specimens`)
          .send({ specimenTypeId: item.specimenTypeId, itemIds: [item.id] })
          .expect(201)
      ).body.specimens[0].id;
      await staff(medtech).post(`/api/v1/laboratory/specimens/${specimen}/receive`).expect(200);
      const result = (await staff(medtech).post(`/api/v1/laboratory/order-items/${item.id}/results`).send({ valueNumeric: value }).expect(201)).body.id;
      return { orderId: order.body.id as string, result: result as string };
    };
    const released = await resulted(fbs, 7.2);
    await staff(admin).post(`/api/v1/laboratory/results/${released.result}/verify`).expect(200);
    await staff(admin).post(`/api/v1/laboratory/results/${released.result}/approve`).expect(200);
    await staff(admin).post(`/api/v1/laboratory/orders/${released.orderId}/release`).expect(200);
    await resulted(k, 4.2); // entered, not released
  });

  afterAll(() => ctx.close());

  it("describes itself (CapabilityStatement) as FHIR R4 JSON", async () => {
    const res = await get("/metadata")
      .expect(200)
      .expect("content-type", /application\/fhir\+json/);
    expect(res.body).toMatchObject({ resourceType: "CapabilityStatement", fhirVersion: "4.0.1", publisher: "Org fhir-org" });
    expect(schemaErrors(res.body)).toEqual([]);
  });

  it("reads the Patient with the patient number and a Philippine address", async () => {
    const res = await get(`/Patient/${patientId}`)
      .expect(200)
      .expect("content-type", /application\/fhir\+json/);
    expect(schemaErrors(res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      resourceType: "Patient",
      id: patientId,
      name: [{ family: "Dela Cruz", given: ["Juan", "Santos"] }],
      gender: "male",
      birthDate: "1980-03-04",
      address: [{ line: ["Brgy. Poblacion"], city: "Makati City", district: "Metro Manila", postalCode: "1210", country: "PH" }],
    });
    expect(res.body.identifier).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "P00000001", type: expect.objectContaining({ coding: [expect.objectContaining({ code: "MR" })] }) }),
        // No official URI is on record for the PhilHealth PIN: a local namespace until configured.
        expect.objectContaining({ value: "12-345678901-2", system: expect.stringMatching(/\/fhir-org\/identifier\/philhealth-pin$/) }),
      ]),
    );
  });

  it("returns the whole record ($everything), schema-valid, with every reference resolved and only released results", async () => {
    const res = await get(`/Patient/${patientId}/$everything`).expect(200);
    const bundle = res.body as Bundle;
    expect(bundle).toMatchObject({ resourceType: "Bundle", type: "searchset" });
    expect(schemaErrors(bundle)).toEqual([]);
    for (const { resource } of bundle.entry)
      expect({ id: `${resource.resourceType}/${resource.id}`, errors: schemaErrors(resource) }).toMatchObject({ errors: [] });

    const count = (type: string) => bundle.entry.filter((e) => e.resource.resourceType === type).length;
    expect(
      Object.fromEntries(
        ["Patient", "Encounter", "Condition", "AllergyIntolerance", "MedicationRequest", "CarePlan", "ServiceRequest", "DiagnosticReport"].map((t) => [
          t,
          count(t),
        ]),
      ),
    ).toEqual({
      Patient: 1,
      Encounter: 1,
      Condition: 1,
      AllergyIntolerance: 1,
      MedicationRequest: 1,
      CarePlan: 1,
      ServiceRequest: 2,
      DiagnosticReport: 1,
    });
    const lab = bundle.entry.map((e) => e.resource).filter((r) => r.resourceType === "Observation" && JSON.stringify(r.category).includes("laboratory"));
    // Only the released FBS; the potassium result is still in the laboratory's hands.
    expect(lab).toEqual([
      expect.objectContaining({
        status: "final",
        code: expect.objectContaining({ coding: expect.arrayContaining([expect.objectContaining({ system: "http://loinc.org", code: "1558-6" })]) }),
        valueQuantity: { value: 7.2, unit: "mmol/L" },
        interpretation: [expect.objectContaining({ coding: [expect.objectContaining({ code: "H" })] })],
      }),
    ]);
    const condition = bundle.entry.find((e) => e.resource.resourceType === "Condition")!.resource;
    expect(condition.code).toMatchObject({ coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "E11.9" }] });

    const present = new Set(bundle.entry.map((e) => `${e.resource.resourceType}/${e.resource.id}`));
    const references = [...JSON.stringify(bundle).matchAll(/"reference":"([A-Za-z]+\/[^"]+)"/g)].map((m) => m[1]);
    expect(references.filter((r) => !present.has(r!))).toEqual([]);
    expect(
      bundle.entry
        .filter((e) => e.search.mode === "include")
        .map((e) => e.resource.resourceType)
        .sort(),
    ).toEqual(["Location", "Organization", "Practitioner"]);

    const audit = await auditRows(ctx.pool, "action = 'fhir.patient-everything' AND patient_id = $1", [patientId]);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ resources: bundle.total });
  });

  it("searches one resource type by patient", async () => {
    const res = await get(`/Observation?patient=Patient/${patientId}`).expect(200);
    expect(schemaErrors(res.body)).toEqual([]);
    const types = new Set((res.body as Bundle).entry.map((e) => e.resource.resourceType));
    expect([...types]).toEqual(["Observation"]);
    // Blood pressure, heart rate, weight, height, BMI and the released FBS.
    expect(res.body.total).toBe(6);
  });

  it("answers errors with OperationOutcome", async () => {
    const outcome = (body: { issue: Array<{ code: string }> }) => body.issue[0]!.code;
    const denied = await get(`/Patient/${patientId}`, doctor)
      .expect(403)
      .expect("content-type", /application\/fhir\+json/);
    expect(denied.body.resourceType).toBe("OperationOutcome");
    expect(outcome(denied.body)).toBe("forbidden");
    expect(outcome((await ctx.http().get(`/api/v1/fhir/r4/Patient/${patientId}`).expect(401)).body)).toBe("login");
    expect(outcome((await get("/Observation").expect(400)).body)).toBe("invalid");
    expect(outcome((await get(`/Medication?patient=${patientId}`).expect(404)).body)).toBe("not-found");

    // Another organization's patient does not exist here.
    const other = await createTenant(ctx.pool, "fhir-other");
    await createStaff(ctx.pool, other, "admin@other.ph", ["org_admin"]);
    const otherAdmin = (await login(ctx, "admin@other.ph")).accessToken;
    const hidden = await ctx.http().get(`/api/v1/fhir/r4/Patient/${patientId}/$everything`).set(as(otherAdmin, other.facilityId)).expect(404);
    expect(outcome(hidden.body)).toBe("not-found");
    for (const e of [schemaErrors(denied.body), schemaErrors(hidden.body)]) expect(e).toEqual([]);
  });
});
