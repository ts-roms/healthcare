import { randomUUID } from "node:crypto";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

/**
 * Phase 9 — reagent use per test run: a loaded reagent lot holds a number of tests (stock taken × the reagent's yield,
 * or stated at the load); patient runs (one per order and result version) and QC runs are counted with the result or
 * run, other use is recorded with a reason; the report shows what is left and the reagent cost per patient run.
 */
describe("laboratory reagent use per test run", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let medtech: string;
  let pathologist: string;
  let doctor: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "lab-reagent-use-org");
    await createStaff(ctx.pool, tenant, "admin@example.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "medtech@example.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "patho@example.ph", ["pathologist"]);
    await createStaff(ctx.pool, tenant, "doctor@example.ph", ["physician"]);
    admin = (await login(ctx, "admin@example.ph")).accessToken;
    medtech = (await login(ctx, "medtech@example.ph")).accessToken;
    pathologist = (await login(ctx, "patho@example.ph")).accessToken;
    doctor = (await login(ctx, "doctor@example.ph")).accessToken;
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
      });
    ids.glu = (await test("glu", "Glucose").expect(201)).body.id;
    ids.urea = (await test("urea", "Urea").expect(201)).body.id;
    ids.analyzer = (await lab("post", "/instruments", pathologist, { code: "chem-1", name: "Chemistry analyzer 1" }).expect(201)).body.id;
    const material = await lab("post", "/qc/materials", pathologist, { code: "chem-l1", name: "Chemistry control", level: "Level 1" }).expect(201);
    ids.qcLot = (
      await lab("post", `/qc/materials/${material.body.id}/lots`, pathologist, { lotNumber: "A100", expiresOn: manilaDate(90) }).expect(201)
    ).body.id;
    await lab("post", `/qc/lots/${ids.qcLot}/targets`, pathologist, { testId: ids.glu, instrumentId: ids.analyzer, mean: 5, sd: 0.2 }).expect(201);

    // Inventory: a multi-test reagent bought at ₱5,000 per cassette, and a consumable.
    const inv = (path: string, body: object) => ctx.http().post(`/api/v1/inventory${path}`).set(as(admin, tenant.facilityId)).send(body).expect(201);
    ids.store = (await inv("/locations", { facilityId: tenant.facilityId, code: "lab-store", name: "Laboratory store" })).body.id;
    ids.reagent = (await inv("/items", { code: "chem-r1", name: "Chemistry reagent R1", category: "reagent", stockUnit: "cassette" })).body.id;
    ids.tube = (await inv("/items", { code: "tube-red", name: "Red-top tube", category: "laboratory_consumable", stockUnit: "piece" })).body.id;
    const receive = (itemId: string, lotNumber: string, quantity: number, unitCost?: number) =>
      inv("/receipts", { locationId: ids.store, itemId, lotNumber, expiryDate: manilaDate(120), quantity, unitCost, idempotencyKey: randomUUID() });
    await receive(ids.reagent, "R-1", 10, 500_000);
    await receive(ids.reagent, "R-2", 3);
    const lots = await ctx.pool.query<{ id: string; lot_number: string }>(`SELECT id, lot_number FROM inventory_lot WHERE organization_id = $1`, [
      tenant.organizationId,
    ]);
    for (const l of lots.rows) ids[l.lot_number] = l.id;

    // One order with two tests measured on the analyzer (one run).
    const order = await lab("post", "/orders", medtech, {
      patientId: ids.patient,
      source: "external",
      externalOrderer: "Dr. Reyes",
      testIds: [ids.glu, ids.urea],
    }).expect(201);
    ids.order = order.body.id;
    ids.gluItem = order.body.items.find((i: { testId: string }) => i.testId === ids.glu).id;
    ids.ureaItem = order.body.items.find((i: { testId: string }) => i.testId === ids.urea).id;
    const collected = await lab("post", `/orders/${ids.order}/specimens`, medtech, {
      specimenTypeId: ids.serum,
      itemIds: [ids.gluItem, ids.ureaItem],
    }).expect(201);
    await lab("post", `/specimens/${collected.body.specimens[0].id}/receive`, medtech).expect(200);
  });

  afterAll(() => ctx.close());

  function lab(method: "get" | "post" | "put", path: string, token: string, body?: object) {
    const call = ctx.http()[method](`/api/v1/laboratory${path}`).set(as(token, tenant.facilityId));
    return body ? call.send(body) : call;
  }
  const loadView = async (loadId: string) => {
    const loads = (await lab("get", `/reagents?instrumentId=${ids.analyzer}`, medtech).expect(200)).body as Array<{
      id: string;
      use: Record<string, unknown>;
      capacityTests: number | null;
    }>;
    return loads.find((l) => l.id === loadId)!;
  };

  it("configures a reagent's yield (tests per stock unit)", async () => {
    await lab("put", `/reagents/yields/${ids.reagent}`, medtech, { testsPerUnit: 50 }).expect(403);
    await lab("put", `/reagents/yields/${ids.tube}`, pathologist, { testsPerUnit: 50 })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("not_a_reagent"));
    await lab("put", `/reagents/yields/${ids.reagent}`, pathologist, { testsPerUnit: 0 }).expect(400);
    await lab("put", `/reagents/yields/${ids.reagent}`, pathologist, { testsPerUnit: 40 }).expect(200);
    const set = await lab("put", `/reagents/yields/${ids.reagent}`, pathologist, { testsPerUnit: 50 }).expect(200);
    expect(set.body).toMatchObject({
      itemCode: "chem-r1",
      itemName: "Chemistry reagent R1",
      stockUnit: "cassette",
      testsPerUnit: 50,
      updatedByName: "patho@example.ph",
    });
    expect((await lab("get", "/reagents/yields", medtech).expect(200)).body).toHaveLength(1);
    const audit = await auditRows(ctx.pool, "action = 'lab.reagent.yield' AND organization_id = $1", [tenant.organizationId]);
    expect(audit.at(-1)?.metadata).toMatchObject({ testsPerUnit: 50, previous: 40 });
  });

  it("gives a load taken from stock its capacity from the yield", async () => {
    const loaded = await lab("post", `/instruments/${ids.analyzer}/reagents`, admin, {
      inventoryLotId: ids["R-1"],
      takeFromStock: { locationId: ids.store, quantity: 2 },
    }).expect(201);
    ids.load1 = loaded.body.id;
    expect(loaded.body).toMatchObject({
      capacityTests: 100,
      use: { patientRuns: 0, qcRuns: 0, otherRuns: 0, wasted: 0, total: 0, capacity: 100, remaining: 100, low: false },
    });
  });

  it("counts QC runs, and one patient run per order and result version", async () => {
    await lab("post", "/qc/runs", medtech, { instrumentId: ids.analyzer, testId: ids.glu, qcLotId: ids.qcLot, value: 5.1 }).expect(201);
    const glu = await lab("post", `/order-items/${ids.gluItem}/results`, medtech, { valueNumeric: 6.1, instrumentId: ids.analyzer }).expect(201);
    await lab("post", `/order-items/${ids.ureaItem}/results`, medtech, { valueNumeric: 4.2, instrumentId: ids.analyzer }).expect(201);
    expect((await loadView(ids.load1)).use).toMatchObject({ patientRuns: 1, qcRuns: 1, total: 2, remaining: 98 });

    // A correction entered on the instrument is a re-run.
    await lab("post", `/results/${glu.body.id}/correct`, medtech, { valueNumeric: 6.0, reason: "Re-run after a flag", instrumentId: ids.analyzer }).expect(201);
    expect((await loadView(ids.load1)).use).toMatchObject({ patientRuns: 2, qcRuns: 1, total: 3 });
  });

  it("records other use with a reason", async () => {
    const use = (token: string, body: object) => lab("post", `/reagents/${ids.load1}/uses`, token, body);
    await use(doctor, { kind: "calibration", tests: 3, reason: "Calibration after maintenance" }).expect(403);
    await use(medtech, { kind: "patient", tests: 1, reason: "Counted by hand" }).expect(400);
    await use(medtech, { kind: "calibration", tests: 3, reason: "x" }).expect(400);
    const calibrated = await use(medtech, { kind: "calibration", tests: 3, reason: "Calibration after maintenance" }).expect(201);
    expect(calibrated.body.use).toMatchObject({ otherRuns: 3, total: 6 });
    await use(medtech, { kind: "waste", tests: 2, reason: "Bubbles in the cassette" }).expect(201);
    expect((await loadView(ids.load1)).use).toMatchObject({ patientRuns: 2, qcRuns: 1, otherRuns: 3, wasted: 2, total: 8, remaining: 92 });

    const uses = await lab("get", `/reagents/${ids.load1}/uses`, medtech).expect(200);
    expect(uses.body.map((u: { kind: string }) => u.kind).sort()).toEqual(["calibration", "patient", "patient", "qc", "waste"]);
    expect(uses.body.find((u: { kind: string }) => u.kind === "waste")).toMatchObject({
      tests: 2,
      reason: "Bubbles in the cassette",
      recordedByName: "medtech@example.ph",
    });
    const audit = await auditRows(ctx.pool, "action = 'lab.reagent.use' AND organization_id = $1", [tenant.organizationId]);
    expect(audit.map((a) => a.reason)).toEqual(["Calibration after maintenance", "Bubbles in the cassette"]);
    const events = await ctx.pool.query(`SELECT payload FROM domain_event WHERE event_type = 'LaboratoryReagentUseRecorded' AND organization_id = $1`, [
      tenant.organizationId,
    ]);
    expect(events.rows).toHaveLength(2);
    expect(JSON.stringify(events.rows)).not.toContain("Bubbles");
  });

  it("keeps use and capacity as history", async () => {
    await expect(ctx.pool.query(`UPDATE lab_reagent_use SET tests = 1 WHERE reagent_load_id = $1`, [ids.load1])).rejects.toThrow();
    await expect(ctx.pool.query(`DELETE FROM lab_reagent_use WHERE reagent_load_id = $1`, [ids.load1])).rejects.toThrow();
    await expect(ctx.pool.query(`UPDATE lab_reagent_load SET capacity_tests = 500 WHERE id = $1`, [ids.load1])).rejects.toThrow(
      /only changes when it is unloaded/,
    );
    // The same patient run is counted once.
    await expect(
      ctx.pool.query(
        `INSERT INTO lab_reagent_use (organization_id, facility_id, reagent_load_id, kind, tests, order_id, result_id, run_number, recorded_by)
         SELECT organization_id, facility_id, reagent_load_id, kind, tests, order_id, result_id, run_number, recorded_by FROM lab_reagent_use
         WHERE reagent_load_id = $1 AND kind = 'patient' LIMIT 1`,
        [ids.load1],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("marks a lot running low and reports use, what was left and the cost per patient run", async () => {
    // Replacing the lot unloads the first one; the new load states its capacity.
    const second = await lab("post", `/instruments/${ids.analyzer}/reagents`, medtech, { inventoryLotId: ids["R-2"], capacityTests: 10 }).expect(201);
    ids.load2 = second.body.id;
    await lab("post", `/reagents/${ids.load1}/uses`, medtech, { kind: "repeat", tests: 1, reason: "Too late" })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("reagent_lot_unloaded"));
    await lab("post", `/reagents/${ids.load2}/uses`, medtech, { kind: "priming", tests: 9, reason: "Priming the new cassette" }).expect(201);
    expect((await loadView(ids.load2)).use).toMatchObject({ capacity: 10, remaining: 1, low: true });

    await lab("get", `/reagents/usage?from=${manilaDate(1)}&to=${manilaDate(0)}`, medtech).expect(400);
    await lab("get", `/reagents/usage?from=${manilaDate(-400)}&to=${manilaDate(0)}`, medtech).expect(400);
    const report = await lab("get", `/reagents/usage?from=${manilaDate(0)}&to=${manilaDate(0)}`, medtech).expect(200);
    const first = report.body.loads.find((l: { id: string }) => l.id === ids.load1);
    expect(first).toMatchObject({
      lotNumber: "R-1",
      period: { patientRuns: 2, qcRuns: 1, otherRuns: 3, wasted: 2, total: 8 },
      stockCost: 1_000_000,
      costPerPatientRun: 500_000,
      unusedAtUnload: 92,
    });
    expect(report.body.loads.find((l: { id: string }) => l.id === ids.load2)).toMatchObject({ stockCost: null, costPerPatientRun: null, unusedAtUnload: null });
    expect(report.body.reagents).toEqual([
      expect.objectContaining({ itemCode: "chem-r1", loads: 2, patientRuns: 2, qcRuns: 1, otherRuns: 12, wasted: 2, total: 17, nonPatientShare: 15 / 17 }),
    ]);
    const tomorrow = await lab("get", `/reagents/usage?from=${manilaDate(1)}&to=${manilaDate(1)}`, medtech).expect(200);
    expect(tomorrow.body.loads.map((l: { id: string }) => l.id)).toEqual([ids.load2]);
    expect(tomorrow.body.loads[0].period.total).toBe(0);
  });
});
