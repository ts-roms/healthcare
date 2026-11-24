import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

interface Suggestion {
  id: string;
  ruleId: string;
  severity: string;
  strength: string;
  basis: string;
  title: string;
  rationale: string;
  evidence: Array<{ label: string; value?: string }>;
  action?: { label: string; href: string };
}

/**
 * The organization's laboratory order sets (migration 0155) and the last slice of the assistant's phase 2
 * (docs/domains/assistant.md): an order set offered in a consultation whose diagnosis it names, and on the outreach
 * screen when patients use MyHealth, audiences worth a segment and patients receiving many campaigns. Off until turned
 * on; nothing is ordered, created or sent by the assistant; no patient is named.
 */
describe("order sets and the outreach assistant", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let adminId: string;
  let doctor: string;
  let doctorIds: { userId: string; practitionerId: string };
  let receptionist: string;
  let tests: { hba1c: string; fbs: string; crea: string; renal: string };
  let orderSetId: string;

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
  const outreach = async (ruleId: string) => (await suggestions(admin, "surface=outreach")).items.filter((s) => s.ruleId === ruleId);
  const patient = async (familyName: string, givenName: string, birthDate: string, mobile: string) =>
    (
      await api(admin)
        .post("/patients", { ...juan, identifiers: [], familyName, givenName, birthDate, contacts: [{ system: "mobile", value: mobile }] })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "assistant-sets");
    adminId = await createStaff(ctx.pool, tenant, "admin@sets.ph", ["org_admin"]);
    doctorIds = await createClinician(ctx, tenant, "doctor@sets.ph", ["physician"]);
    await createStaff(ctx.pool, tenant, "reception@sets.ph", ["receptionist"]);
    admin = (await login(ctx, "admin@sets.ph")).accessToken;
    doctor = (await login(ctx, "doctor@sets.ph")).accessToken;
    receptionist = (await login(ctx, "reception@sets.ph")).accessToken;
    const lab = async (path: string, body: object) => (await api(admin).post(`/laboratory${path}`, body).expect(201)).body.id as string;
    const chem = await lab("/departments", { code: "chem", name: "Chemistry" });
    const blood = await lab("/specimen-types", { code: "blood", name: "Whole blood" });
    const test = (code: string, name: string, unit: string) =>
      lab("/tests", { code, name, departmentId: chem, specimenTypeId: blood, resultType: "numeric", unit });
    const hba1c = await test("hba1c", "HbA1c", "%");
    const fbs = await test("fbs", "Fasting blood sugar", "mg/dL");
    const crea = await test("crea", "Creatinine", "mg/dL");
    const renal = await lab("/panels", { code: "renal", name: "Renal panel", testIds: [crea] });
    tests = { hba1c, fbs, crea, renal };
    await api(admin).post("/clinic/coding-systems", { key: "icd-10", name: "ICD-10", version: "2019" }).expect(201);
  });
  afterAll(() => ctx.close());

  it("keeps the organization's order sets, offered for diagnosis prefixes or visit types, changed by version", async () => {
    const body = {
      code: "dm-follow-up",
      name: "Diabetes follow-up",
      note: "Agreed by the clinic's physicians.",
      items: [{ testId: tests.hba1c }, { testId: tests.fbs }, { panelId: tests.renal }],
      triggers: [
        { kind: "diagnosis_code", value: "e11", codeSystemKey: "icd-10" },
        { kind: "visit_type", value: "DM-Clinic" },
      ],
    };
    const created = (await api(admin).post("/laboratory/order-sets", body).expect(201)).body;
    orderSetId = created.id;
    expect(created).toMatchObject({ code: "dm-follow-up", status: "active", version: 1 });
    expect(created.triggers).toEqual([
      { kind: "diagnosis_code", value: "E11", codeSystemKey: "icd-10" },
      { kind: "visit_type", value: "dm-clinic", codeSystemKey: null },
    ]);
    expect(created.items.map((i: { kind: string; name: string; testIds: string[] }) => [i.kind, i.name, i.testIds])).toEqual([
      ["test", "HbA1c", [tests.hba1c]],
      ["test", "Fasting blood sugar", [tests.fbs]],
      ["panel", "Renal panel", [tests.crea]],
    ]);

    await api(admin)
      .post("/laboratory/order-sets", body)
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("duplicate_code"));
    await api(admin)
      .post("/laboratory/order-sets", { ...body, code: "other", items: [{ testId: "00000000-0000-4000-8000-000000000000" }] })
      .expect(404);
    // Doctors read the sets (to order from them) but do not change them.
    await api(doctor)
      .post("/laboratory/order-sets", { ...body, code: "mine" })
      .expect(403);
    expect((await api(doctor).get("/laboratory/order-sets").expect(200)).body.map((s: { id: string }) => s.id)).toEqual([orderSetId]);

    const update = { name: "Diabetes follow-up", note: body.note, items: body.items, triggers: body.triggers.slice(0, 1), status: "active", version: 1 };
    expect((await api(admin).put(`/laboratory/order-sets/${orderSetId}`, update).expect(200)).body).toMatchObject({ version: 2 });
    await api(admin).put(`/laboratory/order-sets/${orderSetId}`, update).expect(409);
    const audit = await auditRows(ctx.pool, "action LIKE 'lab.order-set.%' AND resource_id = $1", [orderSetId]);
    expect(audit.map((a) => a.action).sort()).toEqual(["lab.order-set.create", "lab.order-set.update"]);
  });

  it("offers the set in a consultation whose diagnosis it names, and orders nothing by itself", async () => {
    const patientId = await patient("Santos", "Pedro", "1961-02-03", "0917 200 0001");
    const encounter = (await api(doctor).post("/encounters", { patientId, chiefComplaint: "Follow-up" }).expect(201)).body.id as string;
    await api(doctor)
      .post(`/encounters/${encounter}/diagnoses`, { codeSystemKey: "icd-10", code: "E11.9", display: "Type 2 diabetes mellitus without complications" })
      .expect(201);
    const forEncounter = async (token: string) =>
      (await suggestions(token, `surface=encounter&encounterId=${encounter}`)).items.filter((s) => s.ruleId === "laboratory.order-sets");
    expect(await forEncounter(doctor)).toEqual([]);

    await turnOn("laboratory.order-sets");
    const [s] = await forEncounter(doctor);
    expect(s).toMatchObject({
      title: "Order set for the diagnosis E11.9: Diabetes follow-up",
      severity: "info",
      basis: "rule",
      action: { label: "Open in the lab order form", href: `/clinic/encounters/${encounter}?orderSet=${orderSetId}#lab-orders` },
    });
    expect(s!.rationale).toMatch(/^Agreed by the clinic's physicians\. Your organization offers this set for the diagnosis E11\.9\./);
    expect(s!.evidence.map((e) => [e.label, e.value])).toEqual([
      ["HbA1c", "to order"],
      ["Fasting blood sugar", "to order"],
      ["Renal panel", "to order"],
    ]);
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM lab_order WHERE encounter_id = $1", [encounter])).rows[0].n).toBe(0);
    // A receptionist may use the assistant but cannot order tests: the rule is withheld.
    const reception = await suggestions(receptionist, `surface=encounter&encounterId=${encounter}`);
    expect(reception.withheld).toBeGreaterThanOrEqual(1);

    // Once the doctor ordered part of it, the rest is still offered; once all of it, nothing.
    await api(doctor)
      .post("/laboratory/orders", { patientId, encounterId: encounter, testIds: [tests.hba1c] })
      .expect(201);
    const [partly] = await forEncounter(doctor);
    expect(partly!.evidence.map((e) => e.value)).toEqual(["already ordered in this consultation", "to order", "to order"]);
    await api(doctor)
      .post("/laboratory/orders", { patientId, encounterId: encounter, testIds: [tests.fbs], panelIds: [tests.renal] })
      .expect(201);
    expect(await forEncounter(doctor)).toEqual([]);
  });

  it("tells campaign planners when patients use MyHealth, from counts in the audit trail", async () => {
    // Ten past days of MyHealth use: 15 accounts at 20:00, 10 at 21:00 and 5 at 09:00, Manila time.
    const visits = (hour: number, perDay: number) =>
      ctx.pool.query(
        `INSERT INTO audit_event (organization_id, actor_type, actor_user_id, action, resource_type, outcome, occurred_at)
         SELECT $1, 'patient', gen_random_uuid(), 'portal.login', 'patient_portal_account', 'success',
                (date_trunc('day', now() AT TIME ZONE 'Asia/Manila') - make_interval(days => d) + make_interval(hours => $2::int)) AT TIME ZONE 'Asia/Manila'
         FROM generate_series(1, 10) d, generate_series(1, $3::int) n`,
        [tenant.organizationId, hour, perDay],
      );
    await visits(20, 15);
    await visits(21, 10);
    await visits(9, 5);
    expect(await outreach("crm.send-hour")).toEqual([]);

    await turnOn("crm.send-hour");
    const [s] = await outreach("crm.send-hour");
    expect(s).toMatchObject({
      title: "Patients use MyHealth most around 20:00–22:00",
      severity: "info",
      strength: "matched",
      basis: "statistic",
      action: { href: "/outreach#campaigns" },
    });
    expect(s!.rationale).toMatch(/^83% of MyHealth visits in the last 28 days fell between 20:00 and 22:00 \(Asia\/Manila time\)\./);
    expect(s!.evidence.find((e) => e.label === "MyHealth visits in the last 28 days")?.value).toBe("300");
    // A receptionist may use the assistant but plans no campaign: withheld, without counts.
    const reception = await suggestions(receptionist, "surface=outreach");
    expect(reception.items).toEqual([]);
    expect(reception.withheld).toBeGreaterThanOrEqual(1);
    // Each past day would have said the same.
    const replay = (await api(admin).post("/assistant/rules/crm.send-hour/replay", { days: 3 }).expect(200)).body;
    expect(replay).toMatchObject({ readAt: "10:00" });
    expect(replay.days.map((d: { suggestions: number }) => d.suggestions)).toEqual([1, 1, 1]);
  });

  it("offers a recall audience from how long the organization's own patients take to come back", async () => {
    // Four patients seen every 90 days, last six months ago: 24 returns of 90 days.
    const regular = [
      await patient("Reyes", "Maria", "1960-01-01", "0917 300 0001"),
      await patient("Garcia", "Luz", "1962-02-02", "0917 300 0002"),
      await patient("Bautista", "Rosa", "1964-03-03", "0917 300 0003"),
      await patient("Mendoza", "Carmen", "1966-04-04", "0917 300 0004"),
    ];
    await ctx.pool.query(
      `INSERT INTO encounter (organization_id, facility_id, patient_id, practitioner_id, status, started_at, started_by, completed_at, signed_by_practitioner_id)
       SELECT $1, $2, p, $3, 'completed', now() - make_interval(days => 90 * g), $4, now() - make_interval(days => 90 * g) + interval '1 hour', $3
       FROM unnest($5::uuid[]) p, generate_series(2, 8) g`,
      [tenant.organizationId, tenant.facilityId, doctorIds.practitionerId, doctorIds.userId, regular],
    );
    await turnOn("crm.audience-ideas", { returnPercentile: 75, minReturns: 20, minPatients: 5, birthdayLeadDays: 0 });
    const [s] = await outreach("crm.audience-ideas");
    expect(s!.title).toMatch(/^Audience idea: Not seen in 3 months \((\d+) patients\)$/);
    // The four, and the earlier patient whose consultation is still open.
    expect(Number(/\((\d+) patients\)/.exec(s!.title)![1])).toBe(5);
    expect(s).toMatchObject({ basis: "statistic", action: { href: "/outreach?segment=new&name=Not+seen+in+3+months&noVisitForMonths=3#segments" } });
    expect(s!.evidence.map((e) => [e.label, e.value])).toEqual([
      ["Patients who match today", "5"],
      ["Returns measured (two years)", "24"],
      ["75% came back within", "90 days"],
    ]);
    // Nothing was created; once the organization saves a recall segment, the idea is not offered again.
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM crm_segment WHERE organization_id = $1", [tenant.organizationId])).rows[0].n).toBe(0);
    await api(admin)
      .post("/outreach/segments", { name: "Not seen in 3 months", criteria: { noVisitForMonths: 3 } })
      .expect(201);
    expect(await outreach("crm.audience-ideas")).toEqual([]);
    const audit = await auditRows(ctx.pool, "action = 'assistant.view' AND metadata->>'surface' = 'outreach'");
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toMatch(/Reyes|Garcia|Bautista|Mendoza|Maria/);
  });

  it("warns when patients receive many campaigns and the frequency cap does not prevent it", async () => {
    // Four campaigns sent in the last four days to two patients.
    const { rows: segment } = await ctx.pool.query(
      `INSERT INTO crm_segment (organization_id, name, criteria, created_by, updated_by) VALUES ($1, 'Everyone over 50', '{"ageMin": 50}', $2, $2) RETURNING id`,
      [tenant.organizationId, adminId],
    );
    const { rows: campaigns } = await ctx.pool.query(
      `INSERT INTO crm_campaign (organization_id, segment_id, name, channels, body, status, created_by, approved_by, approved_at, started_at, completed_at)
       SELECT $1, $2, 'Campaign ' || g, '{sms}', 'A message for our patients.', 'completed', $3, $4,
              now() - make_interval(days => g), now() - make_interval(days => g), now() - make_interval(days => g)
       FROM generate_series(1, 4) g RETURNING id`,
      [tenant.organizationId, segment[0].id, adminId, doctorIds.userId],
    );
    const { rows: patients } = await ctx.pool.query("SELECT id FROM patient WHERE organization_id = $1 ORDER BY created_at LIMIT 2", [tenant.organizationId]);
    for (const c of campaigns)
      for (const p of patients)
        await ctx.pool.query(
          "INSERT INTO crm_campaign_delivery (campaign_id, organization_id, patient_id, channel, outcome) VALUES ($1, $2, $3, 'sms', 'queued')",
          [c.id, tenant.organizationId, p.id],
        );

    await turnOn("crm.frequency-load", { windowDays: 30, campaigns: 4, minPatients: 2 });
    const [s] = await outreach("crm.frequency-load");
    expect(s).toMatchObject({ title: "2 patients received 4 or more campaigns in 30 days", severity: "advice", action: { href: "/outreach/settings" } });
    expect(s!.rationale).toMatch(/^No frequency cap is set\./);
    // With a cap of two in 30 days, the warning goes.
    await api(admin)
      .put("/outreach/settings", {
        frequencyCap: { maxCampaigns: 2, windowDays: 30 },
        quietHours: { enabled: false, start: null, end: null, channels: ["sms", "push"] },
        version: 0,
      })
      .expect(200);
    expect(await outreach("crm.frequency-load")).toEqual([]);
  });
});
