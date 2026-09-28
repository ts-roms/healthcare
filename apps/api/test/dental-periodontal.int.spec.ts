import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, drainEvents, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * Periodontal charting (docs/domains/dental.md#periodontal-charting): a dentist records six probing sites per tooth,
 * mobility and furcation during the visit; charts are immutable (entered in error only); summaries and changes since
 * the previous chart are derived, never a diagnosis.
 */
describe("dental periodontal charting", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let dentist: string;
  let assistant: string;
  let physician: string;
  let patientId: string;
  let encounterId: string;
  let firstChart: string;

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const sites = (depths: number[], bleeding: string[] = []) =>
    (["MB", "B", "DB", "ML", "L", "DL"] as const).map((site, i) => ({ site, probingDepth: depths[i], gingivalMargin: 1, bleeding: bleeding.includes(site) }));

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "perio-org");
    await createStaff(ctx.pool, tenant, "admin@perio.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "dentist@perio.ph", ["dentist"], "dentist");
    await createClinician(ctx, tenant, "doctor@perio.ph", ["physician"], "physician");
    await createStaff(ctx.pool, tenant, "assistant@perio.ph", ["dental_assistant"]);
    admin = (await login(ctx, "admin@perio.ph")).accessToken;
    dentist = (await login(ctx, "dentist@perio.ph")).accessToken;
    physician = (await login(ctx, "doctor@perio.ph")).accessToken;
    assistant = (await login(ctx, "assistant@perio.ph")).accessToken;
    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
    encounterId = (await api(dentist).post("/encounters", { patientId, chiefComplaint: "Bleeding gums" }).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  it("records a chart during the visit, validating teeth, sites and furcation", async () => {
    const invalid = await api(dentist)
      .post(`/dental/patients/${patientId}/perio-charts`, {
        encounterId,
        teeth: [
          { tooth: "11", furcation: 1, sites: sites([2, 2, 2, 2, 2, 2]) },
          { tooth: "16", sites: [...sites([3, 3, 3, 3, 3]).slice(0, 5), { site: "MB", probingDepth: 4 }] },
        ],
      })
      .expect(422);
    expect(invalid.body.error).toMatchObject({
      code: "invalid_perio_chart",
      details: { "11": ["tooth 11 has no furcation"], "16": ["site MB is recorded twice"] },
    });
    await api(dentist)
      .post(`/dental/patients/${patientId}/perio-charts`, { encounterId, teeth: [{ tooth: "16", sites: [{ site: "MB", probingDepth: 25 }] }] })
      .expect(400);
    // Only a dentist records; others may read.
    await api(physician)
      .post(`/dental/patients/${patientId}/perio-charts`, { encounterId, teeth: [{ tooth: "16", sites: sites([3, 3, 3, 3, 3, 3]) }] })
      .expect(403);

    const created = await api(dentist)
      .post(`/dental/patients/${patientId}/perio-charts`, {
        encounterId,
        notes: "Generalised gingival inflammation",
        teeth: [
          { tooth: "16", mobility: 1, furcation: 2, sites: sites([5, 3, 6, 4, 3, 3], ["MB", "DB"]) },
          { tooth: "11", mobility: 0, sites: sites([2, 2, 3, 2, 2, 2], ["B"]) },
        ],
      })
      .expect(201);
    firstChart = created.body.id;
    expect(created.body.teeth.map((t: { tooth: string }) => t.tooth)).toEqual(["11", "16"]);
    expect(created.body.summary).toMatchObject({
      teeth: 2,
      sitesProbed: 12,
      bleedingPercent: 25,
      sitesDepth4Plus: 3,
      sitesDepth6Plus: 1,
      maxProbingDepth: 6,
      mobileTeeth: 1,
      furcationTeeth: 1,
    });
    await drainEvents(ctx);
    const events = await ctx.pool.query(`SELECT payload FROM domain_event WHERE event_type = 'DentalPerioChartRecorded' AND aggregate_id = $1`, [firstChart]);
    expect(events.rows[0].payload).toEqual({ encounterId, teethCharted: 2 });
  });

  it("compares a later chart with the previous one and lists charts on the dental record", async () => {
    const second = await api(dentist)
      .post(`/dental/patients/${patientId}/perio-charts`, {
        encounterId,
        teeth: [{ tooth: "16", mobility: 1, furcation: 2, sites: sites([3, 3, 6, 6, 3, 3], ["DB"]) }],
      })
      .expect(201);
    const detail = await api(assistant).get(`/dental/perio-charts/${second.body.id}`).expect(200);
    expect(detail.body.previous).toMatchObject({
      id: firstChart,
      changes: { deeper: [{ tooth: "16", site: "ML", before: 4, after: 6 }], shallower: [{ tooth: "16", site: "MB", before: 5, after: 3 }] },
    });
    expect(detail.body.practitionerName).toEqual(expect.any(String));
    expect(await auditRows(ctx.pool, "action = 'dental.perio.view' AND patient_id = $1", [patientId])).toHaveLength(1);

    const record = await api(physician).get(`/dental/patients/${patientId}`).expect(200);
    expect(record.body.perioCharts.map((c: { id: string }) => c.id)).toEqual([second.body.id, firstChart]);
    expect(record.body.perioCharts[1]).toMatchObject({ status: "recorded", summary: { sitesProbed: 12 }, practitionerName: expect.any(String) });
  });

  it("is corrected only by marking it entered in error, never changed or deleted", async () => {
    await api(assistant).post(`/dental/perio-charts/${firstChart}/entered-in-error`, { reason: "Wrong patient charted" }).expect(403);
    const marked = await api(dentist).post(`/dental/perio-charts/${firstChart}/entered-in-error`, { reason: "Wrong patient charted" }).expect(200);
    expect(marked.body).toMatchObject({ status: "entered_in_error", enteredInErrorReason: "Wrong patient charted" });
    await api(dentist).post(`/dental/perio-charts/${firstChart}/entered-in-error`, { reason: "Wrong patient charted" }).expect(422);
    // The later chart no longer compares with a chart in error.
    const later = (await api(dentist).get(`/dental/patients/${patientId}`).expect(200)).body.perioCharts[0].id;
    expect((await api(dentist).get(`/dental/perio-charts/${later}`).expect(200)).body.previous).toBeNull();

    await expect(ctx.pool.query(`UPDATE dental_perio_chart SET notes = 'x' WHERE id = $1`, [firstChart])).rejects.toThrow(/immutable/);
    await expect(ctx.pool.query(`UPDATE dental_perio_site SET probing_depth = 1`)).rejects.toThrow();
    await expect(ctx.pool.query(`DELETE FROM dental_perio_tooth`)).rejects.toThrow();
    const actions = (await auditRows(ctx.pool, "patient_id = $1 AND action LIKE 'dental.perio.%'", [patientId])).map((a) => a.action);
    expect(actions.filter((a) => a === "dental.perio.record")).toHaveLength(2);
    expect(actions).toContain("dental.perio.entered-in-error");
  });

  it("needs the patient's visit in progress at the selected facility", async () => {
    await ctx
      .http()
      .put(`/api/v1/encounters/${encounterId}/note`)
      .set(as(dentist, tenant.facilityId))
      .send({ assessment: "Gingivitis", plan: "Scaling", basedOnRevision: 0 })
      .expect(200);
    const current = await api(dentist).get(`/encounters/${encounterId}`).expect(200);
    await api(dentist).post(`/encounters/${encounterId}/sign`, { version: current.body.version }).expect(200);
    const closed = await api(dentist)
      .post(`/dental/patients/${patientId}/perio-charts`, { encounterId, teeth: [{ tooth: "16", sites: sites([3, 3, 3, 3, 3, 3]) }] })
      .expect(422);
    expect(closed.body.error.code).toBe("encounter_not_in_progress");
  });
});
