import { as, createClinician, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

// The official FHIR R4 JSON schema (bundled by this dev dependency); each resource is checked against its own type.
type Validate = ((data: unknown) => boolean) & { errors?: unknown[] | null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Validator = require("@asymmetrik/fhir-json-schema-validator") as new () => {
  ajv: { compile(schema: object): Validate };
  schema: { $schema: string; definitions: object };
};
const fhir = new Validator();
const validators = new Map<string, Validate>();
function schemaErrors(resource: { resourceType: string }) {
  let validate = validators.get(resource.resourceType);
  if (!validate) {
    validate = fhir.ajv.compile({ $schema: fhir.schema.$schema, definitions: fhir.schema.definitions, $ref: `#/definitions/${resource.resourceType}` });
    validators.set(resource.resourceType, validate);
  }
  return validate(resource) ? [] : (validate.errors ?? []);
}

interface Resource {
  resourceType: string;
  id: string;
  [key: string]: unknown;
}

/**
 * The dental record through the FHIR R4 interface (docs/interoperability/fhir.md#dental): performed procedures as
 * Procedure, current chart findings and periodontal measurements as Observations; schema-valid, references resolved.
 */
describe("FHIR export of the dental record", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let dentist: string;
  let patientId: string;
  let encounterId: string;
  let procedureId: string;
  let perioChartId: string;

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "fhir-dental-org");
    await createStaff(ctx.pool, tenant, "admin@fhirdental.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "dentist@fhirdental.ph", ["dentist"], "dentist");
    admin = (await login(ctx, "admin@fhirdental.ph")).accessToken;
    dentist = (await login(ctx, "dentist@fhirdental.ph")).accessToken;
    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
    encounterId = (await api(dentist).post("/encounters", { patientId, chiefComplaint: "Toothache" }).expect(201)).body.id;
    const composite = (
      await api(admin)
        .post("/dental/procedure-types", { code: "composite", name: "Composite restoration", site: "surface", chartEffect: "restoration" })
        .expect(201)
    ).body.id;
    await api(dentist)
      .post(`/dental/patients/${patientId}/examinations`, {
        encounterId,
        teeth: [
          { tooth: "16", findings: [{ condition: "caries", surfaces: ["M", "O"] }] },
          { tooth: "46", findings: [{ condition: "root_canal", surfaces: [] }] },
          { tooth: "11", findings: [] },
        ],
      })
      .expect(201);
    procedureId = (
      await api(dentist)
        .post(`/dental/patients/${patientId}/procedures`, { encounterId, procedureTypeId: composite, tooth: "16", surfaces: ["M", "O"] })
        .expect(201)
    ).body.id;
    perioChartId = (
      await api(dentist)
        .post(`/dental/patients/${patientId}/perio-charts`, {
          encounterId,
          teeth: [{ tooth: "16", mobility: 1, furcation: 1, sites: [{ site: "MB", probingDepth: 5, gingivalMargin: 1, bleeding: true }] }],
        })
        .expect(201)
    ).body.id;
  });
  afterAll(() => ctx.close());

  it("exports procedures, chart findings and periodontal measurements, valid against the official schema", async () => {
    const res = await api(admin).get(`/fhir/r4/Patient/${patientId}/$everything?_count=200`).expect(200);
    const resources = (res.body.entry as Array<{ resource: Resource }>).map((e) => e.resource);
    expect(schemaErrors(res.body)).toEqual([]);
    for (const r of resources) expect({ id: `${r.resourceType}/${r.id}`, errors: schemaErrors(r) }).toEqual({ id: `${r.resourceType}/${r.id}`, errors: [] });
    const present = new Set(resources.map((r) => `${r.resourceType}/${r.id}`));
    const references = [...JSON.stringify(res.body).matchAll(/"reference":"([A-Za-z]+\/[^"]+)"/g)].map((m) => m[1]);
    expect(references.filter((r) => !present.has(r!))).toEqual([]);

    const procedure = resources.find((r) => r.id === procedureId)!;
    expect(procedure).toMatchObject({
      resourceType: "Procedure",
      status: "completed",
      code: { coding: [expect.objectContaining({ code: "composite", display: "Composite restoration" })] },
      encounter: { reference: `Encounter/${encounterId}` },
      bodySite: [expect.objectContaining({ coding: [expect.objectContaining({ code: "16" })] }), expect.anything(), expect.anything()],
    });

    // The current chart: the procedure restored 16 MO (its caries there is gone); the examination charted 46; 11 is sound.
    const findings = resources.filter((r) => r.resourceType === "Observation" && JSON.stringify(r.code).includes("dental-finding"));
    expect(findings.map((f) => (f.code as { coding: Array<{ code: string }> }).coding[0]!.code).sort()).toEqual(["restoration", "root_canal"]);
    expect(findings.find((f) => JSON.stringify(f.code).includes("restoration"))).toMatchObject({ partOf: [{ reference: `Procedure/${procedureId}` }] });

    const perio = resources.find((r) => r.id === `${perioChartId}-16`)!;
    expect(perio).toMatchObject({ resourceType: "Observation", status: "final", bodySite: { coding: [expect.objectContaining({ code: "16" })] } });
    expect(perio.component).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.objectContaining({ coding: [expect.objectContaining({ code: "probing-depth-MB" })] }),
          valueQuantity: expect.objectContaining({ value: 5 }),
        }),
        expect.objectContaining({ valueBoolean: true }),
        expect.objectContaining({ valueInteger: 1 }),
      ]),
    );
  });

  it("searches Procedure by patient, filters it by _lastUpdated, and shows a corrected one as entered in error", async () => {
    const search = await api(admin).get(`/fhir/r4/Procedure?patient=${patientId}`).expect(200);
    expect(search.body.entry.map((e: { resource: Resource }) => e.resource.id)).toEqual([procedureId]);
    await api(dentist).post(`/dental/procedures/${procedureId}/entered-in-error`, { reason: "Recorded on the wrong tooth" }).expect(200);
    const later = await api(admin)
      .get(`/fhir/r4/Procedure?patient=${patientId}&_lastUpdated=ge${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`)
      .expect(200);
    expect(later.body.entry[0].resource).toMatchObject({ id: procedureId, status: "entered-in-error" });
    expect(schemaErrors(later.body.entry[0].resource)).toEqual([]);
    const capability = await api(admin).get("/fhir/r4/metadata").expect(200);
    const procedureType = capability.body.rest[0].resource.find((r: { type: string }) => r.type === "Procedure");
    expect(procedureType.searchParam.map((p: { name: string }) => p.name)).toEqual(["patient", "_lastUpdated"]);
  });
});
