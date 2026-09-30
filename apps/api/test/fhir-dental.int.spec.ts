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
function schemaErrors(resource: { resourceType: string }) {
  let validate = validators.get(resource.resourceType);
  if (!validate) {
    validate = fhir.ajv.compile({ $schema: fhir.schema.$schema, definitions: fhir.schema.definitions, $ref: `#/definitions/${resource.resourceType}` });
    validators.set(resource.resourceType, validate);
  }
  return validate(resource) ? [] : (validate.errors ?? []);
}

interface Coding {
  system?: string;
  code?: string;
  display?: string;
}
interface Resource {
  resourceType: string;
  id: string;
  status?: string;
  meta?: { lastUpdated?: string };
  code?: { coding?: Coding[] };
  bodySite?: { coding?: Coding[] } | Array<{ coding?: Coding[] }>;
  [key: string]: unknown;
}
interface Bundle extends Resource {
  total: number;
  link: Array<{ relation: string; url: string }>;
  entry?: Array<{ fullUrl: string; resource: Resource & { issue?: Array<{ code: string; diagnostics: string }> }; search: { mode: string } }>;
}

/**
 * The dental record through the read-only FHIR R4 interface (docs/interoperability/fhir.md#dental-record): procedures
 * (Procedure), treatment plans (CarePlan), the examination, the current chart and periodontal charts (Observation),
 * and dental images (DocumentReference) — schema-valid, local code systems, entered in error kept as such, gated by
 * dental.record.read (and document.read for images), audited like every FHIR read.
 */
describe("FHIR R4 export of the dental record", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let dentist: string;
  let noDental: string;
  let dentistPractitioner: string;
  let patientId: string;
  let encounterId: string;
  const ids: Record<string, string> = {};

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const get = (url: string, token = admin) => api(token).get(`/fhir/r4${url}`);
  const matches = (b: Bundle) => (b.entry ?? []).filter((e) => e.search.mode === "match").map((e) => e.resource);
  const notices = (b: Bundle) => (b.entry ?? []).filter((e) => e.search.mode === "outcome").map((e) => e.resource.issue?.[0]?.diagnostics);
  const codeOf = (r: { coding?: Coding[] } | undefined) => r?.coding?.[0];

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "fhir-dental-org");
    await createStaff(ctx.pool, tenant, "admin@fhirdental.ph", ["org_admin"]);
    ({ practitionerId: dentistPractitioner } = await createClinician(ctx, tenant, "dentist@fhirdental.ph", ["dentist"], "dentist"));
    await createStaff(ctx.pool, tenant, "assistant@fhirdental.ph", ["dental_assistant"]);
    admin = (await login(ctx, "admin@fhirdental.ph")).accessToken;
    dentist = (await login(ctx, "dentist@fhirdental.ph")).accessToken;
    const assistant = (await login(ctx, "assistant@fhirdental.ph")).accessToken;
    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
    encounterId = (await api(dentist).post("/encounters", { patientId, chiefComplaint: "Toothache" }).expect(201)).body.id;

    const type = async (body: object) => (await api(admin).post("/dental/procedure-types", body).expect(201)).body.id as string;
    const composite = await type({ code: "d-resin", name: "Composite restoration", site: "surface", chartEffect: "restoration" });
    const extraction = await type({ code: "d-ext", name: "Extraction", site: "tooth", chartEffect: "missing" });
    const prophylaxis = await type({ code: "d-proph", name: "Oral prophylaxis", site: "mouth" });

    // Examination: 16 caries MO, 26 root canal treated, 36 sound; oral hygiene fair.
    ids.exam = (
      await api(dentist)
        .post(`/dental/patients/${patientId}/examinations`, {
          encounterId,
          oralHygiene: "fair",
          notes: "Gingiva slightly inflamed",
          teeth: [
            { tooth: "16", findings: [{ condition: "caries", surfaces: ["M", "O"] }] },
            { tooth: "26", findings: [{ condition: "root_canal", surfaces: [] }] },
            { tooth: "36", findings: [] },
          ],
        })
        .expect(201)
    ).body.id;

    // Plan: composite 16 MO and prophylaxis accepted, extraction 38 declined.
    const plan = (
      await api(dentist)
        .post("/dental/treatment-plans", {
          patientId,
          title: "Restorative plan",
          items: [
            { phase: 1, procedureTypeId: composite, tooth: "16", surfaces: ["M", "O"] },
            { phase: 1, procedureTypeId: prophylaxis },
            { phase: 2, procedureTypeId: extraction, tooth: "38", note: "If it erupts badly" },
          ],
        })
        .expect(201)
    ).body;
    ids.plan = plan.id;
    const [compositeItem, prophyItem] = plan.items as Array<{ id: string }>;
    await api(dentist)
      .post(`/dental/treatment-plans/${ids.plan}/decision`, {
        acceptedItemIds: [compositeItem!.id, prophyItem!.id],
        note: "Options and fees explained",
        version: plan.version,
      })
      .expect(200);

    // A completed procedure (carrying out the plan item), and one entered in error.
    ids.procedure = (
      await api(dentist)
        .post(`/dental/patients/${patientId}/procedures`, {
          encounterId,
          procedureTypeId: composite,
          tooth: "16",
          surfaces: ["O", "M"],
          planItemId: compositeItem!.id,
          notes: "Shade A2",
        })
        .expect(201)
    ).body.id;
    ids.wrongProcedure = (
      await api(dentist).post(`/dental/patients/${patientId}/procedures`, { encounterId, procedureTypeId: extraction, tooth: "48" }).expect(201)
    ).body.id;
    await api(dentist).post(`/dental/procedures/${ids.wrongProcedure}/entered-in-error`, { reason: "Recorded for the wrong tooth" }).expect(200);

    // A periodontal chart.
    ids.perio = (
      await api(dentist)
        .post(`/dental/patients/${patientId}/perio-charts`, {
          encounterId,
          notes: "Localised pockets",
          teeth: [
            {
              tooth: "16",
              mobility: 1,
              furcation: 2,
              sites: [
                { site: "MB", probingDepth: 5, gingivalMargin: 1, bleeding: true },
                { site: "B", probingDepth: 3, gingivalMargin: 0 },
              ],
            },
            { tooth: "11", sites: [{ site: "B", probingDepth: 2 }] },
          ],
        })
        .expect(201)
    ).body.id;

    // A radiograph: a private imaging document described by the dental record.
    const created = await api(assistant)
      .post("/documents", { category: "imaging", title: "Bitewing right", fileName: "bw-right.jpg", contentType: "image/jpeg", sizeBytes: 4096, patientId })
      .expect(201);
    ids.document = created.body.document.id;
    const { rows } = await ctx.pool.query<{ storage_key: string }>("SELECT storage_key FROM document WHERE id = $1", [ids.document]);
    ctx.storage.put(rows[0]!.storage_key, { sizeBytes: 4096, contentType: "image/jpeg" });
    await api(assistant).post(`/documents/${ids.document}/complete`).expect(200);
    ids.image = (
      await api(assistant)
        .post(`/dental/patients/${patientId}/images`, { documentId: ids.document, kind: "bitewing", teeth: ["16", "46"], takenOn: manilaDate(0), encounterId })
        .expect(201)
    ).body.id;

    // An integration account that may read FHIR and documents, but not the dental record.
    const integrationUser = await createStaff(ctx.pool, tenant, "integration@fhirdental.ph", []);
    const role = await ctx.pool.query(`INSERT INTO role (organization_id, key, name) VALUES ($1, 'fhir_no_dental', 'FHIR without dental') RETURNING id`, [
      tenant.organizationId,
    ]);
    await ctx.pool.query(`INSERT INTO role_permission (role_id, permission_key) VALUES ($1, 'interop.fhir.read'), ($1, 'document.read')`, [role.rows[0].id]);
    await ctx.pool.query(`INSERT INTO role_assignment (organization_id, user_id, role_id) VALUES ($1, $2, $3)`, [
      tenant.organizationId,
      integrationUser,
      role.rows[0].id,
    ]);
    noDental = (await login(ctx, "integration@fhirdental.ph")).accessToken;
  });
  afterAll(() => ctx.close());

  it("exports the dental record in $everything, schema-valid, with every reference resolved", async () => {
    const bundle = (await get(`/Patient/${patientId}/$everything?_count=200`).expect(200)).body as Bundle;
    expect(schemaErrors(bundle)).toEqual([]);
    for (const { resource } of bundle.entry ?? [])
      expect({ id: `${resource.resourceType}/${resource.id}`, errors: schemaErrors(resource) }).toEqual({
        id: `${resource.resourceType}/${resource.id}`,
        errors: [],
      });
    const present = new Set((bundle.entry ?? []).map((e) => `${e.resource.resourceType}/${e.resource.id}`));
    const references = [...JSON.stringify(bundle).matchAll(/"reference":"([A-Za-z]+\/[^"]+)"/g)].map((m) => m[1]);
    expect(references.filter((r) => !present.has(r!))).toEqual([]);
    expect(present.has(`Practitioner/${dentistPractitioner}`)).toBe(true);
    expect(notices(bundle)).toEqual([]);

    const byId = (id: string) => matches(bundle).find((r) => r.id === id)!;
    // Procedures: the organization's own code in a local code system, the FDI tooth and surfaces, entered in error kept.
    const procedure = byId(ids.procedure!);
    expect(procedure).toMatchObject({
      resourceType: "Procedure",
      status: "completed",
      encounter: { reference: `Encounter/${encounterId}` },
      performer: [{ actor: { reference: `Practitioner/${dentistPractitioner}` } }],
      basedOn: [{ reference: `CarePlan/${ids.plan}` }],
      note: [{ text: "Shade A2" }],
    });
    expect(codeOf(procedure.code)).toMatchObject({ code: "d-resin", display: "Composite restoration" });
    expect(codeOf(procedure.code)?.system).toMatch(/\/fhir-dental-org\/codesystem\/dental-procedure$/);
    expect((procedure.bodySite as Array<{ coding?: Coding[] }>).map((b) => [b.coding?.[0]?.system?.split("/").pop(), b.coding?.[0]?.code])).toEqual([
      ["fdi-tooth", "16"],
      ["tooth-surface", "M"],
      ["tooth-surface", "O"],
    ]);
    expect(byId(ids.wrongProcedure!)).toMatchObject({ resourceType: "Procedure", status: "entered-in-error" });

    // The treatment plan with the patient's decision per item and the performed procedure as outcome.
    const plan = byId(ids.plan!) as Resource & {
      activity: Array<{ detail: { code: { coding: Coding[] }; status: string; statusReason?: { text: string } }; outcomeReference?: unknown }>;
    };
    expect(plan).toMatchObject({ resourceType: "CarePlan", status: "active", category: [{ text: "dental" }], title: "Restorative plan" });
    const activities = Object.fromEntries(
      plan.activity.map((a) => [a.detail.code.coding[0]!.code, [a.detail.status, a.detail.statusReason?.text, a.outcomeReference]]),
    );
    expect(activities).toEqual({
      "d-resin": ["completed", undefined, [{ reference: `Procedure/${ids.procedure}` }]],
      "d-proph": ["not-started", "Accepted by the patient", undefined],
      "d-ext": ["cancelled", "Declined by the patient", undefined],
    });

    // Examination and the current chart: 16 restored by the procedure, 26 and 36 as examined; 48 (in error) absent.
    const exam = byId(ids.exam!);
    expect(exam).toMatchObject({ resourceType: "Observation", status: "final", note: [{ text: "Gingiva slightly inflamed" }] });
    const toothStates = matches(bundle).filter((r) => codeOf(r.code)?.code === "tooth-state");
    const chart = Object.fromEntries(
      toothStates.map((r) => [
        codeOf(r.bodySite as { coding?: Coding[] })?.code,
        ((r["component"] as Array<{ code: { coding: Coding[] }; valueCodeableConcept?: { coding: Coding[] }; valueBoolean?: boolean }>) ?? []).map((c) => [
          c.code.coding[0]!.code,
          c.valueCodeableConcept?.coding[0]!.code ?? c.valueBoolean,
        ]),
      ]),
    );
    expect(chart).toEqual({
      "16": [
        ["restoration", "M"],
        ["restoration", "O"],
      ],
      "26": [["root_canal", true]],
      "36": [],
    });
    const sound = toothStates.find((r) => codeOf(r.bodySite as { coding?: Coding[] })?.code === "36")!;
    expect(codeOf(sound["valueCodeableConcept"] as { coding?: Coding[] })?.code).toBe("sound");
    expect(toothStates.find((r) => codeOf(r.bodySite as { coding?: Coding[] })?.code === "16")!["partOf"]).toEqual([
      { reference: `Procedure/${ids.procedure}` },
    ]);

    // The periodontal chart: a panel and one Observation per tooth with a component per site measurement.
    const panel = byId(ids.perio!) as Resource & { hasMember: Array<{ reference: string }> };
    expect(panel.hasMember).toHaveLength(2);
    const perio16 = matches(bundle).find(
      (r) => panel.hasMember.some((m) => m.reference === `Observation/${r.id}`) && codeOf(r.bodySite as { coding?: Coding[] })?.code === "16",
    )!;
    const values = Object.fromEntries(
      (perio16["component"] as Array<{ code: { coding: Coding[] }; valueQuantity?: { value: number }; valueInteger?: number; valueBoolean?: boolean }>).map(
        (c) => [c.code.coding[0]!.code, c.valueQuantity?.value ?? c.valueInteger ?? c.valueBoolean],
      ),
    );
    expect(values).toMatchObject({
      "tooth-mobility": 1,
      furcation: 2,
      "probing-depth-MB": 5,
      "gingival-margin-MB": 1,
      "bleeding-on-probing-MB": true,
      "probing-depth-B": 3,
    });

    // The radiograph: a DocumentReference with the dental description and the usual Binary content.
    const image = byId(ids.document!);
    expect(image).toMatchObject({
      resourceType: "DocumentReference",
      status: "current",
      description: "Bitewing right (teeth 16, 46, FDI)",
      context: { encounter: [{ reference: `Encounter/${encounterId}` }], period: { start: manilaDate(0) } },
    });
    expect(codeOf((image["category"] as Array<{ coding?: Coding[] }>)[0])).toMatchObject({ code: "bitewing", display: "Bitewing radiograph" });

    const audit = await auditRows(ctx.pool, "action = 'fhir.patient-everything' AND patient_id = $1", [patientId]);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ resources: bundle.total, total: bundle.total });
    expect((audit[0]!.metadata as { resourceTypes: string[] }).resourceTypes).toEqual(
      expect.arrayContaining(["Procedure", "CarePlan", "Observation", "DocumentReference"]),
    );
  });

  it("searches Procedure by patient, paged and with _lastUpdated; dental items appear in the Observation, CarePlan and DocumentReference searches", async () => {
    const all = (await get(`/Procedure?patient=${patientId}`).expect(200)).body as Bundle;
    expect(schemaErrors(all)).toEqual([]);
    expect(all.total).toBe(2);
    const first = (await get(`/Procedure?patient=Patient/${patientId}&_count=1`).expect(200)).body as Bundle;
    expect(matches(first)).toHaveLength(1);
    const next = first.link.find((l) => l.relation === "next")!.url;
    const second = (await get(new URL(next).pathname.replace("/api/v1/fhir/r4", "") + new URL(next).search).expect(200)).body as Bundle;
    expect([...matches(first), ...matches(second)].map((r) => r.id).sort()).toEqual([ids.procedure, ids.wrongProcedure].sort());

    // The procedure in error changed when it was marked: both were updated today (Manila); none after.
    expect(((await get(`/Procedure?patient=${patientId}&_lastUpdated=ge${manilaDate(0)}`).expect(200)).body as Bundle).total).toBe(2);
    expect(((await get(`/Procedure?patient=${patientId}&_lastUpdated=ge${manilaDate(1)}`).expect(200)).body as Bundle).total).toBe(0);
    expect((await get(`/Observation?patient=${patientId}&_lastUpdated=ge${manilaDate(0)}`).expect(400)).body.issue[0].code).toBe("not-supported");

    const observations = (await get(`/Observation?patient=${patientId}`).expect(200)).body as Bundle;
    expect(observations.total).toBe(1 + 3 + 3); // examination + chart (16, 26, 36) + perio panel and two teeth
    const carePlans = (await get(`/CarePlan?patient=${patientId}`).expect(200)).body as Bundle;
    expect(matches(carePlans).map((r) => r.id)).toEqual([ids.plan]);
    const documents = (await get(`/DocumentReference?patient=${patientId}`).expect(200)).body as Bundle;
    expect(matches(documents).map((r) => r.id)).toEqual([ids.document]);

    const audit = await auditRows(ctx.pool, "action = 'fhir.search' AND patient_id = $1 AND metadata->'resourceTypes' ? 'Procedure'", [patientId]);
    expect(audit.length).toBeGreaterThanOrEqual(4);
    expect(audit.every((a) => a.actor_type === "user" && a.outcome === "success")).toBe(true);
  });

  it("marks a dental image entered in error on its DocumentReference", async () => {
    await api(dentist).post(`/dental/images/${ids.image}/entered-in-error`, { reason: "Wrong patient's radiograph" }).expect(200);
    const documents = (await get(`/DocumentReference?patient=${patientId}`).expect(200)).body as Bundle;
    const [image] = matches(documents);
    expect(image).toMatchObject({ id: ids.document, status: "entered-in-error" });
    expect(schemaErrors(image!)).toEqual([]);
    const { rows } = await ctx.pool.query<{ entered_in_error_at: Date }>("SELECT entered_in_error_at FROM dental_image WHERE id = $1", [ids.image]);
    expect(image!.meta?.lastUpdated).toBe(rows[0]!.entered_in_error_at.toISOString());
  });

  it("withholds the dental record from an account without dental.record.read, with a notice; images stay with the documents", async () => {
    const everything = (await get(`/Patient/${patientId}/$everything?_count=200`, noDental).expect(200)).body as Bundle;
    expect(schemaErrors(everything)).toEqual([]);
    const types = matches(everything).map((r) => r.resourceType);
    expect(types).not.toContain("Procedure");
    expect(types).not.toContain("CarePlan");
    expect(types).not.toContain("Observation");
    expect(types).toContain("DocumentReference");
    expect(notices(everything)).toEqual([expect.stringContaining("dental.record.read")]);

    // Procedures also hold the patient history's past procedures, so the search answers, with the dental ones withheld.
    const procedures = (await get(`/Procedure?patient=${patientId}`, noDental).expect(200)).body as Bundle;
    expect(procedures.total).toBe(0);
    expect(notices(procedures)).toEqual([expect.stringContaining("dental.record.read")]);
    const observations = (await get(`/Observation?patient=${patientId}`, noDental).expect(200)).body as Bundle;
    expect(observations.total).toBe(0);
    expect(notices(observations)).toEqual([expect.stringContaining("dental.record.read")]);
    expect(schemaErrors(observations)).toEqual([]);
    expect(notices((await get(`/Encounter?patient=${patientId}`, noDental).expect(200)).body as Bundle)).toEqual([]);

    // Audited as any read: what was disclosed (no dental types for this account).
    const everythingAudit = await auditRows(ctx.pool, "action = 'fhir.patient-everything' AND patient_id = $1", [patientId]);
    expect(everythingAudit).toHaveLength(2);
    expect((everythingAudit[1]!.metadata as { resourceTypes: string[] }).resourceTypes).not.toContain("Procedure");
  });

  it("declares Procedure (with _lastUpdated) and the dental permission in the CapabilityStatement", async () => {
    const capability = (await get("/metadata").expect(200)).body as {
      rest: Array<{ security: { description: string }; resource: Array<{ type: string; searchParam?: Array<{ name: string }> }> }>;
    };
    const procedure = capability.rest[0]!.resource.find((r) => r.type === "Procedure");
    expect(procedure?.searchParam?.map((p) => p.name)).toEqual(["patient", "_lastUpdated"]);
    expect(capability.rest[0]!.security.description).toContain("dental.record.read");
  });
});
