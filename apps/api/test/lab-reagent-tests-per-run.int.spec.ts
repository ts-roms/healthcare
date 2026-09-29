import { randomUUID } from "node:crypto";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

/**
 * Tests per run per reagent and test (docs/domains/laboratory-quality.md, "Reagent use per test run"): a test run in
 * duplicate (or with a dilution or blank) uses more than one test of the reagent. QC runs and re-runs count their test's
 * tests per run; the first run of an order counts once per lot with the most of the ordered tests the lot serves. Runs
 * and tests are reported apart; the cost per patient run stays per run.
 */
describe("laboratory reagent tests per run", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let medtech: string;
  let pathologist: string;
  const ids: Record<string, string> = {};

  function lab(method: "get" | "post" | "put", path: string, token: string, body?: object) {
    const call = ctx.http()[method](`/api/v1/laboratory${path}`).set(as(token, tenant.facilityId));
    return body ? call.send(body) : call;
  }
  const loadView = async (loadId: string) =>
    ((await lab("get", `/reagents?instrumentId=${ids.analyzer}`, medtech).expect(200)).body as Array<{ id: string; use: Record<string, unknown> }>).find(
      (l) => l.id === loadId,
    )!;
  const patientRows = async (loadId: string) =>
    (
      await ctx.pool.query<{ tests: number; run_number: number }>(
        "SELECT tests, run_number FROM lab_reagent_use WHERE reagent_load_id = $1 AND kind = 'patient' ORDER BY run_number",
        [loadId],
      )
    ).rows;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "lab-tests-per-run-org");
    await createStaff(ctx.pool, tenant, "admin@perrun.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "medtech@perrun.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "patho@perrun.ph", ["pathologist"]);
    admin = (await login(ctx, "admin@perrun.ph")).accessToken;
    medtech = (await login(ctx, "medtech@perrun.ph")).accessToken;
    pathologist = (await login(ctx, "patho@perrun.ph")).accessToken;
    ids.patient = (await ctx.http().post("/api/v1/patients").set(as(admin, tenant.facilityId)).send(juan).expect(201)).body.id;

    ids.chem = (await lab("post", "/departments", admin, { code: "chem", name: "Clinical Chemistry" }).expect(201)).body.id;
    ids.serum = (await lab("post", "/specimen-types", admin, { code: "serum", name: "Serum" }).expect(201)).body.id;
    const test = (code: string, name: string) =>
      lab("post", "/tests", pathologist, {
        code,
        name,
        departmentId: ids.chem,
        specimenTypeId: ids.serum,
        resultType: "numeric",
        unit: "mmol/L",
        decimalPlaces: 1,
      })
        .expect(201)
        .then((r) => r.body.id as string);
    ids.glu = await test("glu", "Glucose");
    ids.chol = await test("chol", "Cholesterol");
    ids.analyzer = (await lab("post", "/instruments", pathologist, { code: "chem-1", name: "Chemistry analyzer 1" }).expect(201)).body.id;
    const material = await lab("post", "/qc/materials", pathologist, { code: "chem-l1", name: "Chemistry control", level: "Level 1" }).expect(201);
    ids.qcLot = (
      await lab("post", `/qc/materials/${material.body.id}/lots`, pathologist, { lotNumber: "A100", expiresOn: manilaDate(90) }).expect(201)
    ).body.id;
    for (const testId of [ids.glu, ids.chol]) {
      await lab("post", `/qc/lots/${ids.qcLot}/targets`, pathologist, { testId, instrumentId: ids.analyzer, mean: 5, sd: 0.2 }).expect(201);
    }

    // A multi-test reagent (₱5,000.00 a cassette), a glucose-only reagent, and a consumable.
    const inv = (path: string, body: object) => ctx.http().post(`/api/v1/inventory${path}`).set(as(admin, tenant.facilityId)).send(body).expect(201);
    ids.store = (await inv("/locations", { facilityId: tenant.facilityId, code: "lab-store", name: "Laboratory store" })).body.id;
    ids.reagent = (await inv("/items", { code: "chem-r1", name: "Chemistry reagent R1", category: "reagent", stockUnit: "cassette" })).body.id;
    ids.gluReagent = (await inv("/items", { code: "glu-r2", name: "Glucose reagent R2", category: "reagent", stockUnit: "bottle" })).body.id;
    ids.tube = (await inv("/items", { code: "tube-red", name: "Red-top tube", category: "laboratory_consumable", stockUnit: "piece" })).body.id;
    const receive = (itemId: string, lotNumber: string, unitCost?: number) =>
      inv("/receipts", { locationId: ids.store, itemId, lotNumber, expiryDate: manilaDate(120), quantity: 10, unitCost, idempotencyKey: randomUUID() });
    await receive(ids.reagent, "R-1", 500_000);
    await receive(ids.gluReagent, "G-1");
    const lots = await ctx.pool.query<{ id: string; lot_number: string }>("SELECT id, lot_number FROM inventory_lot WHERE organization_id = $1", [
      tenant.organizationId,
    ]);
    for (const l of lots.rows) ids[l.lot_number] = l.id;

    const order = await lab("post", "/orders", medtech, {
      patientId: ids.patient,
      source: "external",
      externalOrderer: "Dr. Reyes",
      testIds: [ids.glu, ids.chol],
    }).expect(201);
    ids.order = order.body.id;
    ids.gluItem = order.body.items.find((i: { testId: string }) => i.testId === ids.glu).id;
    ids.cholItem = order.body.items.find((i: { testId: string }) => i.testId === ids.chol).id;
    const collected = await lab("post", `/orders/${ids.order}/specimens`, medtech, { specimenTypeId: ids.serum, itemIds: [ids.gluItem, ids.cholItem] }).expect(
      201,
    );
    await lab("post", `/specimens/${collected.body.specimens[0].id}/receive`, medtech).expect(200);
  });

  afterAll(() => ctx.close());

  it("sets tests per run for a reagent and a test (quality managers; reagents only; 1 removes it; audited)", async () => {
    const set = (token: string, itemId: string, testId: string, testsPerRun: number) =>
      lab("put", `/reagents/yields/${itemId}/tests/${testId}`, token, { testsPerRun });
    await set(medtech, ids.reagent, ids.chol, 2).expect(403);
    await set(pathologist, ids.tube, ids.chol, 2)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("not_a_reagent"));
    await set(pathologist, ids.reagent, ids.chol, 101).expect(400);
    await set(pathologist, ids.reagent, ids.glu, 3).expect(200);
    const removed = await set(pathologist, ids.reagent, ids.glu, 1).expect(200);
    expect(removed.body).toEqual([]);
    await set(pathologist, ids.reagent, ids.chol, 2).expect(200);
    const listed = await set(pathologist, ids.gluReagent, ids.glu, 3).expect(200);
    expect(listed.body).toEqual([
      expect.objectContaining({ itemCode: "chem-r1", testName: "Cholesterol", testsPerRun: 2, updatedByName: "patho@perrun.ph" }),
      expect.objectContaining({ itemCode: "glu-r2", testName: "Glucose", testsPerRun: 3 }),
    ]);
    expect((await lab("get", "/reagents/tests-per-run", medtech).expect(200)).body).toHaveLength(2);
    const audit = await auditRows(ctx.pool, "action = 'lab.reagent.tests-per-run' AND organization_id = $1", [tenant.organizationId]);
    expect(audit.map((a) => a.metadata)).toEqual([
      expect.objectContaining({ testsPerRun: 3, previous: 1 }),
      expect.objectContaining({ testsPerRun: 1, previous: 3 }),
      expect.objectContaining({ testsPerRun: 2, previous: 1 }),
      expect.objectContaining({ testsPerRun: 3, previous: 1 }),
    ]);
  });

  it("counts a QC run with its test's tests per run", async () => {
    await lab("put", `/reagents/yields/${ids.reagent}`, pathologist, { testsPerUnit: 10 }).expect(200);
    ids.load = (
      await lab("post", `/instruments/${ids.analyzer}/reagents`, admin, {
        inventoryLotId: ids["R-1"],
        takeFromStock: { locationId: ids.store, quantity: 2 },
      }).expect(201)
    ).body.id;
    ids.gluLoad = (
      await lab("post", `/instruments/${ids.analyzer}/reagents`, admin, { inventoryLotId: ids["G-1"], testId: ids.glu, capacityTests: 30 }).expect(201)
    ).body.id;
    await lab("post", "/qc/runs", medtech, { instrumentId: ids.analyzer, testId: ids.chol, qcLotId: ids.qcLot, value: 5.1 }).expect(201);
    await lab("post", "/qc/runs", medtech, { instrumentId: ids.analyzer, testId: ids.glu, qcLotId: ids.qcLot, value: 5.0 }).expect(201);
    // Cholesterol runs in duplicate on R1; glucose uses 1 of R1 and 3 of R2.
    expect((await loadView(ids.load)).use).toMatchObject({ qcRuns: 2, qcTests: 3, total: 3 });
    expect((await loadView(ids.gluLoad)).use).toMatchObject({ qcRuns: 1, qcTests: 3, total: 3, remaining: 27 });
  });

  it("counts an order's first run once per lot with the most tests per run of the ordered tests the lot serves, a re-run with its own", async () => {
    const glu = await lab("post", `/order-items/${ids.gluItem}/results`, medtech, { valueNumeric: 6.1, instrumentId: ids.analyzer }).expect(201);
    await lab("post", `/order-items/${ids.cholItem}/results`, medtech, { valueNumeric: 4.2, instrumentId: ids.analyzer }).expect(201);
    // The panel on R1: one run of 2 tests (cholesterol's duplicate); R2 serves glucose only: one run of 3.
    expect(await patientRows(ids.load)).toEqual([{ tests: 2, run_number: 1 }]);
    expect(await patientRows(ids.gluLoad)).toEqual([{ tests: 3, run_number: 1 }]);

    // Glucose re-run on the instrument: its own tests per run on R1 (1).
    await lab("post", `/results/${glu.body.id}/correct`, medtech, { valueNumeric: 6.0, reason: "Re-run after a flag", instrumentId: ids.analyzer }).expect(201);
    expect(await patientRows(ids.load)).toEqual([
      { tests: 2, run_number: 1 },
      { tests: 1, run_number: 2 },
    ]);
    expect((await loadView(ids.load)).use).toMatchObject({ patientRuns: 2, patientTests: 3, qcRuns: 2, qcTests: 3, total: 6, remaining: 14 });

    // Changing a setting later does not change runs already counted.
    await lab("put", `/reagents/yields/${ids.reagent}/tests/${ids.chol}`, pathologist, { testsPerRun: 1 }).expect(200);
    expect((await loadView(ids.load)).use).toMatchObject({ patientTests: 3, total: 6 });
  });

  it("reports runs and tests apart, and spreads the cost over patient runs", async () => {
    await lab("post", `/reagents/${ids.load}/unload`, medtech, { reason: "Cassette finished" }).expect(200);
    const report = (await lab("get", `/reagents/usage?from=${manilaDate(0)}&to=${manilaDate(0)}`, medtech).expect(200)).body;
    const r1 = report.loads.find((l: { id: string }) => l.id === ids.load);
    expect(r1).toMatchObject({
      period: { patientRuns: 2, patientTests: 3, qcRuns: 2, qcTests: 3, otherRuns: 0, wasted: 0, total: 6 },
      stockCost: 1_000_000,
      // ₱10,000.00 over 2 patient runs (not 3 tests).
      costPerPatientRun: 500_000,
      unusedAtUnload: 14,
    });
    expect(report.reagents.find((g: { itemCode: string }) => g.itemCode === "chem-r1")).toMatchObject({
      patientRuns: 2,
      patientTests: 3,
      qcRuns: 2,
      qcTests: 3,
      total: 6,
      nonPatientShare: 0.5,
    });
  });
});
