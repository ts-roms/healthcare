import {
  as,
  auditRows,
  createClinician,
  createStaff,
  createTenant,
  createTestApp,
  drainEvents,
  juan,
  login,
  manilaDate,
  type Tenant,
  type TestContext,
} from "./harness";

interface ChartTooth {
  tooth: string;
  findings: Array<{ condition: string; surfaces: string[] }>;
}

/**
 * Phase 6 dental (docs/domains/dental.md): procedure catalog and notation, examinations that append chart states,
 * the chart derived from history, treatment plans decided by the patient, procedures that change the chart, complete
 * plan items and are charged by billing, corrections that never delete, and imaging through private documents.
 */
describe("dental", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let dentist: string;
  let assistant: string;
  let physician: string;
  let desk: string;
  let cashier: string;
  let patientId: string;
  let otherPatientId: string;
  let encounterId: string;
  const ids: Record<string, string> = {};

  const api = (token: string, facilityId: string | undefined = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, facilityId)).send(body),
    patch: (url: string, body: object = {}) => ctx.http().patch(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });
  const record = async () => (await api(dentist).get(`/dental/patients/${patientId}`).expect(200)).body;
  const chartOf = async () => Object.fromEntries(((await record()).chart as ChartTooth[]).map((t) => [t.tooth, t.findings]));
  const planOf = async (planId: string) => (await api(dentist).get(`/dental/treatment-plans/${planId}`).expect(200)).body;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "dental-org");
    await createStaff(ctx.pool, tenant, "admin@dental.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "dentist@dental.ph", ["dentist"], "dentist");
    await createClinician(ctx, tenant, "doctor@dental.ph", ["physician"], "physician");
    await createStaff(ctx.pool, tenant, "assistant@dental.ph", ["dental_assistant"]);
    await createStaff(ctx.pool, tenant, "desk@dental.ph", ["receptionist"]);
    await createStaff(ctx.pool, tenant, "cashier@dental.ph", ["cashier"]);
    admin = (await login(ctx, "admin@dental.ph")).accessToken;
    dentist = (await login(ctx, "dentist@dental.ph")).accessToken;
    physician = (await login(ctx, "doctor@dental.ph")).accessToken;
    assistant = (await login(ctx, "assistant@dental.ph")).accessToken;
    desk = (await login(ctx, "desk@dental.ph")).accessToken;
    cashier = (await login(ctx, "cashier@dental.ph")).accessToken;
    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
    otherPatientId = (
      await api(admin)
        .post("/patients", { ...juan, givenName: "Maria", middleName: "Reyes", sex: "female", birthDate: "1991-07-19", contacts: [], identifiers: [] })
        .expect(201)
    ).body.id;
    encounterId = (await api(dentist).post("/encounters", { patientId, chiefComplaint: "Toothache" }).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  it("keeps the organization's procedure catalog and each facility's notation", async () => {
    await api(dentist).post("/dental/procedure-types", { code: "prophylaxis", name: "Oral prophylaxis", site: "mouth" }).expect(403);
    const invalid = await api(admin).post("/dental/procedure-types", { code: "bad", name: "Bad", site: "mouth", chartEffect: "crown" }).expect(422);
    expect(invalid.body.error.code).toBe("invalid_chart_effect");
    await api(admin).post("/dental/procedure-types", { code: "bad", name: "Bad", site: "tooth", chartEffect: "restoration" }).expect(422);
    const create = (body: object) => api(admin).post("/dental/procedure-types", body).expect(201);
    ids.prophylaxis = (await create({ code: "prophylaxis", name: "Oral prophylaxis", site: "mouth" })).body.id;
    ids.composite = (await create({ code: "composite", name: "Composite restoration", site: "surface", chartEffect: "restoration" })).body.id;
    ids.extraction = (await create({ code: "extraction", name: "Extraction", site: "tooth", chartEffect: "missing" })).body.id;
    ids.rct = (await create({ code: "rct", name: "Root canal treatment", site: "tooth", chartEffect: "root_canal" })).body.id;
    await api(admin).post("/dental/procedure-types", { code: "composite", name: "Again", site: "surface" }).expect(409);

    expect((await api(assistant).get("/dental/settings").expect(200)).body.notation).toBe("fdi");
    await api(dentist).put(`/dental/facilities/${tenant.facilityId}/notation`, { notation: "universal" }).expect(403);
    await api(admin).put(`/dental/facilities/${tenant.facilityId}/notation`, { notation: "universal" }).expect(200);
    const settings = await api(assistant).get("/dental/settings").expect(200);
    expect(settings.body.notation).toBe("universal");
    expect(settings.body.procedureTypes.map((t: { code: string }) => t.code)).toEqual(["composite", "extraction", "prophylaxis", "rct"]);

    // Dental procedures are a billing charge source.
    await api(admin)
      .post("/billing/services", {
        code: "composite",
        name: "Composite restoration",
        category: "dental",
        sourceKind: "dental_procedure",
        sourceCode: "composite",
        unitPrice: 150_000,
        effectiveFrom: manilaDate(-30),
      })
      .expect(201);
  });

  it("records an examination that charts teeth, validating teeth and surfaces", async () => {
    const exam = {
      encounterId,
      oralHygiene: "fair",
      notes: "Gingiva slightly inflamed; occlusion class I.",
      teeth: [
        { tooth: "16", findings: [{ condition: "caries", surfaces: ["O", "M"] }] },
        { tooth: "36", findings: [{ condition: "restoration", surfaces: ["O"] }] },
        { tooth: "48", findings: [{ condition: "missing", surfaces: [] }] },
        { tooth: "21", findings: [] },
      ],
    };
    await api(physician).post(`/dental/patients/${patientId}/examinations`, exam).expect(403);
    await api(assistant).post(`/dental/patients/${patientId}/examinations`, exam).expect(403);
    const wrong = await api(dentist)
      .post(`/dental/patients/${patientId}/examinations`, {
        ...exam,
        teeth: [
          { tooth: "11", findings: [{ condition: "caries", surfaces: ["O"] }] },
          { tooth: "46", findings: [{ condition: "caries", surfaces: [] }] },
        ],
      })
      .expect(422);
    expect(wrong.body.error).toMatchObject({
      code: "invalid_chart",
      details: { "11": ["tooth 11 has no O surface"], "46": ["caries needs the affected surfaces"] },
    });
    await api(dentist)
      .post(`/dental/patients/${patientId}/examinations`, { ...exam, teeth: [{ tooth: "19", findings: [] }] })
      .expect(400);
    // Only during the patient's own encounter.
    await api(dentist).post(`/dental/patients/${otherPatientId}/examinations`, exam).expect(404);

    const recorded = await api(dentist).post(`/dental/patients/${patientId}/examinations`, exam).expect(201);
    ids.exam = recorded.body.id;
    expect(recorded.body.teeth.find((t: ChartTooth) => t.tooth === "16").findings).toEqual([{ condition: "caries", surfaces: ["M", "O"] }]);
    expect(await chartOf()).toEqual({
      "16": [{ condition: "caries", surfaces: ["M", "O"] }],
      "21": [],
      "36": [{ condition: "restoration", surfaces: ["O"] }],
      "48": [{ condition: "missing", surfaces: [] }],
    });
    await drainEvents(ctx);
    const events = await ctx.pool.query<{ event_type: string }>(
      "SELECT event_type FROM domain_event WHERE event_type LIKE 'Dental%' ORDER BY occurred_at, event_type",
    );
    expect(events.rows.map((r) => r.event_type)).toEqual(["DentalChartUpdated", "DentalExaminationRecorded"]);
  });

  it("proposes a treatment plan and records the patient's decision item by item", async () => {
    await api(desk)
      .post("/dental/treatment-plans", { patientId, title: "x", items: [{ procedureTypeId: ids.prophylaxis }] })
      .expect(403);
    const bad = await api(dentist)
      .post("/dental/treatment-plans", { patientId, title: "Restorative", items: [{ procedureTypeId: ids.composite, tooth: "16" }] })
      .expect(422);
    expect(bad.body.error.details).toEqual({ "items.0": ["choose the treated surfaces"] });
    const plan = await api(dentist)
      .post("/dental/treatment-plans", {
        patientId,
        title: "Restorative and hygiene",
        items: [
          { phase: 1, procedureTypeId: ids.prophylaxis },
          { phase: 2, procedureTypeId: ids.composite, tooth: "16", surfaces: ["M", "O"] },
          { phase: 2, procedureTypeId: ids.rct, tooth: "36", note: "If symptoms persist" },
        ],
      })
      .expect(201);
    ids.plan = plan.body.id;
    expect(plan.body).toMatchObject({ status: "proposed", version: 1 });
    const [prophy, composite, rct] = plan.body.items as Array<{ id: string; procedure: { code: string } }>;
    ids.prophyItem = prophy!.id;
    ids.compositeItem = composite!.id;
    ids.rctItem = rct!.id;
    expect(plan.body.items.map((i: { procedure: { code: string } }) => i.procedure.code)).toEqual(["prophylaxis", "composite", "rct"]);

    await api(dentist)
      .post(`/dental/treatment-plans/${ids.plan}/decision`, { acceptedItemIds: [ids.prophyItem], note: "x", version: 1 })
      .expect(400);
    await api(dentist)
      .post(`/dental/treatment-plans/${ids.plan}/decision`, { acceptedItemIds: [ids.prophyItem], note: "Options and fees explained", version: 7 })
      .expect(409);
    const decided = await api(dentist)
      .post(`/dental/treatment-plans/${ids.plan}/decision`, {
        acceptedItemIds: [ids.prophyItem, ids.compositeItem],
        note: "Options and fees explained; patient agreed verbally",
        version: 1,
      })
      .expect(200);
    expect(decided.body.status).toBe("accepted");
    expect(decided.body.items.map((i: { status: string }) => i.status)).toEqual(["accepted", "accepted", "declined"]);
    await api(dentist).post(`/dental/treatment-plans/${ids.plan}/decision`, { acceptedItemIds: [], note: "again", version: decided.body.version }).expect(422);
  });

  it("records procedures that update the chart, complete plan items and are charged", async () => {
    // The planned item must match (procedure and tooth).
    const mismatch = await api(dentist)
      .post(`/dental/patients/${patientId}/procedures`, {
        encounterId,
        procedureTypeId: ids.composite,
        tooth: "26",
        surfaces: ["O"],
        planItemId: ids.compositeItem,
      })
      .expect(422);
    expect(mismatch.body.error.code).toBe("plan_item_mismatch");
    await api(dentist)
      .post(`/dental/patients/${patientId}/procedures`, { encounterId, procedureTypeId: ids.composite, tooth: "16", surfaces: ["I"] })
      .expect(422);
    await api(dentist)
      .post(`/dental/patients/${patientId}/procedures`, { encounterId, procedureTypeId: ids.rct, tooth: "36", planItemId: ids.rctItem })
      .expect(422);

    const composite = await api(dentist)
      .post(`/dental/patients/${patientId}/procedures`, {
        encounterId,
        procedureTypeId: ids.composite,
        tooth: "16",
        surfaces: ["O", "M"],
        planItemId: ids.compositeItem,
        notes: "Shade A2",
      })
      .expect(201);
    ids.compositeProcedure = composite.body.id;
    expect(composite.body.label).toBe("Composite restoration — 16 MO");
    expect((await chartOf())["16"]).toEqual([{ condition: "restoration", surfaces: ["M", "O"] }]);
    expect((await planOf(ids.plan)).status).toBe("in_progress");
    await api(dentist)
      .post(`/dental/patients/${patientId}/procedures`, {
        encounterId,
        procedureTypeId: ids.composite,
        tooth: "16",
        surfaces: ["M", "O"],
        planItemId: ids.compositeItem,
      })
      .expect(409);

    await api(dentist)
      .post(`/dental/patients/${patientId}/procedures`, { encounterId, procedureTypeId: ids.prophylaxis, planItemId: ids.prophyItem })
      .expect(201);
    expect((await planOf(ids.plan)).status).toBe("completed");

    await drainEvents(ctx);
    const charges = await api(cashier).get(`/billing/charges?patientId=${patientId}`).expect(200);
    // Only the composite is mapped to a billing service; the prophylaxis is not charged automatically.
    expect(charges.body).toEqual([
      expect.objectContaining({
        sourceType: "dental_procedure",
        sourceId: ids.compositeProcedure,
        description: "Composite restoration — 16 MO",
        unitPrice: 150_000,
        status: "pending",
        category: "dental",
      }),
    ]);
    // At-least-once delivery does not charge twice.
    await ctx.pool.query("UPDATE domain_event SET published_at = NULL WHERE event_type = 'DentalProcedurePerformed'");
    await drainEvents(ctx);
    expect((await api(cashier).get(`/billing/charges?patientId=${patientId}`).expect(200)).body).toHaveLength(1);
  });

  it("corrects by marking records entered in error: the chart, the plan and the charge follow", async () => {
    await api(assistant).post(`/dental/procedures/${ids.compositeProcedure}/entered-in-error`, { reason: "Wrong tooth recorded" }).expect(403);
    await api(dentist).post(`/dental/procedures/${ids.compositeProcedure}/entered-in-error`, { reason: "Wrong tooth recorded" }).expect(200);
    await api(dentist).post(`/dental/procedures/${ids.compositeProcedure}/entered-in-error`, { reason: "Wrong tooth recorded" }).expect(422);
    // The examination's state of 16 shows again; the item is open again and the plan back in progress.
    expect((await chartOf())["16"]).toEqual([{ condition: "caries", surfaces: ["M", "O"] }]);
    const plan = await planOf(ids.plan);
    expect(plan.status).toBe("in_progress");
    expect(plan.items.find((i: { id: string }) => i.id === ids.compositeItem)).toMatchObject({ status: "accepted", procedureId: null });
    await drainEvents(ctx);
    const [charge] = (await api(cashier).get(`/billing/charges?patientId=${patientId}`).expect(200)).body;
    expect(charge).toMatchObject({ status: "cancelled", cancelReason: "Dental procedure entered in error" });

    await api(dentist).post(`/dental/examinations/${ids.exam}/entered-in-error`, { reason: "Charted on the wrong patient" }).expect(200);
    expect(await chartOf()).toEqual({});
    const history = await api(dentist).get(`/dental/patients/${patientId}/teeth/16`).expect(200);
    expect(history.body.map((h: { source: { type: string; status: string } }) => [h.source.type, h.source.status])).toEqual([
      ["procedure", "entered_in_error"],
      ["examination", "entered_in_error"],
    ]);

    // Never edited or deleted in place.
    await expect(ctx.pool.query("UPDATE dental_examination SET notes = 'changed' WHERE id = $1", [ids.exam])).rejects.toThrow(/immutable/);
    await expect(ctx.pool.query("DELETE FROM dental_tooth_state WHERE patient_id = $1", [patientId])).rejects.toThrow(/append-only/);
    await expect(ctx.pool.query("DELETE FROM dental_procedure WHERE id = $1", [ids.compositeProcedure])).rejects.toThrow(/cannot be deleted/);

    const audit = await auditRows(ctx.pool, "action LIKE 'dental.%entered-in-error'");
    expect(audit.map((a) => [a.action, a.reason])).toEqual([
      ["dental.procedure.entered-in-error", "Wrong tooth recorded"],
      ["dental.examination.entered-in-error", "Charted on the wrong patient"],
    ]);
  });

  it("adds radiographs from private documents and opens them with audited signed links", async () => {
    const upload = async (forPatient: string, category: string, contentType = "image/png") => {
      const created = await api(assistant)
        .post("/documents", { category, title: "Periapical 36", fileName: "pa-36.png", contentType, sizeBytes: 4096, patientId: forPatient })
        .expect(201);
      const id = created.body.document.id as string;
      const { rows } = await ctx.pool.query<{ storage_key: string }>("SELECT storage_key FROM document WHERE id = $1", [id]);
      ctx.storage.put(rows[0]!.storage_key, { sizeBytes: 4096, contentType });
      await api(assistant).post(`/documents/${id}/complete`).expect(200);
      return id;
    };
    const xray = await upload(patientId, "imaging");
    const pdf = await upload(patientId, "clinical_attachment", "application/pdf");
    const others = await upload(otherPatientId, "imaging");

    const add = (documentId: string) =>
      api(assistant).post(`/dental/patients/${patientId}/images`, { documentId, kind: "periapical", teeth: ["36", "37"], takenOn: manilaDate(0) });
    await api(desk)
      .post(`/dental/patients/${patientId}/images`, { documentId: xray, kind: "periapical", takenOn: manilaDate(0) })
      .expect(403);
    expect((await add(pdf).expect(422)).body.error.code).toBe("not_an_image");
    await add(others).expect(404);
    const image = await add(xray).expect(201);
    await add(xray).expect(409);
    expect(image.body).toMatchObject({ kind: "periapical", teeth: ["36", "37"], status: "recorded" });

    await api(desk).get(`/dental/images/${image.body.id}/link`).expect(403);
    const link = await api(assistant).get(`/dental/images/${image.body.id}/link`).expect(200);
    expect(link.body.url).toContain("pa-36.png");
    const opened = await auditRows(ctx.pool, "action = 'document.download' AND resource_id = $1", [xray]);
    expect(opened).toEqual([expect.objectContaining({ patient_id: patientId })]);
  });

  it("lists the day's dental visits and audits every view of the dental record", async () => {
    await api(desk).get(`/dental/patients/${patientId}`).expect(403);
    const doctorView = await api(physician).get(`/dental/patients/${patientId}`).expect(200);
    expect(doctorView.body).toMatchObject({ notation: "universal", patient: { patientNumber: "P00000001" } });
    expect(doctorView.body.plans[0]).toMatchObject({ title: "Restorative and hygiene", practitionerName: "Dr. dentist" });
    expect(doctorView.body.procedures.map((p: { label: string; status: string }) => [p.label, p.status])).toEqual([
      ["Oral prophylaxis", "recorded"],
      ["Composite restoration — 16 MO", "entered_in_error"],
    ]);

    const visits = await api(dentist).get("/dental/visits").expect(200);
    expect(visits.body.visits).toEqual([
      expect.objectContaining({
        encounterId,
        patientId,
        status: "in_progress",
        examinations: 0,
        procedures: 1,
        patient: expect.objectContaining({ patientNumber: "P00000001" }),
      }),
    ]);
    // Physicians' encounters are not dental visits.
    await api(physician).post("/encounters", { patientId: otherPatientId }).expect(201);
    expect((await api(dentist).get("/dental/visits").expect(200)).body.visits).toHaveLength(1);

    const views = await auditRows(ctx.pool, "action = 'dental.record.view'");
    expect(views.length).toBeGreaterThanOrEqual(5);
    expect(views.every((v) => v.patient_id === patientId)).toBe(true);
  });
});
