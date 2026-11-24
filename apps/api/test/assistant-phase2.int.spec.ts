import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

interface Suggestion {
  id: string;
  ruleId: string;
  severity: string;
  strength: string;
  basis: string;
  title: string;
  evidence: Array<{ label: string; resourceId: string; value?: string }>;
  action?: { href: string };
}

/**
 * The heuristic assistant, phase 2 (docs/domains/assistant.md): in the consultation workspace, what the record does not
 * hold yet before signing and the codes the organization has used for the words written; on the laboratory workbench,
 * a result far from the patient's last released one. Off until turned on; nothing is changed or applied; suggestions
 * name orders and codes, never a patient.
 */
describe("heuristic assistant, phase 2", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let medtech: string;
  let receptionist: string;
  let patientId: string;

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const turnOn = (ruleId: string) => api(admin).put(`/assistant/rules/${ruleId}/settings`, { enabled: true, expectedVersion: 0 }).expect(200);
  const forEncounter = async (token: string, encounterId: string) =>
    ((await api(token).get(`/assistant/suggestions?surface=encounter&encounterId=${encounterId}`).expect(200)).body as { items: Suggestion[] }).items;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "assistant-p2");
    await createStaff(ctx.pool, tenant, "admin@assistant-p2.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "doctor@assistant-p2.ph", ["physician"]);
    await createStaff(ctx.pool, tenant, "medtech@assistant-p2.ph", ["medical_technologist"]);
    await createStaff(ctx.pool, tenant, "reception@assistant-p2.ph", ["receptionist"]);
    admin = (await login(ctx, "admin@assistant-p2.ph")).accessToken;
    doctor = (await login(ctx, "doctor@assistant-p2.ph")).accessToken;
    medtech = (await login(ctx, "medtech@assistant-p2.ph")).accessToken;
    receptionist = (await login(ctx, "reception@assistant-p2.ph")).accessToken;
    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  it("lists what a consultation in progress does not hold yet, for those who may read it, and nothing without a consultation", async () => {
    const encounter = (await api(doctor).post("/encounters", { patientId, chiefComplaint: "Cough for three days" }).expect(201)).body.id as string;
    expect(await forEncounter(doctor, encounter)).toEqual([]);
    await turnOn("clinic.encounter-checklist");
    const [s] = await forEncounter(doctor, encounter);
    expect(s).toMatchObject({ ruleId: "clinic.encounter-checklist", severity: "advice", basis: "rule" });
    expect(s!.evidence.map((e) => e.label)).toEqual(["Vital signs (none in the last 24 hours)", "Allergy review", "Assessment", "Plan", "A diagnosis"]);
    expect(s!.action).toBeUndefined();
    // A receptionist may use the assistant but holds no encounter.read: the rule is withheld.
    const reception = (await api(receptionist).get(`/assistant/suggestions?surface=encounter&encounterId=${encounter}`).expect(200)).body;
    expect(reception.items).toEqual([]);
    expect(reception.withheld).toBeGreaterThanOrEqual(1);
    // Without a consultation, a live request reads none.
    expect(((await api(doctor).get("/assistant/suggestions?surface=encounter").expect(200)).body as { items: Suggestion[] }).items).toEqual([]);
    const audit = await auditRows(ctx.pool, "action = 'assistant.view' AND metadata->>'surface' = 'encounter' AND metadata ? 'encounterId'");
    expect(audit.map((a) => a.metadata)).toContainEqual(expect.objectContaining({ encounterId: encounter, rules: ["clinic.encounter-checklist"] }));
    expect(JSON.stringify(audit)).not.toMatch(/Cough/i);
  });

  it("offers codes the organization used for an uncoded diagnosis's words, never a code used once", async () => {
    await api(admin).post("/clinic/coding-systems", { key: "icd-10", name: "ICD-10", version: "2019" }).expect(201);
    // Two earlier consultations coded J06.9; one coded X99 once.
    for (const [code, display] of [
      ["J06.9", "Acute upper respiratory infection"],
      ["J06.9", "Acute upper respiratory infection"],
      ["X99", "Upper respiratory infection after rare travel"],
    ]) {
      const past = (await api(doctor).post("/encounters", { patientId, chiefComplaint: "Colds" }).expect(201)).body.id;
      await api(doctor).post(`/encounters/${past}/diagnoses`, { codeSystemKey: "icd-10", code, display }).expect(201);
    }
    const encounter = (await api(doctor).post("/encounters", { patientId, chiefComplaint: "Colds" }).expect(201)).body.id as string;
    await api(doctor).post(`/encounters/${encounter}/diagnoses`, { display: "Acute upper respiratory infections after rare travel" }).expect(201);
    await turnOn("clinic.code-suggestions");
    const [s] = (await forEncounter(doctor, encounter)).filter((x) => x.ruleId === "clinic.code-suggestions");
    expect(s).toMatchObject({ severity: "info", basis: "text-match" });
    expect(s!.evidence.map((e) => e.resourceId)).toEqual(["icd-10:J06.9"]);
    expect(s!.evidence[0]!.value).toBe("used 2 times; matching words: acute, upper, respiratory, infection");
    expect(s!.action).toBeUndefined();
    // Nothing was applied: the diagnosis still has no code.
    const { rows } = await ctx.pool.query("SELECT code FROM diagnosis WHERE encounter_id = $1", [encounter]);
    expect(rows).toEqual([{ code: null }]);
  });

  it("asks for a second look at a result far from the patient's last released one, by order and never by patient", async () => {
    const lab = (path: string, body: object) => api(admin).post(`/laboratory${path}`, body).expect(201);
    const chem = (await lab("/departments", { code: "chem", name: "Chemistry" })).body.id;
    const serum = (await lab("/specimen-types", { code: "serum", name: "Serum" })).body.id;
    const crea = (await lab("/tests", { code: "crea", name: "Creatinine", departmentId: chem, specimenTypeId: serum, resultType: "numeric", unit: "mg/dL" }))
      .body.id;
    const orderAndEnter = async (value: number) => {
      const order = (
        await api(medtech)
          .post("/laboratory/orders", { patientId, source: "external", externalOrderer: "Dr. Cruz", testIds: [crea] })
          .expect(201)
      ).body;
      const specimen = (
        await api(medtech)
          .post(`/laboratory/orders/${order.id}/specimens`, { specimenTypeId: order.items[0].specimenTypeId, itemIds: [order.items[0].id] })
          .expect(201)
      ).body.specimens[0].id;
      await api(medtech).post(`/laboratory/specimens/${specimen}/receive`).expect(200);
      const result = (await api(medtech).post(`/laboratory/order-items/${order.items[0].id}/results`, { valueNumeric: value }).expect(201)).body.id;
      return { order, result };
    };
    const first = await orderAndEnter(1.0);
    await api(admin).post(`/laboratory/results/${first.result}/verify`).expect(200);
    await api(admin).post(`/laboratory/results/${first.result}/approve`).expect(200);
    await api(admin).post(`/laboratory/orders/${first.order.id}/release`).expect(200);
    const second = await orderAndEnter(2.4);

    await turnOn("laboratory.delta-check");
    const items = ((await api(medtech).get("/assistant/suggestions?surface=laboratory").expect(200)).body as { items: Suggestion[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ruleId: "laboratory.delta-check", severity: "warning", action: { href: "/laboratory/worklist?stage=verify" } });
    expect(items[0]!.title).toBe(`Creatinine, order ${second.order.orderNumber}: 2.4 mg/dL (+140% from the last released 1 mg/dL)`);
    expect(JSON.stringify(items)).not.toMatch(/Juan|Dela Cruz/i);
    // The result workflow is untouched.
    const { rows } = await ctx.pool.query("SELECT status, flag FROM lab_result WHERE id = $1", [second.result]);
    expect(rows[0].status).toBe("entered");
  });

  it("replays the consultation rules over the consultations open on each past day", async () => {
    const replay = (await api(admin).post("/assistant/rules/clinic.encounter-checklist/replay", { days: 3 }).expect(200)).body;
    expect(replay).toMatchObject({ readAt: "16:00" });
    expect(replay.days).toHaveLength(3);
    // Today's consultations are not past days.
    expect(replay.days.every((d: { suggestions: number }) => d.suggestions === 0)).toBe(true);
    await api(medtech).post("/assistant/rules/laboratory.delta-check/replay", { days: 3 }).expect(403);
  });
});
