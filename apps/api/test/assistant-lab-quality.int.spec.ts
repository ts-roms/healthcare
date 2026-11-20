import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

interface Suggestion {
  id: string;
  ruleId: string;
  severity: string;
  basis: string;
  title: string;
  rationale: string;
  evidence: Array<{ label: string; value?: string }>;
  action?: { href: string };
}

/**
 * The assistant's laboratory timing and quality rules (docs/domains/assistant.md, phase 3): orders past their usual
 * turnaround on the workbench, and on the QC page QC values drifting or shifted and specimen rejections concentrated
 * on a collector. Off until turned on; nothing is rejected, moved or changed; no patient is named.
 */
describe("laboratory timing and quality suggestions", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let pathologist: string;
  let medtech: string;
  let medtech2: string;
  let patientId: string;
  let ids: { chem: string; serum: string; glu: string; esr: string };

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const turnOn = (ruleId: string, parameters?: object) =>
    api(admin)
      .put(`/assistant/rules/${ruleId}/settings`, { enabled: true, expectedVersion: 0, ...(parameters ? { parameters } : {}) })
      .expect(200);
  const surface = async (token: string, name: string) =>
    (await api(token).get(`/assistant/suggestions?surface=${name}`).expect(200)).body as { items: Suggestion[]; withheld: Array<{ ruleId: string }> };
  /** An order of one test, its specimen collected by `token`. */
  const collected = async (testId: string, token = medtech) => {
    const order = (
      await api(token)
        .post("/laboratory/orders", { patientId, source: "external", externalOrderer: "Dr. Cruz", testIds: [testId] })
        .expect(201)
    ).body;
    const specimenId = (
      await api(token)
        .post(`/laboratory/orders/${order.id}/specimens`, { specimenTypeId: order.items[0].specimenTypeId, itemIds: [order.items[0].id] })
        .expect(201)
    ).body.specimens[0].id as string;
    return { order, specimenId };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "assistant-labq");
    await createStaff(ctx.pool, tenant, "admin@labq.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "pathologist@labq.ph", ["pathologist"]);
    await createStaff(ctx.pool, tenant, "medtech@labq.ph", ["medical_technologist"]);
    await createStaff(ctx.pool, tenant, "medtech2@labq.ph", ["medical_technologist"]);
    admin = (await login(ctx, "admin@labq.ph")).accessToken;
    pathologist = (await login(ctx, "pathologist@labq.ph")).accessToken;
    medtech = (await login(ctx, "medtech@labq.ph")).accessToken;
    medtech2 = (await login(ctx, "medtech2@labq.ph")).accessToken;
    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
    const lab = async (path: string, body: object) => (await api(admin).post(`/laboratory${path}`, body).expect(201)).body.id as string;
    const chem = await lab("/departments", { code: "chem", name: "Chemistry" });
    const serum = await lab("/specimen-types", { code: "serum", name: "Serum" });
    ids = {
      chem,
      serum,
      glu: await lab("/tests", { code: "glu", name: "Glucose", departmentId: chem, specimenTypeId: serum, resultType: "numeric", unit: "mg/dL" }),
      esr: await lab("/tests", {
        code: "esr",
        name: "Erythrocyte sedimentation rate",
        departmentId: chem,
        specimenTypeId: serum,
        resultType: "numeric",
        unit: "mm/h",
        turnaroundMinutes: 30,
      }),
    };
  });
  afterAll(() => ctx.close());

  it("points to orders past their test's usual turnaround, or the catalog's target, with where each waits", async () => {
    // Five glucose results released one hour after collection: the usual turnaround here.
    for (let n = 0; n < 5; n++) {
      const { order, specimenId } = await collected(ids.glu);
      await api(medtech).post(`/laboratory/specimens/${specimenId}/receive`).expect(200);
      const result = (
        await api(medtech)
          .post(`/laboratory/order-items/${order.items[0].id}/results`, { valueNumeric: 90 + n })
          .expect(201)
      ).body.id;
      await api(admin).post(`/laboratory/results/${result}/verify`).expect(200);
      await api(admin).post(`/laboratory/results/${result}/approve`).expect(200);
      await api(admin).post(`/laboratory/orders/${order.id}/release`).expect(200);
    }
    await ctx.pool.query(
      `UPDATE lab_specimen s SET collected_at = r.released_at - interval '60 minutes'
       FROM lab_order_item i JOIN lab_result r ON r.order_item_id = i.id
       WHERE s.id = i.specimen_id AND r.test_id = $1 AND r.released_at IS NOT NULL`,
      [ids.glu],
    );
    // Two glucose orders waiting three hours (one received), and an ESR (target 30 minutes) waiting two.
    const waiting = [await collected(ids.glu), await collected(ids.glu)];
    await api(medtech).post(`/laboratory/specimens/${waiting[1]!.specimenId}/receive`).expect(200);
    const esr = await collected(ids.esr);
    const backdate = (specimenId: string, hours: number) =>
      ctx.pool.query(`UPDATE lab_specimen SET collected_at = now() - make_interval(hours => $2::int) WHERE id = $1`, [specimenId, hours]);
    for (const w of waiting) await backdate(w.specimenId, 3);
    await backdate(esr.specimenId, 2);

    expect((await surface(medtech, "laboratory")).items).toEqual([]);
    await turnOn("laboratory.turnaround-risk", { lookbackDays: 60, minReleases: 5, marginPercent: 25 });
    const found = (await surface(medtech, "laboratory")).items.filter((s) => s.ruleId === "laboratory.turnaround-risk");
    expect(found.map((s) => s.title).sort()).toEqual([
      "Erythrocyte sedimentation rate: 1 order past the usual turnaround (longest 2 h since collection)",
      "Glucose: 2 orders past the usual turnaround (longest 3 h since collection)",
    ]);
    const glucose = found.find((s) => s.title.startsWith("Glucose"))!;
    expect(glucose).toMatchObject({ severity: "warning", basis: "statistic" });
    expect(glucose.rationale).toMatch(/^Usually released within 1 h of collection here \(the median of 5 releases in 60 days\); at risk past 1 h 15 min\./);
    expect(glucose.evidence.map((e) => e.value?.replace(/^\d+ h(?: \d+ min)? since collection, /, "")).sort()).toEqual([
      "waiting for a result",
      "waiting to be received",
    ]);
    expect(glucose.action?.href).toMatch(/^\/laboratory\/worklist\?stage=(receive|enter)$/);
    const sed = found.find((s) => s.title.startsWith("Erythrocyte"))!;
    expect(sed).toMatchObject({ basis: "rule", action: { href: "/laboratory/worklist?stage=receive" } });
    expect(sed.rationale).toMatch(/^The catalog's turnaround target is 30 min\./);
    expect(JSON.stringify(found)).not.toMatch(/Juan|Dela Cruz/i);

    const replay = (await api(admin).post("/assistant/rules/laboratory.turnaround-risk/replay", { days: 2 }).expect(200)).body;
    expect(replay).toMatchObject({ readAt: "15:00" });
  });

  it("finds QC values drifting and shifted from the target per instrument, test and control lot, rejecting nothing", async () => {
    const quality = async (path: string, body: object) => (await api(pathologist).post(`/laboratory${path}`, body).expect(201)).body.id as string;
    const analyzer = await quality("/instruments", { code: "chem-1", name: "Chemistry analyzer 1" });
    const material = await quality("/qc/materials", { code: "chem-l1", name: "Chemistry control", level: "Level 1" });
    const lot = await quality(`/qc/materials/${material}/lots`, { lotNumber: "A100", expiresOn: manilaDate(365) });
    await quality(`/qc/lots/${lot}/targets`, { testId: ids.glu, instrumentId: analyzer, mean: 100, sd: 2 });
    const values = [101.8, 102.0, 101.6, 102.2, 101.4, 101.6, 102.0, 102.4, 102.8, 103.2];
    for (const [n, value] of values.entries()) {
      const runAt = new Date(Date.now() - (values.length - n) * 3_600_000).toISOString();
      await api(medtech).post("/laboratory/qc/runs", { instrumentId: analyzer, testId: ids.glu, qcLotId: lot, value, runAt }).expect(201);
    }
    const before = (await ctx.pool.query("SELECT status FROM lab_qc_run WHERE qc_lot_id = $1 ORDER BY run_at", [lot])).rows;

    await turnOn("laboratory.qc-trend");
    const [s] = (await surface(medtech, "laboratory-quality")).items.filter((x) => x.ruleId === "laboratory.qc-trend");
    expect(s).toMatchObject({ severity: "warning", basis: "statistic", action: { href: `/laboratory/qc?instrument=${analyzer}&test=${ids.glu}#qc-chart` } });
    expect(s!.title).toMatch(
      /^Glucose on Chemistry analyzer 1, Chemistry control \(Level 1\) lot A100: drifting up over the last 6 runs; the last 10 runs average \+1\.\d SD above the target mean$/,
    );
    expect(s!.evidence[0]!.value).toBe("+0.9, +1.0, +0.8, +1.1, +0.7, +0.8, +1.0, +1.2, +1.4, +1.6");
    // The runs' own evaluation is untouched.
    expect((await ctx.pool.query("SELECT status FROM lab_qc_run WHERE qc_lot_id = $1 ORDER BY run_at", [lot])).rows).toEqual(before);
  });

  it("shows quality managers a collector whose share of rejected specimens stands out, by count only", async () => {
    // The first technologist's specimens so far (eight, none rejected) and six more, three of them rejected; six by the second.
    for (let n = 0; n < 6; n++) {
      const { specimenId } = await collected(ids.glu);
      if (n < 3) await api(medtech).post(`/laboratory/specimens/${specimenId}/reject`, { reason: "Haemolysed sample", requestRecollection: false }).expect(200);
    }
    for (let n = 0; n < 6; n++) await collected(ids.glu, medtech2);

    await turnOn("laboratory.rejection-rate", { windowDays: 30, minSpecimens: 5, minRejections: 2, multiple: 2 });
    const found = (await surface(pathologist, "laboratory-quality")).items.filter((s) => s.ruleId === "laboratory.rejection-rate");
    expect(found.map((s) => s.title)).toEqual(["medtech@labq.ph: 3 of 14 specimens rejected in 30 days (21.4%), against 0% for others here"]);
    expect(JSON.stringify(found)).not.toMatch(/Haemolysed|Juan|Dela Cruz/i);
    // A technologist reads QC suggestions but not rejection rates: that rule is withheld, without counts.
    const theirs = await surface(medtech, "laboratory-quality");
    expect(theirs.items.map((s) => s.ruleId)).not.toContain("laboratory.rejection-rate");
    expect(theirs.withheld.map((w) => w.ruleId)).toContain("laboratory.rejection-rate");
    const audit = await auditRows(ctx.pool, "action = 'assistant.view' AND metadata->>'surface' = 'laboratory-quality'");
    expect(audit.map((a) => a.metadata)).toContainEqual(expect.objectContaining({ rules: ["laboratory.qc-trend", "laboratory.rejection-rate"] }));
  });
});
