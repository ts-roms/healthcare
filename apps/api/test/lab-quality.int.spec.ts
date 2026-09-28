import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * Phase 9 — laboratory quality management: instruments with their
 * maintenance/calibration log, internal QC evaluated with the facility's
 * Westgard rules, corrective actions, and the QC check on patient results
 * entered on an instrument.
 */
describe("laboratory quality control and instruments", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let medtech: string;
  let medtech2: string;
  let pathologist: string;
  let doctor: string;
  let patientId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "lab-qc-org");
    await createStaff(ctx.pool, tenant, "admin@example.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "medtech@example.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "medtech2@example.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "patho@example.ph", ["pathologist"]);
    await createStaff(ctx.pool, tenant, "doctor@example.ph", ["physician"]);
    admin = (await login(ctx, "admin@example.ph")).accessToken;
    medtech = (await login(ctx, "medtech@example.ph")).accessToken;
    medtech2 = (await login(ctx, "medtech2@example.ph")).accessToken;
    pathologist = (await login(ctx, "patho@example.ph")).accessToken;
    doctor = (await login(ctx, "doctor@example.ph")).accessToken;
    patientId = (await ctx.http().post("/api/v1/patients").set(as(admin, tenant.facilityId)).send(juan).expect(201)).body.id;

    ids.chem = (await req("post", "/departments", admin, { code: "chem", name: "Clinical Chemistry" }).expect(201)).body.id;
    ids.serum = (await req("post", "/specimen-types", admin, { code: "serum", name: "Serum" }).expect(201)).body.id;
    const test = (code: string, extra: object) =>
      req("post", "/tests", pathologist, { code, name: code.toUpperCase(), departmentId: ids.chem, specimenTypeId: ids.serum, ...extra }).expect(201);
    ids.glu = (await test("glu", { resultType: "numeric", unit: "mmol/L", decimalPlaces: 1 })).body.id;
    ids.hbsag = (await test("hbsag", { resultType: "coded", codedValues: ["Reactive", "Non-reactive"] })).body.id;
  });

  afterAll(() => ctx.close());

  function req(method: "get" | "post" | "put" | "patch", path: string, token: string, body?: object, facilityId: string | null = tenant.facilityId) {
    const call = ctx
      .http()
      [method](`/api/v1/laboratory${path}`)
      .set(as(token, facilityId ?? undefined));
    return body ? call.send(body) : call;
  }

  describe("instruments", () => {
    it("registers instruments (lab.qc.manage) at the selected facility", async () => {
      await req("post", "/instruments", medtech, { code: "cobas-1", name: "Chemistry analyzer 1" }).expect(403);
      const created = await req("post", "/instruments", pathologist, {
        code: "cobas-1",
        name: "Chemistry analyzer 1",
        departmentId: ids.chem,
        manufacturer: "Roche",
        serialNumber: "SN-001",
      }).expect(201);
      expect(created.body).toMatchObject({ status: "active", facilityId: tenant.facilityId, version: 1 });
      ids.analyzer = created.body.id;
      await req("post", "/instruments", pathologist, { code: "cobas-1", name: "Duplicate" }).expect(409);
      ids.spare = (await req("post", "/instruments", pathologist, { code: "spare-1", name: "Spare analyzer" }).expect(201)).body.id;
      const renamed = await req("patch", `/instruments/${ids.spare}`, pathologist, { model: "c311", version: 1 }).expect(200);
      expect(renamed.body).toMatchObject({ model: "c311", version: 2 });
      await req("patch", `/instruments/${ids.spare}`, pathologist, { model: "c501", version: 1 }).expect(409);
    });

    it("keeps an append-only maintenance and calibration log and flags overdue calibration", async () => {
      await req("post", `/instruments/${ids.analyzer}/log`, medtech, { kind: "calibration" }).expect(422);
      const yesterday = new Date(Date.now() - 36 * 3_600_000).toISOString().slice(0, 10);
      await req("post", `/instruments/${ids.analyzer}/log`, medtech, { kind: "calibration", outcome: "pass", nextDueOn: yesterday }).expect(201);
      await req("post", `/instruments/${ids.analyzer}/log`, medtech, { kind: "maintenance", notes: "Daily maintenance" }).expect(201);
      const list = await req("get", "/instruments", medtech).expect(200);
      const analyzer = list.body.find((i: { id: string }) => i.id === ids.analyzer);
      expect(analyzer).toMatchObject({ calibrationOverdue: true, lastCalibration: { outcome: "pass", nextDueOn: yesterday } });
      expect(analyzer.lastMaintenance).not.toBeNull();
      const log = await req("get", `/instruments/${ids.analyzer}/log`, medtech).expect(200);
      expect(log.body.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(["calibration", "maintenance"]));
      expect(log.body[0].recordedByName).toBe("medtech@example.ph");
      await expect(ctx.pool.query(`UPDATE lab_instrument_event SET notes = 'x' WHERE instrument_id = $1`, [ids.analyzer])).rejects.toThrow();
    });

    it("takes instruments out of service and back, and retires them (lab.qc.manage)", async () => {
      await req("post", `/instruments/${ids.spare}/log`, medtech, { kind: "out_of_service" }).expect(422);
      await req("post", `/instruments/${ids.spare}/log`, medtech, { kind: "out_of_service", notes: "Lamp failure" }).expect(201);
      await req("post", `/instruments/${ids.spare}/log`, medtech, { kind: "out_of_service", notes: "Again" }).expect(409);
      await req("post", `/instruments/${ids.spare}/log`, medtech, { kind: "retired", notes: "Replaced" }).expect(403);
      await req("post", `/instruments/${ids.spare}/log`, pathologist, { kind: "retired", notes: "Replaced" }).expect(201);
      const list = await req("get", "/instruments", medtech).expect(200);
      expect(list.body.map((i: { id: string }) => i.id)).not.toContain(ids.spare);
      const all = await req("get", "/instruments?includeRetired=true", medtech).expect(200);
      expect(all.body.find((i: { id: string }) => i.id === ids.spare).status).toBe("retired");
      await req("post", `/instruments/${ids.spare}/log`, pathologist, { kind: "maintenance" }).expect(422);
    });

    it("is scoped to the organization and facility", async () => {
      await req("get", "/instruments", doctor).expect(403);
      await req("post", `/instruments/${ids.analyzer}/log`, medtech, { kind: "maintenance" }, tenant.otherFacilityId).expect(403);
      const other = await createTenant(ctx.pool, "other-qc-org");
      await createStaff(ctx.pool, other, "patho2@example.ph", ["pathologist"]);
      const outsider = (await login(ctx, "patho2@example.ph")).accessToken;
      await req("get", `/instruments/${ids.analyzer}/log`, outsider, undefined, null).expect(404);
    });
  });

  describe("QC", () => {
    it("sets up control materials, lots and versioned targets", async () => {
      await req("post", "/qc/materials", medtech, { code: "chem-l1", name: "Chemistry control", level: "Level 1" }).expect(403);
      ids.l1Material = (await req("post", "/qc/materials", pathologist, { code: "chem-l1", name: "Chemistry control", level: "Level 1" }).expect(201)).body.id;
      ids.l2Material = (await req("post", "/qc/materials", pathologist, { code: "chem-l2", name: "Chemistry control", level: "Level 2" }).expect(201)).body.id;
      const expires = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
      ids.l1 = (await req("post", `/qc/materials/${ids.l1Material}/lots`, pathologist, { lotNumber: "A100", expiresOn: expires }).expect(201)).body.id;
      ids.l2 = (await req("post", `/qc/materials/${ids.l2Material}/lots`, pathologist, { lotNumber: "B200", expiresOn: expires }).expect(201)).body.id;
      await req("post", `/qc/materials/${ids.l1Material}/lots`, pathologist, { lotNumber: "A100", expiresOn: expires }).expect(409);
      ids.expired = (await req("post", `/qc/materials/${ids.l1Material}/lots`, pathologist, { lotNumber: "OLD", expiresOn: "2020-01-01" }).expect(201)).body.id;

      await req("post", `/qc/lots/${ids.l1}/targets`, pathologist, { testId: ids.hbsag, instrumentId: ids.analyzer, mean: 1, sd: 1 }).expect(422);
      const first = await req("post", `/qc/lots/${ids.l1}/targets`, pathologist, { testId: ids.glu, instrumentId: ids.analyzer, mean: 5.2, sd: 0.3 }).expect(
        201,
      );
      await req("post", `/qc/lots/${ids.l1}/targets`, pathologist, {
        testId: ids.glu,
        instrumentId: ids.analyzer,
        mean: 5.0,
        sd: 0.2,
        source: "Own data, 20 runs",
      }).expect(201);
      await req("post", `/qc/lots/${ids.l2}/targets`, pathologist, { testId: ids.glu, instrumentId: ids.analyzer, mean: 15, sd: 0.5 }).expect(201);
      await req("post", `/qc/lots/${ids.expired}/targets`, pathologist, { testId: ids.glu, instrumentId: ids.analyzer, mean: 5, sd: 0.2 }).expect(201);
      const history = await ctx.pool.query(`SELECT effective_to FROM lab_qc_target WHERE id = $1`, [first.body.id]);
      expect(history.rows[0].effective_to).not.toBeNull();
      await expect(ctx.pool.query(`UPDATE lab_qc_target SET mean = 9 WHERE id = $1`, [first.body.id])).rejects.toThrow(/immutable/);

      const materials = await req("get", "/qc/materials", medtech).expect(200);
      const l1 = materials.body.find((m: { id: string }) => m.id === ids.l1Material).lots.find((l: { id: string }) => l.id === ids.l1);
      expect(l1.targets).toHaveLength(1);
      expect(l1.targets[0]).toMatchObject({ mean: 5, sd: 0.2, testCode: "glu", instrumentName: "Chemistry analyzer 1", source: "Own data, 20 runs" });
    });

    it("evaluates runs with the facility's Westgard rules", async () => {
      const run = (qcLotId: string, value: number) => req("post", "/qc/runs", medtech, { instrumentId: ids.analyzer, testId: ids.glu, qcLotId, value });
      await run(ids.expired, 5)
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("qc_lot_expired"));
      await req("post", "/qc/runs", doctor, { instrumentId: ids.analyzer, testId: ids.glu, qcLotId: ids.l1, value: 5 }).expect(403);

      const ok = await run(ids.l1, 5.1).expect(201);
      expect(ok.body).toMatchObject({ status: "accepted", zScore: 0.5, violations: [], targetMean: 5, targetSd: 0.2, lotNumber: "A100", level: "Level 1" });
      const warn = await run(ids.l1, 5.45).expect(201);
      expect(warn.body).toMatchObject({ status: "warning", violations: ["1_2s"], zScore: 2.25 });
      // Level 2 also beyond +2 SD right after: 2_2s across levels rejects the run.
      const rejected = await run(ids.l2, 16.1).expect(201);
      expect(rejected.body).toMatchObject({ status: "rejected", violations: ["1_2s", "2_2s"] });
      ids.rejectedRun = rejected.body.id;
      const event = await ctx.pool.query(`SELECT payload FROM domain_event WHERE event_type = 'LaboratoryQcRunRejected' AND aggregate_id = $1`, [
        ids.rejectedRun,
      ]);
      expect(event.rows[0].payload).toMatchObject({ instrumentId: ids.analyzer, violations: ["1_2s", "2_2s"] });
      await expect(ctx.pool.query(`UPDATE lab_qc_run SET status = 'accepted' WHERE id = $1`, [ids.rejectedRun])).rejects.toThrow();

      await req("post", `/qc/runs/${ok.body.id}/actions`, medtech, { action: "Nothing to do" }).expect(422);
      await req("post", `/qc/runs/${ids.rejectedRun}/actions`, medtech, { action: "Reagent pack replaced, recalibrated, level 2 re-run" }).expect(201);

      const series = await req("get", `/qc/runs?instrumentId=${ids.analyzer}&testId=${ids.glu}`, medtech).expect(200);
      expect(series.body.map((r: { status: string }) => r.status)).toEqual(["accepted", "warning", "rejected"]);
      expect(series.body[2].actions[0]).toMatchObject({ action: "Reagent pack replaced, recalibrated, level 2 re-run", recordedByName: "medtech@example.ph" });
      const l2Only = await req("get", `/qc/runs?instrumentId=${ids.analyzer}&testId=${ids.glu}&qcLotId=${ids.l2}`, medtech).expect(200);
      expect(l2Only.body).toHaveLength(1);
    });

    it("shows the QC board per test and instrument, decided by the worst latest level", async () => {
      const board = await req("get", "/qc/status", medtech).expect(200);
      expect(board.body.policy).toEqual({ qcRequired: false, qcValidHours: 24, qcRejectRules: ["1_3s", "2_2s", "R_4s"], qcAfterReagentChange: true });
      const row = board.body.rows.find((r: { testId: string }) => r.testId === ids.glu);
      expect(row).toMatchObject({ instrumentId: ids.analyzer, decisiveRun: { id: ids.rejectedRun, status: "rejected" }, resultsAllowed: true });
      expect(row.lots).toHaveLength(2);
    });
  });

  describe("patient results on an instrument", () => {
    let itemId: string;
    let resultId: string;

    beforeAll(async () => {
      const order = await req("post", "/orders", medtech, { patientId, source: "external", externalOrderer: "Dr. Reyes", testIds: [ids.glu] }).expect(201);
      itemId = order.body.items[0].id;
      const collected = await req("post", `/orders/${order.body.id}/specimens`, medtech, { specimenTypeId: ids.serum, itemIds: [itemId] }).expect(201);
      await req("post", `/specimens/${collected.body.specimens[0].id}/receive`, medtech).expect(200);
    });

    it("links the instrument and snapshots the QC in force", async () => {
      await req("post", `/order-items/${itemId}/results`, medtech, { valueNumeric: 6.1, instrumentId: ids.spare }).expect(422);
      const result = await req("post", `/order-items/${itemId}/results`, medtech, { valueNumeric: 6.1, instrumentId: ids.analyzer }).expect(201);
      expect(result.body).toMatchObject({ instrumentId: ids.analyzer, instrument: "Chemistry analyzer 1", qcRunId: ids.rejectedRun, qcStatus: "rejected" });
      resultId = result.body.id;
      await expect(ctx.pool.query(`UPDATE lab_result SET qc_status = 'accepted' WHERE id = $1`, [resultId])).rejects.toThrow(/immutable/);
    });

    it("refuses results while a control level is rejected when the facility requires QC", async () => {
      await req("put", "/policy", medtech, {
        allowSelfVerification: false,
        allowSelfApproval: false,
        releaseOnApproval: false,
        qcRequired: true,
        reason: "x",
      }).expect(403);
      const policy = await req("put", "/policy", pathologist, {
        allowSelfVerification: false,
        allowSelfApproval: false,
        releaseOnApproval: false,
        qcRequired: true,
        qcRejectRules: ["1_3s", "2_2s", "R_4s", "4_1s", "2_2s"],
        reason: "Accreditation preparation: patient results need accepted QC",
      }).expect(200);
      expect(policy.body).toMatchObject({ qcRequired: true, qcValidHours: 24, qcRejectRules: ["1_3s", "2_2s", "R_4s", "4_1s"] });
      // The existing policy form (without QC fields) keeps the QC settings.
      const kept = await req("put", "/policy", pathologist, {
        allowSelfVerification: true,
        allowSelfApproval: false,
        releaseOnApproval: false,
        reason: "Night shift has one medical technologist",
      }).expect(200);
      expect(kept.body).toMatchObject({ allowSelfVerification: true, qcRequired: true, qcRejectRules: ["1_3s", "2_2s", "R_4s", "4_1s"] });

      const correct = (body: object) => req("post", `/results/${resultId}/correct`, medtech, { reason: "Re-run on analyzer", ...body });
      await correct({ valueNumeric: 6.0, instrumentId: ids.analyzer })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("qc_not_accepted"));
      // Level 1 accepted again does not clear the rejected level 2.
      await req("post", "/qc/runs", medtech2, { instrumentId: ids.analyzer, testId: ids.glu, qcLotId: ids.l1, value: 5.0 }).expect(201);
      await correct({ valueNumeric: 6.0, instrumentId: ids.analyzer }).expect(422);
      await req("post", "/qc/runs", medtech2, { instrumentId: ids.analyzer, testId: ids.glu, qcLotId: ids.l2, value: 15.2 }).expect(201);
      const corrected = await correct({ valueNumeric: 6.0, instrumentId: ids.analyzer }).expect(201);
      expect(corrected.body).toMatchObject({ versionNumber: 2, qcStatus: "accepted" });
      const board = await req("get", "/qc/status", medtech).expect(200);
      expect(board.body.rows[0]).toMatchObject({ resultsAllowed: true, decisiveRun: { status: "accepted" } });
      // Results without an instrument are not gated (manual methods).
    });

    it("audits quality changes", async () => {
      const actions = (await auditRows(ctx.pool, "action LIKE 'lab.qc.%' OR action LIKE 'lab.instrument.%'")).map((a) => a.action);
      for (const action of [
        "lab.instrument.create",
        "lab.instrument.update",
        "lab.instrument.log",
        "lab.qc.material.create",
        "lab.qc.lot.create",
        "lab.qc.target.set",
        "lab.qc.run.record",
        "lab.qc.action.record",
      ]) {
        expect(actions).toContain(action);
      }
      const policy = await auditRows(ctx.pool, "action = 'lab.policy.update'");
      expect(policy[0]?.reason).toBe("Accreditation preparation: patient results need accepted QC");
    });
  });
});
