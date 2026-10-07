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
  entry?: Array<{ fullUrl: string; resource: Resource; search: { mode: string } }>;
}

const TAG = { system: expect.stringMatching(/\/fhirx\/codesystem\/record-source$/), code: "external-import", display: "Imported from another system" };

/**
 * FHIR R4 export of send-out results (performed by a reference laboratory), allergies accepted from imports and the
 * patient's external history (docs/interoperability/fhir.md): schema-valid, flagged as externally sourced, never
 * presented as the platform's own records, audited like every FHIR access.
 */
describe("FHIR R4 export: reference laboratories and records from other systems", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let integration: string;
  let patientId: string;
  let referenceLabId: string;
  let tshResultId: string;
  let fbsResultId: string;
  let orderId: string;
  let importedAllergyId: string;
  const external: Record<"condition" | "conditionInError" | "observation" | "medication" | "document", string> = {
    condition: "",
    conditionInError: "",
    observation: "",
    medication: "",
    document: "",
  };

  const get = (url: string, token = admin) => ctx.http().get(`/api/v1/fhir/r4${url}`).set(as(token, tenant.facilityId));
  const api = (token: string) => ({
    get: (path: string) => ctx.http().get(`/api/v1${path}`).set(as(token, tenant.facilityId)),
    post: (path: string, body: object = {}) => ctx.http().post(`/api/v1${path}`).set(as(token, tenant.facilityId)).send(body),
    put: (path: string, body: object = {}) => ctx.http().put(`/api/v1${path}`).set(as(token, tenant.facilityId)).send(body),
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "fhirx");
    const adminUserId = await createStaff(ctx.pool, tenant, "admin@fhirx.ph", ["org_admin"]);
    const { practitionerId, userId: doctorUserId } = await createClinician(ctx, tenant, "santos@fhirx.ph", ["physician"]);
    await createStaff(ctx.pool, tenant, "medtech@fhirx.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "medtech2@fhirx.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "patho@fhirx.ph", ["pathologist"]);
    const token = async (who: string) => (await login(ctx, `${who}@fhirx.ph`)).accessToken;
    admin = await token("admin");
    const [doctor, medtech, medtech2, pathologist] = [await token("santos"), await token("medtech"), await token("medtech2"), await token("patho")];
    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
    const q = (sql: string, params: unknown[]) => ctx.pool.query(sql, params);
    const encounterId = (
      await q(`INSERT INTO encounter (organization_id, facility_id, patient_id, practitioner_id, started_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [
        tenant.organizationId,
        tenant.facilityId,
        patientId,
        practitionerId,
        doctorUserId,
      ])
    ).rows[0].id;

    // Laboratory: TSH is referred out to a reference laboratory, FBS is performed in-house; both on one order.
    const chem = (await api(pathologist).post("/laboratory/departments", { code: "chem", name: "Clinical Chemistry" }).expect(201)).body.id;
    const serum = (await api(pathologist).post("/laboratory/specimen-types", { code: "serum", name: "Serum" }).expect(201)).body.id;
    const numeric = { departmentId: chem, specimenTypeId: serum, resultType: "numeric", decimalPlaces: 2 };
    const tsh = (
      await api(pathologist)
        .post("/laboratory/tests", { ...numeric, code: "tsh", name: "Thyroid stimulating hormone", unit: "mIU/L" })
        .expect(201)
    ).body.id;
    const fbs = (
      await api(pathologist)
        .post("/laboratory/tests", { ...numeric, code: "fbs", name: "Fasting blood sugar", unit: "mmol/L" })
        .expect(201)
    ).body.id;
    referenceLabId = (
      await api(pathologist)
        .post("/laboratory/reference-labs", { code: "metro-ref", name: "Metro Reference Laboratory", accreditationReference: "DOH-LIC-TEST-001" })
        .expect(201)
    ).body.id;
    await api(pathologist).put(`/laboratory/referrals/${tsh}`, { referenceLaboratoryId: referenceLabId }).expect(200);
    const order = await api(doctor)
      .post("/laboratory/orders", { patientId, encounterId, testIds: [tsh, fbs] })
      .expect(201);
    orderId = order.body.id;
    const items = Object.fromEntries(order.body.items.map((i: { testCode: string; id: string }) => [i.testCode, i.id])) as Record<string, string>;
    const specimen = (
      await api(medtech)
        .post(`/laboratory/orders/${orderId}/specimens`, { specimenTypeId: serum, itemIds: Object.values(items) })
        .expect(201)
    ).body.specimens[0].id;
    await api(medtech).post(`/laboratory/specimens/${specimen}/receive`).expect(200);
    const sendOutId = (await api(medtech).get("/laboratory/send-outs?view=to_dispatch").expect(200)).body[0].id;
    await api(medtech)
      .post("/laboratory/send-out-dispatches", { sendOutIds: [sendOutId], courier: "Lab rider" })
      .expect(201);
    await api(medtech).post(`/laboratory/send-outs/${sendOutId}/results-received`, { referenceAccession: "MRL-26-0001" }).expect(200);
    const release = async (itemId: string, value: number) => {
      const id = (await api(medtech).post(`/laboratory/order-items/${itemId}/results`, { valueNumeric: value }).expect(201)).body.id as string;
      await api(medtech2).post(`/laboratory/results/${id}/verify`).expect(200);
      await api(pathologist).post(`/laboratory/results/${id}/approve`).expect(200);
      await api(pathologist).post(`/laboratory/results/${id}/release`).expect(200);
      return id;
    };
    tshResultId = await release(items["tsh"]!, 2.1);
    fbsResultId = await release(items["fbs"]!, 5.0);

    // An allergy recorded by staff, and one accepted from an import (the import flow itself: fhir-import.int.spec.ts).
    await api(admin).post(`/patients/${patientId}/allergies`, { category: "medication", substance: "Penicillin", reaction: "Hives" }).expect(201);
    importedAllergyId = (
      await q(
        `INSERT INTO allergy_intolerance (organization_id, patient_id, category, substance, substance_normalized, reaction, criticality,
           source, source_reference, recorded_by, updated_by)
         VALUES ($1, $2, 'food', 'Shrimp', 'shrimp', 'Urticaria', 'low', 'external_import', 'fhir-import:test#1', $3, $3) RETURNING id`,
        [tenant.organizationId, patientId, adminUserId],
      )
    ).rows[0].id;

    // External history accepted from imports.
    const history = async (fields: Record<string, string | null>) =>
      (
        await q(
          `INSERT INTO external_history_entry (organization_id, patient_id, kind, category, display, code_system, code, value_text, status_text,
             effective_text, source_reference, declared_source, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'fhir-import:test#2', 'https://hospital.test.invalid/fhir', $11) RETURNING id`,
          [
            tenant.organizationId,
            patientId,
            fields["kind"],
            fields["category"] ?? null,
            fields["display"],
            fields["codeSystem"] ?? null,
            fields["code"] ?? null,
            fields["valueText"] ?? null,
            fields["statusText"] ?? null,
            fields["effectiveText"] ?? null,
            adminUserId,
          ],
        )
      ).rows[0].id as string;
    external.condition = await history({
      kind: "condition",
      category: "problem-list-item",
      display: "Type 2 diabetes mellitus",
      codeSystem: "http://hl7.org/fhir/sid/icd-10",
      code: "E11.9",
      statusText: "active",
      effectiveText: "2019-05",
    });
    external.conditionInError = await history({ kind: "condition", display: "Asthma", statusText: "active" });
    await q(
      `UPDATE external_history_entry SET status = 'entered_in_error', entered_in_error_reason = 'Another patient''s record', entered_in_error_by = $2,
         entered_in_error_at = now() WHERE id = $1`,
      [external.conditionInError, adminUserId],
    );
    external.observation = await history({
      kind: "observation",
      category: "laboratory",
      display: "Hemoglobin A1c",
      codeSystem: "http://loinc.org",
      code: "4548-4",
      valueText: "7.2 %",
      statusText: "final",
      effectiveText: "2026-08-01T08:00:00+08:00",
    });
    external.medication = await history({
      kind: "medication",
      category: "reported",
      display: "Metformin 500 mg tablet",
      valueText: "1 tablet twice daily",
      statusText: "active",
    });
    external.document = await history({
      kind: "document",
      category: "Discharge summary",
      display: "Discharge summary, Hospital X",
      valueText: "summary.pdf, application/pdf, 120 KB (file not imported)",
      statusText: "current",
      effectiveText: "2026-07-01T10:00:00+08:00",
    });

    // An integration account that may read FHIR but not documents.
    const integrationUser = await createStaff(ctx.pool, tenant, "integration@fhirx.ph", []);
    const role = await q(`INSERT INTO role (organization_id, key, name) VALUES ($1, 'fhir_integration', 'FHIR integration') RETURNING id`, [
      tenant.organizationId,
    ]);
    await q(`INSERT INTO role_permission (role_id, permission_key) VALUES ($1, 'interop.fhir.read')`, [role.rows[0].id]);
    await q(`INSERT INTO role_assignment (organization_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenant.organizationId, integrationUser, role.rows[0].id]);
    integration = await token("integration");
  });

  afterAll(() => ctx.close());

  const resources = (bundle: Bundle) => (bundle.entry ?? []).map((e) => e.resource);
  const byId = (bundle: Bundle, id: string) => resources(bundle).find((r) => r.id === id)!;

  it("exports a send-out result with the reference laboratory as its contained performer; in-house results are unchanged", async () => {
    const bundle = (await get(`/Patient/${patientId}/$everything`).expect(200)).body as Bundle;
    expect(schemaErrors(bundle)).toEqual([]);
    for (const r of resources(bundle)) expect({ id: `${r.resourceType}/${r.id}`, errors: schemaErrors(r) }).toMatchObject({ errors: [] });

    const tsh = byId(bundle, tshResultId);
    // No accreditation identifier: no identifier system is configured for it.
    expect(tsh["contained"]).toEqual([
      { resourceType: "Organization", id: `reference-lab-${referenceLabId}`, type: [{ text: "Reference laboratory" }], name: "Metro Reference Laboratory" },
    ]);
    expect(tsh["performer"]).toEqual([{ reference: `#reference-lab-${referenceLabId}`, display: "Metro Reference Laboratory" }]);
    expect(JSON.stringify(bundle)).not.toContain("DOH-LIC-TEST-001");
    const fbs = byId(bundle, fbsResultId);
    expect(fbs["performer"]).toEqual([{ reference: `Organization/${tenant.organizationId}` }]);
    expect(fbs).not.toHaveProperty("contained");
    const report = byId(bundle, orderId);
    expect(report).toMatchObject({ resourceType: "DiagnosticReport", status: "final" });
    expect(report["performer"]).toEqual([
      { reference: `Organization/${tenant.organizationId}` },
      { reference: `#reference-lab-${referenceLabId}`, display: "Metro Reference Laboratory" },
    ]);
  });

  it("flags an imported allergy as externally sourced and unconfirmed; the staff allergy is unchanged", async () => {
    const bundle = (await get(`/AllergyIntolerance?patient=${patientId}`).expect(200)).body as Bundle;
    expect(schemaErrors(bundle)).toEqual([]);
    expect(bundle.total).toBe(2);
    const imported = byId(bundle, importedAllergyId);
    expect(imported).toMatchObject({ meta: { tag: [TAG] }, verificationStatus: { coding: [{ code: "unconfirmed" }] }, code: { text: "Shrimp" } });
    const staff = resources(bundle).find((r) => r.id !== importedAllergyId)!;
    expect(staff).not.toHaveProperty("meta");
    const audit = await auditRows(ctx.pool, "action = 'fhir.search' AND patient_id = $1 AND metadata->'resourceTypes' ? 'AllergyIntolerance'", [patientId]);
    expect(audit).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ resources: 2, total: 2 }) })]);
  });

  it("includes the external history in $everything, tagged, mapped per kind, never as the platform's own records", async () => {
    const before = (await auditRows(ctx.pool, "action = 'fhir.patient-everything' AND patient_id = $1", [patientId])).length;
    const bundle = (await get(`/Patient/${patientId}/$everything`).expect(200)).body as Bundle;
    const condition = byId(bundle, external.condition);
    expect(condition).toMatchObject({
      resourceType: "Condition",
      meta: { tag: [TAG], source: "https://hospital.test.invalid/fhir", lastUpdated: expect.any(String) },
      clinicalStatus: { coding: [{ code: "active" }] },
      verificationStatus: { coding: [{ code: "unconfirmed" }] },
      code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "E11.9" }] },
      onsetDateTime: "2019-05",
    });
    expect(condition).not.toHaveProperty("encounter");
    const inError = byId(bundle, external.conditionInError);
    expect(inError).toMatchObject({ verificationStatus: { coding: [{ code: "entered-in-error" }] } });
    expect(inError).not.toHaveProperty("clinicalStatus");
    const observation = byId(bundle, external.observation);
    expect(observation).toMatchObject({ resourceType: "Observation", status: "final", valueString: "7.2 %", meta: { tag: [TAG] } });
    for (const property of ["performer", "issued", "basedOn", "encounter"]) expect(observation).not.toHaveProperty(property);
    expect(byId(bundle, external.medication)).toMatchObject({
      resourceType: "MedicationStatement",
      status: "active",
      medicationCodeableConcept: { text: "Metformin 500 mg tablet" },
      meta: { tag: [TAG] },
    });
    const document = byId(bundle, external.document);
    expect(document).toMatchObject({
      resourceType: "DocumentReference",
      status: "current",
      description: "Discharge summary, Hospital X",
      meta: { tag: [TAG] },
    });
    expect(document).not.toHaveProperty("custodian");
    expect(JSON.stringify(document)).not.toContain("Binary");
    // Nothing imported became an encounter, a laboratory order or a prescription.
    expect(
      resources(bundle)
        .filter((r) => ["Encounter", "ServiceRequest", "MedicationRequest"].includes(r.resourceType))
        .map((r) => r.resourceType),
    ).toEqual(["Encounter", "ServiceRequest", "ServiceRequest"]);

    const audit = await auditRows(ctx.pool, "action = 'fhir.patient-everything' AND patient_id = $1", [patientId]);
    expect(audit).toHaveLength(before + 1);
    expect(audit.at(-1)!.metadata).toMatchObject({
      resourceTypes: expect.arrayContaining(["Condition", "Observation", "MedicationStatement", "DocumentReference"]),
      resources: bundle.total,
      total: bundle.total,
    });
  });

  it("searches external history by type, paged, with _lastUpdated where reliable, audited", async () => {
    const search = async (url: string, token = admin) => {
      const bundle = (await get(url, token).expect(200)).body as Bundle;
      expect(schemaErrors(bundle)).toEqual([]);
      return bundle;
    };
    const statements = await search(`/MedicationStatement?patient=${patientId}`);
    expect(statements.total).toBe(1);
    expect(resources(statements).map((r) => r.id)).toEqual([external.medication]);
    expect((await search(`/MedicationStatement?patient=${patientId}&_lastUpdated=ge${manilaDate(-1)}`)).total).toBe(1);
    expect((await search(`/MedicationStatement?patient=${patientId}&_lastUpdated=le2000-01-01`)).total).toBe(0);
    const conditions = await search(`/Condition?patient=${patientId}`);
    expect(
      resources(conditions)
        .map((r) => r.id)
        .sort(),
    ).toEqual([external.condition, external.conditionInError].sort());
    const page = await search(`/Condition?patient=${patientId}&_count=1&_offset=1`);
    expect(page.total).toBe(2);
    expect(page.entry).toHaveLength(1);
    const documents = await search(`/DocumentReference?patient=${patientId}&_lastUpdated=ge${manilaDate(-1)}`);
    expect(resources(documents).map((r) => r.id)).toEqual([external.document]);
    const observations = await search(`/Observation?patient=${patientId}`);
    expect(observations.total).toBe(3); // TSH, FBS and the external HbA1c
    expect((await search(`/Observation?patient=${patientId}&_lastUpdated=ge${manilaDate(-1)}`)).total).toBe(3); // released results and the import all changed recently

    // Document descriptions are withheld with the documents from an account without document.read.
    const withheld = await search(`/Patient/${patientId}/$everything`, integration);
    expect(resources(withheld).some((r) => r.resourceType === "DocumentReference")).toBe(false);
    expect(resources(withheld).some((r) => r.id === external.medication)).toBe(true);

    const audit = await auditRows(ctx.pool, "action = 'fhir.search' AND patient_id = $1 AND metadata->'resourceTypes' ? 'MedicationStatement'", [patientId]);
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit.some((a) => (a.metadata as { lastUpdated?: object }).lastUpdated)).toBe(true);
  });

  it("declares MedicationStatement in the CapabilityStatement", async () => {
    const capability = (await get("/metadata").expect(200)).body;
    const statement = capability.rest[0].resource.find((r: { type: string }) => r.type === "MedicationStatement");
    expect(statement).toMatchObject({ interaction: [{ code: "search-type" }] });
    expect(statement.searchParam.map((p: { name: string }) => p.name)).toEqual(["patient", "_lastUpdated"]);
  });
});
