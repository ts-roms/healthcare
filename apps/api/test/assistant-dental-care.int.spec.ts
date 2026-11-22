import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

interface Suggestion {
  id: string;
  ruleId: string;
  surface: string;
  severity: string;
  strength: string;
  basis: string;
  title: string;
  rationale: string;
  evidence: Array<{ label: string; resourceType: string; resourceId: string; value?: string }>;
  action?: { label: string; href: string };
}

/**
 * Phase 3 of the assistant, dental and care plans (docs/domains/assistant.md): on a patient's dental record, plan items
 * the chart says cannot be done and items waiting for the patient's decision; in a consultation, the tests one of the
 * organization's order sets lists for a long-standing diagnosis that have no released result for months. Off until
 * turned on; nothing is changed, ordered or decided by the assistant; no patient is named.
 */
describe("dental and care-plan suggestions", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let dentist: string;
  let doctor: string;
  let medtech: string;
  let receptionist: string;
  let patientId: string;
  let planId: string;
  let examId: string;
  const items: Record<string, string> = {};

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const turnOn = (ruleId: string, parameters?: object) =>
    api(admin)
      .put(`/assistant/rules/${ruleId}/settings`, { enabled: true, expectedVersion: 0, ...(parameters ? { parameters } : {}) })
      .expect(200);
  const suggestions = async (token: string, query: string) =>
    (await api(token).get(`/assistant/suggestions?${query}`).expect(200)).body as { items: Suggestion[]; withheld: number };
  const dental = async (ruleId: string, token = dentist) =>
    (await suggestions(token, `surface=dental&patientId=${patientId}`)).items.filter((s) => s.ruleId === ruleId);

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "assistant-dental");
    await createStaff(ctx.pool, tenant, "admin@dental-care.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "dentist@dental-care.ph", ["dentist"], "dentist");
    await createClinician(ctx, tenant, "doctor@dental-care.ph", ["physician"]);
    await createStaff(ctx.pool, tenant, "medtech@dental-care.ph", ["medical_technologist"]);
    await createStaff(ctx.pool, tenant, "reception@dental-care.ph", ["receptionist"]);
    admin = (await login(ctx, "admin@dental-care.ph")).accessToken;
    dentist = (await login(ctx, "dentist@dental-care.ph")).accessToken;
    doctor = (await login(ctx, "doctor@dental-care.ph")).accessToken;
    medtech = (await login(ctx, "medtech@dental-care.ph")).accessToken;
    receptionist = (await login(ctx, "reception@dental-care.ph")).accessToken;
    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  it("points out planned work on a tooth the chart shows missing, in the facility's notation, and changes neither", async () => {
    const type = async (body: object) => (await api(admin).post("/dental/procedure-types", body).expect(201)).body.id as string;
    const prophylaxis = await type({ code: "prophylaxis", name: "Oral prophylaxis", site: "mouth" });
    const composite = await type({ code: "composite", name: "Composite restoration", site: "surface", chartEffect: "restoration" });
    const crown = await type({ code: "crown", name: "Porcelain crown", site: "tooth", chartEffect: "crown" });
    const plan = (
      await api(dentist)
        .post("/dental/treatment-plans", {
          patientId,
          title: "Restorative",
          items: [
            { phase: 1, procedureTypeId: prophylaxis },
            { phase: 2, procedureTypeId: composite, tooth: "16", surfaces: ["M", "O"] },
            { phase: 2, procedureTypeId: crown, tooth: "36" },
          ],
        })
        .expect(201)
    ).body;
    planId = plan.id;
    [items.prophylaxis, items.composite, items.crown] = plan.items.map((i: { id: string }) => i.id);

    // Later, the examination charts 16 as missing (and 36 decayed, which a crown allows).
    const encounterId = (await api(dentist).post("/encounters", { patientId, chiefComplaint: "Check-up" }).expect(201)).body.id;
    examId = (
      await api(dentist)
        .post(`/dental/patients/${patientId}/examinations`, {
          encounterId,
          teeth: [
            { tooth: "16", findings: [{ condition: "missing", surfaces: [] }] },
            { tooth: "36", findings: [{ condition: "caries", surfaces: ["O"] }] },
          ],
        })
        .expect(201)
    ).body.id;
    expect(await dental("dental.chart-consistency")).toEqual([]);

    await turnOn("dental.chart-consistency");
    const [s, ...rest] = await dental("dental.chart-consistency");
    expect(rest).toEqual([]);
    expect(s).toMatchObject({
      id: `dental.chart-consistency@1:item:${items.composite}`,
      surface: "dental",
      severity: "warning",
      basis: "rule",
      strength: "matched",
      title: "Composite restoration is planned on tooth 16, which the chart shows as missing",
    });
    expect(s!.evidence.map((e) => [e.resourceType, e.resourceId, e.value])).toEqual([
      ["dental_treatment_plan_item", items.composite, "Composite restoration, tooth 16 (proposed)"],
      ["dental_tooth_state", "16", expect.stringMatching(/^missing since \d{4}-\d{2}-\d{2}$/)],
    ]);
    expect(s!.action).toBeUndefined();
    expect(JSON.stringify(s)).not.toMatch(/Juan|Dela Cruz/i);

    // In the facility's notation.
    await api(admin).put(`/dental/facilities/${tenant.facilityId}/notation`, { notation: "universal" }).expect(200);
    expect((await dental("dental.chart-consistency"))[0]!.title).toBe("Composite restoration is planned on tooth 3, which the chart shows as missing");
    await api(admin).put(`/dental/facilities/${tenant.facilityId}/notation`, { notation: "fdi" }).expect(200);

    // Without a patient, a live request reads none; without dental.record.read the rule is withheld.
    expect((await suggestions(dentist, "surface=dental")).items).toEqual([]);
    const reception = await suggestions(receptionist, `surface=dental&patientId=${patientId}`);
    expect(reception.items).toEqual([]);
    expect(reception.withheld).toBeGreaterThanOrEqual(1);
    // Audited with the patient's id and the rule ids, nothing else.
    const audit = await auditRows(ctx.pool, "action = 'assistant.view' AND metadata->>'surface' = 'dental' AND metadata ? 'patientId'");
    expect(audit.map((a) => a.metadata)).toContainEqual(expect.objectContaining({ patientId, rules: ["dental.chart-consistency"] }));
    // Nothing changed: the plan and the chart are as they were.
    const { rows } = await ctx.pool.query("SELECT status FROM dental_treatment_plan_item WHERE plan_id = $1 ORDER BY phase, created_at", [planId]);
    expect(rows.map((r) => r.status)).toEqual(["proposed", "proposed", "proposed"]);
  });

  it("reminds of items still waiting for the patient's decision, and replays each past day as it was", async () => {
    // The plan was proposed 40 days ago.
    await ctx.pool.query("UPDATE dental_treatment_plan SET created_at = now() - interval '40 days' WHERE id = $1", [planId]);
    await ctx.pool.query("UPDATE dental_treatment_plan_item SET created_at = now() - interval '40 days' WHERE plan_id = $1", [planId]);
    await turnOn("dental.plan-decisions");
    const [s] = await dental("dental.plan-decisions");
    expect(s).toMatchObject({
      id: `dental.plan-decisions@1:plan:${planId}`,
      severity: "advice",
      title: "“Restorative”: 3 items waiting for the patient's decision for 40 days",
    });
    expect(s!.evidence.map((e) => e.label).sort()).toEqual(["Composite restoration, tooth 16", "Oral prophylaxis", "Porcelain crown, tooth 36"]);

    // Each past day: the plan was waiting; the examination (today) was not on the chart yet.
    const decisions = (await api(admin).post("/assistant/rules/dental.plan-decisions/replay", { days: 3 }).expect(200)).body;
    expect(decisions).toMatchObject({ readAt: "16:00" });
    expect(decisions.days.map((d: { suggestions: number }) => d.suggestions)).toEqual([1, 1, 1]);
    const chart = (await api(admin).post("/assistant/rules/dental.chart-consistency/replay", { days: 3 }).expect(200)).body;
    expect(chart.days.map((d: { suggestions: number }) => d.suggestions)).toEqual([0, 0, 0]);

    // Once the patient decides, the reminder goes; the accepted restoration on the missing tooth is still pointed out.
    await api(dentist)
      .post(`/dental/treatment-plans/${planId}/decision`, {
        acceptedItemIds: [items.composite, items.crown],
        note: "Options explained; the patient declined the cleaning for now",
        version: 1,
      })
      .expect(200);
    expect(await dental("dental.plan-decisions")).toEqual([]);
    expect((await dental("dental.chart-consistency"))[0]!.evidence[0]!.value).toBe("Composite restoration, tooth 16 (accepted)");

    // An examination entered in error leaves the chart: the conflict goes with it.
    await api(dentist).post(`/dental/examinations/${examId}/entered-in-error`, { reason: "Charted on the wrong patient" }).expect(200);
    expect(await dental("dental.chart-consistency")).toEqual([]);
  });

  it("points out a chronic diagnosis's monitoring tests not released for months, from the organization's order sets", async () => {
    await api(admin).post("/clinic/coding-systems", { key: "icd-10", name: "ICD-10", version: "2019" }).expect(201);
    const lab = async (path: string, body: object) => (await api(admin).post(`/laboratory${path}`, body).expect(201)).body.id as string;
    const chem = await lab("/departments", { code: "chem", name: "Chemistry" });
    const serum = await lab("/specimen-types", { code: "serum", name: "Serum" });
    const hba1c = await lab("/tests", { code: "hba1c", name: "HbA1c", departmentId: chem, specimenTypeId: serum, resultType: "numeric", unit: "%" });
    const crea = await lab("/tests", { code: "crea", name: "Creatinine", departmentId: chem, specimenTypeId: serum, resultType: "numeric", unit: "mg/dL" });
    const setId = (
      await api(admin)
        .post("/laboratory/order-sets", {
          code: "dm-monitoring",
          name: "Diabetes monitoring",
          items: [{ testId: hba1c }, { testId: crea }],
          triggers: [{ kind: "diagnosis_code", value: "E11", codeSystemKey: "icd-10" }],
        })
        .expect(201)
    ).body.id as string;

    // Type 2 diabetes recorded 200 days ago, first without the chronic mark; creatinine released today, HbA1c never.
    const patient = (
      await api(admin)
        .post("/patients", { ...juan, identifiers: [], givenName: "Pedro", birthDate: "1961-02-03" })
        .expect(201)
    ).body.id;
    const diagnosedLongAgo = async (isChronic: boolean) => {
      const earlier = (await api(doctor).post("/encounters", { patientId: patient, chiefComplaint: "Follow-up" }).expect(201)).body.id;
      await api(doctor)
        .post(`/encounters/${earlier}/diagnoses`, { codeSystemKey: "icd-10", code: "E11.9", display: "Type 2 diabetes mellitus", isChronic })
        .expect(201);
      await ctx.pool.query("UPDATE diagnosis SET recorded_at = now() - interval '200 days' WHERE encounter_id = $1", [earlier]);
    };
    await diagnosedLongAgo(false);
    const order = (
      await api(medtech)
        .post("/laboratory/orders", { patientId: patient, source: "external", externalOrderer: "Dr. Cruz", testIds: [crea] })
        .expect(201)
    ).body;
    const specimen = (
      await api(medtech)
        .post(`/laboratory/orders/${order.id}/specimens`, { specimenTypeId: order.items[0].specimenTypeId, itemIds: [order.items[0].id] })
        .expect(201)
    ).body.specimens[0].id;
    await api(medtech).post(`/laboratory/specimens/${specimen}/receive`).expect(200);
    const result = (await api(medtech).post(`/laboratory/order-items/${order.items[0].id}/results`, { valueNumeric: 0.9 }).expect(201)).body.id;
    await api(admin).post(`/laboratory/results/${result}/verify`).expect(200);
    await api(admin).post(`/laboratory/results/${result}/approve`).expect(200);
    await api(admin).post(`/laboratory/orders/${order.id}/release`).expect(200);

    // Today's consultation is for something else.
    const today = (await api(doctor).post("/encounters", { patientId: patient, chiefComplaint: "Cough" }).expect(201)).body.id as string;
    const gaps = async (token = doctor) =>
      (await suggestions(token, `surface=encounter&encounterId=${today}`)).items.filter((s) => s.ruleId === "laboratory.monitoring-gap");
    expect(await gaps()).toEqual([]);

    await turnOn("laboratory.monitoring-gap");
    // Only a diagnosis marked chronic is monitored, as on the problem list.
    expect(await gaps()).toEqual([]);
    await diagnosedLongAgo(true);
    const [s, ...rest] = await gaps();
    expect(rest).toEqual([]);
    expect(s).toMatchObject({
      severity: "advice",
      basis: "rule",
      title: "Diabetes monitoring: HbA1c not released in 12 months (E11.9)",
      action: { label: "Open in the lab order form", href: `/clinic/encounters/${today}?orderSet=${setId}#lab-orders` },
    });
    expect(s!.evidence.map((e) => [e.label, e.value])).toEqual([["HbA1c", "no released result here"]]);
    expect(JSON.stringify(s)).not.toMatch(/Pedro|Dela Cruz/i);
    // A receptionist may use the assistant but reads no results: withheld.
    const reception = await suggestions(receptionist, `surface=encounter&encounterId=${today}`);
    expect(reception.withheld).toBeGreaterThanOrEqual(1);

    // A chronic diagnosis recorded today is the order sets rule's, not a monitoring gap.
    const other = (
      await api(admin)
        .post("/patients", { ...juan, identifiers: [], givenName: "Rosa", sex: "female", birthDate: "1970-05-05" })
        .expect(201)
    ).body.id;
    const first = (await api(doctor).post("/encounters", { patientId: other, chiefComplaint: "Thirst" }).expect(201)).body.id;
    await api(doctor)
      .post(`/encounters/${first}/diagnoses`, { codeSystemKey: "icd-10", code: "E11.9", display: "Type 2 diabetes mellitus", isChronic: true })
      .expect(201);
    expect((await suggestions(doctor, `surface=encounter&encounterId=${first}`)).items.filter((x) => x.ruleId === "laboratory.monitoring-gap")).toEqual([]);

    // Nothing is ordered by the assistant; once the doctor orders HbA1c in this consultation, the gap is not shown.
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM lab_order WHERE encounter_id = $1", [today])).rows[0].n).toBe(0);
    await api(doctor)
      .post("/laboratory/orders", { patientId: patient, encounterId: today, testIds: [hba1c] })
      .expect(201);
    expect(await gaps()).toEqual([]);
  });
});
