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
  meta?: { lastUpdated?: string };
  [key: string]: unknown;
}
interface Bundle extends Resource {
  total: number;
  link: Array<{ relation: string; url: string }>;
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
  let vitalsId: string;
  let integration: string;
  let documentId: string;
  let archivedDocumentId: string;

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
    vitalsId = (
      await q(
        `INSERT INTO vital_sign_set (organization_id, facility_id, patient_id, encounter_id, measured_at, measured_by, systolic_mmhg, diastolic_mmhg, heart_rate_bpm, weight_kg, height_cm)
         VALUES ($1, $2, $3, $4, now(), $5, 130, 85, 82, 82, 168) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, patientId, encounterId, doctorUserId],
      )
    ).rows[0].id as string;
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

    // Documents: one available, one archived, one never uploaded.
    const upload = async (title: string, complete: boolean) => {
      const created = await staff(admin)
        .post("/api/v1/documents")
        .send({ category: "referral_letter", title, fileName: `${title}.pdf`, contentType: "application/pdf", sizeBytes: 4096, patientId })
        .expect(201);
      const id = created.body.document.id as string;
      if (complete) {
        const { rows } = await q(`SELECT storage_key FROM document WHERE id = $1`, [id]);
        ctx.storage.put(rows[0].storage_key, { sizeBytes: 4096, contentType: "application/pdf" });
        await staff(admin).post(`/api/v1/documents/${id}/complete`).expect(200);
      }
      return id;
    };
    documentId = await upload("Referral to cardiology", true);
    archivedDocumentId = await upload("Old referral", true);
    await staff(admin).post(`/api/v1/documents/${archivedDocumentId}/archive`).send({ reason: "Uploaded to the wrong patient" }).expect(200);
    await upload("Never uploaded", false);

    // An integration account that may read FHIR but not documents.
    const integrationUser = await createStaff(ctx.pool, tenant, "integration@fhir.ph", []);
    const role = await q(`INSERT INTO role (organization_id, key, name) VALUES ($1, 'fhir_integration', 'FHIR integration') RETURNING id`, [
      tenant.organizationId,
    ]);
    await q(`INSERT INTO role_permission (role_id, permission_key) VALUES ($1, 'interop.fhir.read')`, [role.rows[0].id]);
    await q(`INSERT INTO role_assignment (organization_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenant.organizationId, integrationUser, role.rows[0].id]);
    integration = (await login(ctx, "integration@fhir.ph")).accessToken;
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
        [
          "Patient",
          "Encounter",
          "Condition",
          "AllergyIntolerance",
          "MedicationRequest",
          "CarePlan",
          "ServiceRequest",
          "DiagnosticReport",
          "DocumentReference",
        ].map((t) => [t, count(t)]),
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
      DocumentReference: 1, // the available document only: not the archived one, not the pending upload
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
    expect(audit[0]!.metadata).toMatchObject({ resources: bundle.total, total: bundle.total, offset: 0 });
  });

  it("exports stored documents as DocumentReference whose content is an authenticated download on this endpoint", async () => {
    const res = await get(`/DocumentReference?patient=${patientId}`).expect(200);
    const bundle = res.body as Bundle;
    expect(schemaErrors(bundle)).toEqual([]);
    expect(bundle.entry.map((e) => e.resource.id)).toEqual([documentId]);
    const document = bundle.entry[0]!.resource;
    expect(schemaErrors(document)).toEqual([]);
    const attachment = (document.content as Array<{ attachment: { url: string; contentType: string; size: number; title: string } }>)[0]!.attachment;
    expect(attachment).toMatchObject({ contentType: "application/pdf", size: 4096, title: "Referral to cardiology.pdf" });
    expect(attachment.url).toMatch(new RegExp(`/api/v1/fhir/r4/Binary/${documentId}$`));
    expect(JSON.stringify(bundle)).not.toMatch(/memory:|org\/[0-9a-f-]+\/documents/); // no object-store URL or key

    // The content: a redirect to a short-lived signed download, audited like any document download.
    const path = new URL(attachment.url).pathname.replace("/api/v1/fhir/r4", "");
    const content = await get(path).expect(302);
    expect(content.headers["location"]).toContain(encodeURIComponent("Referral to cardiology.pdf"));
    expect(await auditRows(ctx.pool, "action = 'document.download' AND resource_id = $1", [documentId])).toHaveLength(1);
    await ctx.http().get(`/api/v1/fhir/r4${path}`).expect(401);
    expect((await get(`/Binary/${archivedDocumentId}`).expect(404)).body.resourceType).toBe("OperationOutcome");
  });

  it("withholds documents from an account without document.read", async () => {
    const everything = (await get(`/Patient/${patientId}/$everything`, integration).expect(200)).body as Bundle;
    expect(schemaErrors(everything)).toEqual([]);
    expect(everything.entry.some((e) => e.resource.resourceType === "DocumentReference")).toBe(false);
    // This account may read neither documents nor the dental record: one notice for each.
    expect(everything.entry.filter((e) => e.search.mode === "outcome").map((e) => e.resource.issue)).toEqual([
      [expect.objectContaining({ severity: "information", code: "suppressed", diagnostics: expect.stringContaining("document.read") })],
      [expect.objectContaining({ severity: "information", code: "suppressed", diagnostics: expect.stringContaining("dental.record.read") })],
    ]);
    const outcome = (body: { issue: Array<{ code: string }> }) => body.issue[0]!.code;
    expect(outcome((await get(`/DocumentReference?patient=${patientId}`, integration).expect(403)).body)).toBe("forbidden");
    expect(outcome((await get(`/Binary/${documentId}`, integration).expect(403)).body)).toBe("forbidden");
  });

  it("pages $everything and searches with _count/_offset, following next links, total always the full count", async () => {
    const all = (await get(`/Patient/${patientId}/$everything`).expect(200)).body as Bundle;
    // Paths only: the test server listens on a new port per request.
    const matchUrls = (b: Bundle) => b.entry.filter((e) => e.search.mode === "match").map((e) => new URL(e.fullUrl).pathname);
    const seen: string[] = [];
    let url: string | undefined = `/Patient/${patientId}/$everything?_count=4`;
    let pages = 0;
    while (url) {
      const page = (await get(url).expect(200)).body as Bundle;
      expect(schemaErrors(page)).toEqual([]);
      expect(page.total).toBe(all.total);
      expect(matchUrls(page).length).toBeLessThanOrEqual(4);
      seen.push(...matchUrls(page));
      const next = page.link.find((l) => l.relation === "next")?.url;
      if (pages > 0) expect(page.link.some((l) => l.relation === "previous")).toBe(false); // cursor pages carry no previous link
      url = next ? new URL(next).pathname.replace("/api/v1/fhir/r4", "") + new URL(next).search : undefined;
      pages++;
    }
    expect(pages).toBe(Math.ceil(all.total / 4));
    expect(seen).toEqual(matchUrls(all));
    expect(all.link.some((l) => l.relation === "next")).toBe(false);
    // One audit per page, with the cursor of every page after the first.
    const audits = await auditRows(ctx.pool, "action = 'fhir.patient-everything' AND patient_id = $1 AND (metadata->>'count')::int = 4", [patientId]);
    expect(audits).toHaveLength(pages);
    expect(audits.map((a) => (a.metadata as { resources: number }).resources).reduce((x, y) => x + y, 0)).toBe(all.total);
    expect(audits.filter((a) => "cursor" in (a.metadata as object))).toHaveLength(pages - 1);
    // Every next link carries a cursor, never an offset; a cursor not from this server, or with an offset, is invalid.
    const firstPage = (await get(`/Patient/${patientId}/$everything?_count=4`).expect(200)).body as Bundle;
    const next = firstPage.link.find((l) => l.relation === "next")!.url;
    expect(next).toContain("_cursor=");
    expect(next).not.toContain("_offset=");
    expect((await get(`/Patient/${patientId}/$everything?_cursor=nope`).expect(400)).body.issue[0].code).toBe("invalid");
    expect((await get(`/Patient/${patientId}/$everything?_offset=4&${new URL(next).searchParams.toString()}`).expect(400)).body.issue[0].code).toBe("invalid");

    const counted = (await get(`/Observation?patient=${patientId}&_count=0`).expect(200)).body as Bundle;
    expect(counted.total).toBe(6);
    expect(counted).not.toHaveProperty("entry");
    const outcome = (body: { issue: Array<{ code: string }> }) => body.issue[0]!.code;
    expect(outcome((await get(`/Observation?patient=${patientId}&_count=many`).expect(400)).body)).toBe("invalid");
    expect(outcome((await get(`/Patient/${patientId}/$everything?_since=2026-01-01T00:00:00Z`).expect(400)).body)).toBe("not-supported");
  });

  it("keeps cursor pages consistent while the record changes, and limits $everything with _type and _since", async () => {
    const matchUrls = (b: Bundle) => (b.entry ?? []).filter((e) => e.search.mode === "match").map((e) => new URL(e.fullUrl).pathname);
    const follow = (url: string) => new URL(url).pathname.replace("/api/v1/fhir/r4", "") + new URL(url).search;
    const first = (await get(`/Patient/${patientId}/$everything?_count=5`).expect(200)).body as Bundle;
    const before = (await get(`/Patient/${patientId}/$everything?_count=200`).expect(200)).body as Bundle;
    // Between two pages the vital signs are marked entered in error (they stay exported, now with a change time)
    // and a new diagnosis arrives: the walk neither repeats nor skips anything that was after the cursor.
    await staff(doctor).post(`/api/v1/vital-signs/${vitalsId}/entered-in-error`).send({ reason: "Wrong patient" }).expect(200);
    await ctx.pool.query(
      `INSERT INTO diagnosis (organization_id, patient_id, encounter_id, code_system_key, code, display, rank, certainty, is_chronic, recorded_by, updated_by)
       VALUES ($1, $2, $3, 'icd-10', 'J45.9', 'Asthma, unspecified', 'secondary', 'confirmed', true, $4, $4)`,
      [tenant.organizationId, patientId, encounterId, doctorUserId],
    );
    const seen = matchUrls(first);
    let url: string | undefined = first.link.find((l) => l.relation === "next")?.url;
    while (url) {
      const page = (await get(follow(url)).expect(200)).body as Bundle;
      expect(schemaErrors(page)).toEqual([]);
      expect(page.link.some((l) => l.relation === "previous")).toBe(false);
      seen.push(...matchUrls(page));
      url = page.link.find((l) => l.relation === "next")?.url;
    }
    const after = matchUrls((await get(`/Patient/${patientId}/$everything?_count=200`).expect(200)).body as Bundle);
    expect(new Set(seen).size).toBe(seen.length);
    const lastOfFirst = matchUrls(first).at(-1)!;
    expect(seen.slice(5)).toEqual(after.slice(after.indexOf(lastOfFirst) + 1));
    expect(after.length).toBe(before.total + 1);

    // _type limits the types (the Patient always first); _since needs _type naming reliable types.
    const typed = (await get(`/Patient/${patientId}/$everything?_type=Observation,MedicationRequest&_count=200`).expect(200)).body as Bundle;
    expect(schemaErrors(typed)).toEqual([]);
    const types = new Set((typed.entry ?? []).filter((e) => e.search.mode === "match").map((e) => e.resource.resourceType));
    expect([...types].sort()).toEqual(["MedicationRequest", "Observation", "Patient"]);
    const outcome = (body: { issue: Array<{ code: string }> }) => body.issue[0]!.code;
    expect(outcome((await get(`/Patient/${patientId}/$everything?_type=Encounter&_since=2026-01-01T00:00:00Z`).expect(400)).body)).toBe("not-supported");
    expect(outcome((await get(`/Patient/${patientId}/$everything?_type=Nonsense`).expect(400)).body)).toBe("invalid");
    const inAnHour = encodeURIComponent(new Date(Date.now() + 3600_000).toISOString());
    const nothing = (await get(`/Patient/${patientId}/$everything?_type=Observation&_since=${inAnHour}`).expect(200)).body as Bundle;
    expect(nothing.total).toBe(0);
    const lastHour = encodeURIComponent(new Date(Date.now() - 3600_000).toISOString());
    const recent = (await get(`/Patient/${patientId}/$everything?_type=Observation&_since=${lastHour}`).expect(200)).body as Bundle;
    expect(recent.total).toBeGreaterThan(0);
    expect((recent.entry ?? []).every((e) => e.search.mode !== "match" || e.resource.resourceType !== "Patient" || e.resource.meta?.lastUpdated)).toBe(true);
    const sinceAudit = await auditRows(ctx.pool, "action = 'fhir.patient-everything' AND patient_id = $1 AND metadata ? 'since'", [patientId]);
    expect(sinceAudit.length).toBeGreaterThanOrEqual(2);

    // Observation now takes _lastUpdated: the vital signs marked entered in error carry the time of that change.
    const vitals = (
      await get(`/Observation?patient=${patientId}&_lastUpdated=ge${encodeURIComponent(new Date(Date.now() - 600_000).toISOString())}`).expect(200)
    ).body as Bundle;
    const inError = (vitals.entry ?? []).filter((e) => e.resource.status === "entered-in-error");
    expect(inError.length).toBeGreaterThan(0);
    expect(inError.every((e) => Date.parse(e.resource.meta?.lastUpdated ?? "") >= Date.now() - 600_000)).toBe(true);
    expect(((await get(`/Observation?patient=${patientId}&_lastUpdated=le2000-01-01`).expect(200)).body as Bundle).total).toBe(0);
  });

  it("filters by _lastUpdated where records have a reliable last-updated time, and refuses it elsewhere", async () => {
    const total = async (url: string) => ((await get(url).expect(200)).body as Bundle).total;
    const yesterday = manilaDate(-1);
    expect(await total(`/MedicationRequest?patient=${patientId}&_lastUpdated=ge${yesterday}`)).toBe(1);
    expect(await total(`/MedicationRequest?patient=${patientId}&_lastUpdated=le2000-01-01`)).toBe(0);
    expect(await total(`/DocumentReference?patient=${patientId}&_lastUpdated=ge${yesterday}&_lastUpdated=le${manilaDate(1)}`)).toBe(1);
    expect(await total(`/DocumentReference?patient=${patientId}&_lastUpdated=ge${encodeURIComponent(new Date(Date.now() + 3600_000).toISOString())}`)).toBe(0);
    const refused = await get(`/Encounter?patient=${patientId}&_lastUpdated=ge${yesterday}`).expect(400);
    expect(refused.body.issue[0]).toMatchObject({ code: "not-supported" });
    expect(schemaErrors(refused.body)).toEqual([]);
    const audit = await auditRows(ctx.pool, "action = 'fhir.search' AND patient_id = $1 AND metadata ? 'lastUpdated'", [patientId]);
    expect(audit.length).toBeGreaterThanOrEqual(4);
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
