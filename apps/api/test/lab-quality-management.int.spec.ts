import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * Phase 9 — laboratory quality management: temperature monitoring with
 * excursions opening nonconformances, nonconformance and CAPA, EQA with the
 * provider's evaluation, and staff competency (optionally required for
 * result entry).
 */
describe("laboratory quality management", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let medtech: string;
  let medtech2: string;
  let pathologist: string;
  let doctor: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "lab-qm-org");
    await createStaff(ctx.pool, tenant, "admin@example.ph", ["org_admin"]);
    ids.medtechUser = await createStaff(ctx.pool, tenant, "medtech@example.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    ids.medtech2User = await createStaff(ctx.pool, tenant, "medtech2@example.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "annex-tech@example.ph", [{ role: "medical_technologist", facilityId: tenant.otherFacilityId }]);
    await createStaff(ctx.pool, tenant, "patho@example.ph", ["pathologist"]);
    await createStaff(ctx.pool, tenant, "doctor@example.ph", ["physician"]);
    admin = (await login(ctx, "admin@example.ph")).accessToken;
    medtech = (await login(ctx, "medtech@example.ph")).accessToken;
    medtech2 = (await login(ctx, "medtech2@example.ph")).accessToken;
    pathologist = (await login(ctx, "patho@example.ph")).accessToken;
    doctor = (await login(ctx, "doctor@example.ph")).accessToken;
    ids.patient = (await ctx.http().post("/api/v1/patients").set(as(admin, tenant.facilityId)).send(juan).expect(201)).body.id;
    ids.chem = (await lab("post", "/departments", admin, { code: "chem", name: "Clinical Chemistry" }).expect(201)).body.id;
    ids.serum = (await lab("post", "/specimen-types", admin, { code: "serum", name: "Serum" }).expect(201)).body.id;
    ids.glu = (
      await lab("post", "/tests", pathologist, {
        code: "glu",
        name: "Glucose",
        departmentId: ids.chem,
        specimenTypeId: ids.serum,
        resultType: "numeric",
        unit: "mmol/L",
        decimalPlaces: 1,
      }).expect(201)
    ).body.id;
  });

  afterAll(() => ctx.close());

  function lab(method: "get" | "post" | "put" | "patch", path: string, token: string, body?: object) {
    const call = ctx.http()[method](`/api/v1/laboratory${path}`).set(as(token, tenant.facilityId));
    return body ? call.send(body) : call;
  }

  describe("temperature monitoring", () => {
    it("registers storage units with the laboratory's own range and interval", async () => {
      await lab("post", "/storage-units", medtech, { code: "fridge-1", name: "Reagent fridge", kind: "refrigerator", minCelsius: 2, maxCelsius: 8 }).expect(
        403,
      );
      await lab("post", "/storage-units", pathologist, { code: "fridge-1", name: "Reagent fridge", kind: "refrigerator", minCelsius: 8, maxCelsius: 2 }).expect(
        400,
      );
      const unit = await lab("post", "/storage-units", pathologist, {
        code: "fridge-1",
        name: "Reagent fridge",
        kind: "refrigerator",
        minCelsius: 2,
        maxCelsius: 8,
        readingIntervalHours: 12,
        departmentId: ids.chem,
      }).expect(201);
      ids.fridge = unit.body.id;
      const units = await lab("get", "/storage-units", medtech).expect(200);
      expect(units.body[0]).toMatchObject({ code: "fridge-1", lastReading: null, readingDue: true, excursionsLast7Days: 0 });
    });

    it("records readings; an excursion needs a note and opens a nonconformance", async () => {
      await lab("post", `/storage-units/${ids.fridge}/readings`, doctor, { celsius: 4.5 }).expect(403);
      const ok = await lab("post", `/storage-units/${ids.fridge}/readings`, medtech, { celsius: 4.5 }).expect(201);
      expect(ok.body).toMatchObject({ outOfRange: false, minCelsius: 2, maxCelsius: 8, nonconformanceId: null, recordedByName: "medtech@example.ph" });
      expect((await lab("get", "/storage-units", medtech).expect(200)).body[0]).toMatchObject({ readingDue: false, lastReading: { celsius: 4.5 } });

      await lab("post", `/storage-units/${ids.fridge}/readings`, medtech, { celsius: 9.2 })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("excursion_note_required"));
      const excursion = await lab("post", `/storage-units/${ids.fridge}/readings`, medtech, {
        celsius: 9.2,
        note: "Door found ajar; closed, reagents moved to fridge 2",
      }).expect(201);
      expect(excursion.body).toMatchObject({ outOfRange: true, nonconformanceId: expect.any(String) });
      ids.excursionNc = excursion.body.nonconformanceId;
      const nc = await lab("get", `/nonconformances/${ids.excursionNc}`, medtech).expect(200);
      expect(nc.body).toMatchObject({
        category: "temperature_excursion",
        severity: "major",
        status: "open",
        temperatureReadingId: excursion.body.id,
        number: "NC00000001",
      });
      expect(nc.body.description).toContain("Door found ajar");
      expect((await lab("get", "/storage-units", medtech).expect(200)).body[0].excursionsLast7Days).toBe(1);
      await expect(ctx.pool.query(`UPDATE lab_temperature_reading SET celsius = 5 WHERE id = $1`, [excursion.body.id])).rejects.toThrow();
    });

    it("changes a unit's range for later readings only (reason required)", async () => {
      await lab("patch", `/storage-units/${ids.fridge}`, pathologist, { maxCelsius: 10, version: 1 }).expect(400);
      await lab("patch", `/storage-units/${ids.fridge}`, pathologist, { maxCelsius: 10, reason: "Manufacturer allows up to 10 °C", version: 1 }).expect(200);
      const later = await lab("post", `/storage-units/${ids.fridge}/readings`, medtech, { celsius: 9.2 }).expect(201);
      expect(later.body).toMatchObject({ outOfRange: false, maxCelsius: 10 });
      const readings = await lab("get", `/storage-units/${ids.fridge}/readings`, medtech).expect(200);
      expect(readings.body.map((r: { maxCelsius: number }) => r.maxCelsius)).toEqual([8, 8, 10]);
    });
  });

  describe("nonconformance and corrective action", () => {
    it("reports an incident about a specimen and follows it to closing", async () => {
      const order = await lab("post", "/orders", medtech, {
        patientId: ids.patient,
        source: "external",
        externalOrderer: "Dr. Reyes",
        testIds: [ids.glu],
      }).expect(201);
      ids.item = order.body.items[0].id;
      const collected = await lab("post", `/orders/${order.body.id}/specimens`, medtech, { specimenTypeId: ids.serum, itemIds: [ids.item] }).expect(201);
      const accession = collected.body.specimens[0].accessionNumber;
      await lab("post", `/specimens/${collected.body.specimens[0].id}/receive`, medtech).expect(200);

      const base = { category: "pre_analytical", severity: "minor", title: "Label smudged", description: "Tube label partly unreadable at receipt" };
      await lab("post", "/nonconformances", medtech, { ...base, specimenAccession: "0000000000" }).expect(404);
      const created = await lab("post", "/nonconformances", medtech, { ...base, specimenAccession: accession }).expect(201);
      expect(created.body).toMatchObject({ number: "NC00000002", status: "open", specimenAccession: accession, reportedByName: "medtech@example.ph" });
      expect(created.body.missingToClose).toEqual(["root cause", "corrective action", "effectiveness check"]);
      ids.nc = created.body.id;

      const add = (kind: string, body: string, token = medtech) => lab("post", `/nonconformances/${ids.nc}/entries`, token, { kind, body });
      expect((await add("note", "Collector informed").expect(201)).body.status).toBe("open");
      expect((await add("correction", "Relabelled after identity check against the order").expect(201)).body.status).toBe("investigating");

      await lab("post", `/nonconformances/${ids.nc}/close`, medtech, { summary: "Done", version: 2 }).expect(403);
      await lab("post", `/nonconformances/${ids.nc}/close`, pathologist, { summary: "Done", version: 2 })
        .expect(422)
        .expect((r) =>
          expect(r.body.error).toMatchObject({
            code: "nonconformance_incomplete",
            details: { missing: ["root cause", "corrective action", "effectiveness check"] },
          }),
        );
      await add("root_cause", "Alcohol swab used on the label");
      await add("corrective_action", "Labels applied after skin preparation; phlebotomy briefing");
      const reclassified = await lab("post", `/nonconformances/${ids.nc}/reclassify`, pathologist, {
        severity: "major",
        reason: "Could have led to misidentification",
        version: 2,
      }).expect(200);
      expect(reclassified.body).toMatchObject({ severity: "major", version: 3 });
      await add("effectiveness_check", "No smudged labels in 30 days of audit");
      const closed = await lab("post", `/nonconformances/${ids.nc}/close`, pathologist, { summary: "Effective; closed", version: 3 }).expect(200);
      expect(closed.body).toMatchObject({ status: "closed", missingToClose: [] });
      expect(closed.body.entries.map((e: { kind: string }) => e.kind)).toEqual([
        "note",
        "correction",
        "root_cause",
        "corrective_action",
        "reclassified",
        "effectiveness_check",
        "closed",
      ]);

      await add("note", "Too late").expect(422);
      await expect(ctx.pool.query(`UPDATE lab_nonconformance SET title = 'x' WHERE id = $1`, [ids.nc])).rejects.toThrow(/closed/);
      await expect(ctx.pool.query(`DELETE FROM lab_nonconformance_entry WHERE nonconformance_id = $1`, [ids.nc])).rejects.toThrow();
      const open = await lab("get", "/nonconformances", medtech).expect(200);
      expect(open.body.map((n: { id: string }) => n.id)).toEqual([ids.excursionNc]);
      expect((await lab("get", "/nonconformances?status=all", medtech).expect(200)).body).toHaveLength(2);
    });
  });

  describe("external quality assessment", () => {
    it("records rounds, reported results and the provider's evaluation", async () => {
      await lab("post", "/eqa/schemes", medtech, { code: "chem-eqa", provider: "Example EQA Provider", name: "Clinical chemistry" }).expect(403);
      ids.scheme = (
        await lab("post", "/eqa/schemes", pathologist, { code: "chem-eqa", provider: "Example EQA Provider", name: "Clinical chemistry" }).expect(201)
      ).body.id;
      const survey = await lab("post", "/eqa/surveys", medtech, {
        schemeId: ids.scheme,
        roundCode: "2026-3",
        receivedOn: "2026-09-01",
        dueOn: "2026-09-20",
      }).expect(201);
      await lab("post", "/eqa/surveys", medtech, { schemeId: ids.scheme, roundCode: "2026-3", receivedOn: "2026-09-01" }).expect(409);
      const report = (sampleCode: string, reportedValue: string) =>
        lab("post", `/eqa/surveys/${survey.body.id}/results`, medtech, { testId: ids.glu, sampleCode, reportedValue });
      const s1 = await report("S1", "5.4").expect(201);
      const s2 = await report("S2", "12.9").expect(201);
      await report("S1", "5.5").expect(409);

      await lab("post", `/eqa/results/${s1.body.id}/evaluation`, medtech, { evaluation: "acceptable", targetValue: "5.3", providerScore: "0.4" }).expect(200);
      const failed = await lab("post", `/eqa/results/${s2.body.id}/evaluation`, medtech, {
        evaluation: "unacceptable",
        targetValue: "11.1",
        providerScore: "3.2",
      }).expect(200);
      expect(failed.body.nonconformanceId).toEqual(expect.any(String));
      await lab("post", `/eqa/results/${s2.body.id}/evaluation`, medtech, { evaluation: "acceptable" })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("eqa_already_evaluated"));
      await expect(ctx.pool.query(`UPDATE lab_eqa_result SET reported_value = '11' WHERE id = $1`, [s2.body.id])).rejects.toThrow();

      const surveys = await lab("get", "/eqa/surveys", medtech).expect(200);
      expect(surveys.body[0]).toMatchObject({ status: "evaluated", scheme: { provider: "Example EQA Provider" } });
      expect(surveys.body[0].results.find((r: { sampleCode: string }) => r.sampleCode === "S2")).toMatchObject({
        evaluation: "unacceptable",
        nonconformance: { id: failed.body.nonconformanceId },
      });
      const nc = await lab("get", `/nonconformances/${failed.body.nonconformanceId}`, medtech).expect(200);
      expect(nc.body).toMatchObject({ category: "eqa_failure", eqaResultId: s2.body.id });
      expect(nc.body.description).toContain("reported 12.9, target 11.1, provider score 3.2");
    });
  });

  describe("staff competency", () => {
    it("lists result-entering staff of the facility and records assessments", async () => {
      const overview = await lab("get", "/competency", medtech).expect(200);
      const names = overview.body.staff.map((s: { displayName: string }) => s.displayName);
      expect(names).toEqual(expect.arrayContaining(["medtech@example.ph", "medtech2@example.ph"]));
      expect(names).not.toContain("annex-tech@example.ph");
      expect(names).not.toContain("doctor@example.ph");

      const assess = (token: string, body: object) => lab("post", "/competency", token, body);
      const today = new Date().toISOString().slice(0, 10);
      const nextYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
      await assess(medtech, { userId: ids.medtech2User, departmentId: ids.chem, method: "direct_observation", outcome: "competent", assessedOn: today }).expect(
        403,
      );
      await assess(pathologist, {
        userId: ids.medtechUser,
        testId: ids.glu,
        departmentId: ids.chem,
        method: "direct_observation",
        outcome: "competent",
        assessedOn: today,
      }).expect(400);
      await assess(pathologist, { userId: ids.medtech2User, testId: ids.glu, method: "blind_sample", outcome: "not_yet_competent", assessedOn: today }).expect(
        400,
      );
      await assess(pathologist, {
        userId: ids.medtechUser,
        departmentId: ids.chem,
        method: "direct_observation",
        outcome: "competent",
        assessedOn: today,
        nextDueOn: nextYear,
      }).expect(201);
      await assess(pathologist, {
        userId: ids.medtech2User,
        testId: ids.glu,
        method: "blind_sample",
        outcome: "not_yet_competent",
        assessedOn: today,
        notes: "Repeat pipetting technique under supervision",
      }).expect(201);
      const adminId = (await ctx.pool.query<{ id: string }>(`SELECT id FROM app_user WHERE email = 'admin@example.ph'`)).rows[0]!.id;
      await assess(admin, { userId: adminId, departmentId: ids.chem, method: "other", outcome: "competent", assessedOn: today }).expect(403);

      const after = await lab("get", "/competency", medtech).expect(200);
      const medtechRow = after.body.staff.find((s: { userId: string }) => s.userId === ids.medtechUser);
      expect(medtechRow.areas).toEqual([expect.objectContaining({ departmentId: ids.chem, state: "competent", assessedByName: "patho@example.ph" })]);
      const medtech2Row = after.body.staff.find((s: { userId: string }) => s.userId === ids.medtech2User);
      expect(medtech2Row.areas[0]).toMatchObject({ testId: ids.glu, state: "not_yet_competent" });
      await expect(ctx.pool.query(`DELETE FROM lab_competency_assessment WHERE user_id = $1`, [ids.medtechUser])).rejects.toThrow();
    });

    it("refuses result entry without a current competency when the facility requires it", async () => {
      await lab("put", "/policy", pathologist, {
        allowSelfVerification: false,
        allowSelfApproval: false,
        releaseOnApproval: false,
        competencyRequired: true,
        reason: "Competency assessment programme in force",
      }).expect(200);
      await lab("post", `/order-items/${ids.item}/results`, medtech2, { valueNumeric: 5.1 })
        .expect(422)
        .expect((r) => expect(r.body.error.code).toBe("competency_required"));
      await lab("post", `/order-items/${ids.item}/results`, medtech, { valueNumeric: 5.1 }).expect(201);
    });
  });

  it("audits and publishes quality events", async () => {
    const actions = new Set((await auditRows(ctx.pool, "action LIKE 'lab.%'")).map((a) => a.action));
    for (const action of [
      "lab.storage-unit.create",
      "lab.storage-unit.update",
      "lab.temperature.record",
      "lab.nonconformance.open",
      "lab.nonconformance.entry",
      "lab.nonconformance.reclassify",
      "lab.nonconformance.close",
      "lab.eqa.scheme.create",
      "lab.eqa.survey.create",
      "lab.eqa.result.report",
      "lab.eqa.result.evaluate",
      "lab.competency.record",
    ]) {
      expect(actions).toContain(action);
    }
    const events = await ctx.pool.query<{ event_type: string }>(`SELECT DISTINCT event_type FROM domain_event WHERE event_type LIKE 'Laboratory%'`);
    expect(events.rows.map((e) => e.event_type)).toEqual(
      expect.arrayContaining([
        "LaboratoryTemperatureExcursion",
        "LaboratoryNonconformanceOpened",
        "LaboratoryNonconformanceClosed",
        "LaboratoryEqaResultUnacceptable",
      ]),
    );
  });
});
