import { randomUUID } from "node:crypto";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * Phase 9 — reagent lots on results and QC runs: inventory reagent lots are
 * loaded on instruments; QC runs and results record the lots in use; a new lot
 * restarts the QC window (facility policy); an expired lot in use refuses work.
 */
describe("laboratory reagent lots", () => {
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
    tenant = await createTenant(ctx.pool, "lab-reagent-org");
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
    ids.patient = (await ctx.http().post("/api/v1/patients").set(as(admin, tenant.facilityId)).send(juan).expect(201)).body.id;

    // Laboratory catalog, instrument and QC set-up.
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
    ids.analyzer = (await lab("post", "/instruments", pathologist, { code: "chem-1", name: "Chemistry analyzer 1" }).expect(201)).body.id;
    const material = await lab("post", "/qc/materials", pathologist, { code: "chem-l1", name: "Chemistry control", level: "Level 1" }).expect(201);
    ids.qcLot = (await lab("post", `/qc/materials/${material.body.id}/lots`, pathologist, { lotNumber: "A100", expiresOn: inDays(90) }).expect(201)).body.id;
    await lab("post", `/qc/lots/${ids.qcLot}/targets`, pathologist, { testId: ids.glu, instrumentId: ids.analyzer, mean: 5, sd: 0.2 }).expect(201);

    // Inventory: a laboratory store with two lots of the glucose reagent and a consumable.
    const inv = (method: "post" | "get", path: string, body?: object) => {
      const call = ctx.http()[method](`/api/v1/inventory${path}`).set(as(admin, tenant.facilityId));
      return body ? call.send(body) : call;
    };
    const location = await inv("post", "/locations", { facilityId: tenant.facilityId, code: "lab-store", name: "Laboratory store" }).expect(201);
    ids.reagentItem = (
      await inv("post", "/items", { code: "glu-r1", name: "Glucose reagent R1", category: "reagent", stockUnit: "cassette" }).expect(201)
    ).body.id;
    ids.tubeItem = (
      await inv("post", "/items", { code: "tube-red", name: "Red-top tube", category: "laboratory_consumable", stockUnit: "piece" }).expect(201)
    ).body.id;
    const receive = (itemId: string, lotNumber: string, quantity: number) =>
      inv("post", "/receipts", { locationId: location.body.id, itemId, lotNumber, expiryDate: inDays(120), quantity, idempotencyKey: randomUUID() }).expect(
        201,
      );
    await receive(ids.reagentItem, "R-1001", 10);
    await receive(ids.reagentItem, "R-1002", 5);
    await receive(ids.tubeItem, "T-1", 100);
    const lots = await ctx.pool.query<{ id: string; lot_number: string }>(`SELECT id, lot_number FROM inventory_lot WHERE organization_id = $1`, [
      tenant.organizationId,
    ]);
    for (const l of lots.rows) ids[l.lot_number] = l.id;

    // A received specimen to enter results for.
    const order = await lab("post", "/orders", medtech, {
      patientId: ids.patient,
      source: "external",
      externalOrderer: "Dr. Reyes",
      testIds: [ids.glu],
    }).expect(201);
    ids.item = order.body.items[0].id;
    const collected = await lab("post", `/orders/${order.body.id}/specimens`, medtech, { specimenTypeId: ids.serum, itemIds: [ids.item] }).expect(201);
    await lab("post", `/specimens/${collected.body.specimens[0].id}/receive`, medtech).expect(200);
  });

  afterAll(() => ctx.close());

  function lab(method: "get" | "post" | "put", path: string, token: string, body?: object) {
    const call = ctx.http()[method](`/api/v1/laboratory${path}`).set(as(token, tenant.facilityId));
    return body ? call.send(body) : call;
  }
  const qcRun = (value: number) => lab("post", "/qc/runs", medtech2, { instrumentId: ids.analyzer, testId: ids.glu, qcLotId: ids.qcLot, value });
  const board = async () => (await lab("get", "/qc/status", medtech).expect(200)).body;

  it("offers reagent lots with stock at the facility and loads one on an instrument", async () => {
    const available = await lab("get", "/reagents/available", medtech).expect(200);
    expect(available.body.map((l: { lotNumber: string }) => l.lotNumber).sort()).toEqual(["R-1001", "R-1002"]);
    expect(available.body[0]).toMatchObject({ itemName: "Glucose reagent R1", category: "reagent", quantity: expect.any(Number), stockUnit: "cassette" });

    await lab("post", `/instruments/${ids.analyzer}/reagents`, doctor, { inventoryLotId: ids["R-1001"] }).expect(403);
    await lab("post", `/instruments/${ids.analyzer}/reagents`, medtech, { inventoryLotId: ids["T-1"] })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("not_a_reagent"));
    const loaded = await lab("post", `/instruments/${ids.analyzer}/reagents`, medtech, { inventoryLotId: ids["R-1001"], testId: ids.glu }).expect(201);
    expect(loaded.body).toMatchObject({ itemName: "Glucose reagent R1", lotNumber: "R-1001", testName: "Glucose", expired: false, unloadedAt: null });
    ids.load1 = loaded.body.id;
    await lab("post", `/instruments/${ids.analyzer}/reagents`, medtech, { inventoryLotId: ids["R-1001"], testId: ids.glu }).expect(409);
    const inUse = await lab("get", `/reagents?instrumentId=${ids.analyzer}`, medtech).expect(200);
    expect(inUse.body.map((l: { id: string }) => l.id)).toEqual([ids.load1]);
  });

  it("records the lots in use on QC runs and results", async () => {
    const run = await qcRun(5.1).expect(201);
    expect(run.body.reagents).toEqual([expect.objectContaining({ loadId: ids.load1, lotNumber: "R-1001" })]);
    const row = (await board()).rows[0];
    expect(row.reagents).toEqual([expect.objectContaining({ lotNumber: "R-1001", expired: false })]);
    expect(row.decisiveRun).toMatchObject({ status: "accepted" });

    const result = await lab("post", `/order-items/${ids.item}/results`, medtech, { valueNumeric: 6.1, instrumentId: ids.analyzer }).expect(201);
    expect(result.body).toMatchObject({ qcStatus: "accepted", reagents: [expect.objectContaining({ loadId: ids.load1, itemCode: "glu-r1" })] });
    ids.result = result.body.id;
    const order = await lab("get", `/orders?patientId=${ids.patient}`, medtech).expect(200);
    expect(order.body[0].items[0].result.reagents[0]).toMatchObject({ lotNumber: "R-1001" });
    await expect(ctx.pool.query(`DELETE FROM lab_result_reagent WHERE result_id = $1`, [ids.result])).rejects.toThrow();
  });

  it("replaces the lot of the same reagent and restarts the QC window", async () => {
    await lab("put", "/policy", pathologist, {
      allowSelfVerification: false,
      allowSelfApproval: false,
      releaseOnApproval: false,
      qcRequired: true,
      reason: "Patient results need QC after every reagent lot change",
    }).expect(200);
    const loaded = await lab("post", `/instruments/${ids.analyzer}/reagents`, medtech, { inventoryLotId: ids["R-1002"], testId: ids.glu }).expect(201);
    ids.load2 = loaded.body.id;
    const history = await lab("get", `/instruments/${ids.analyzer}/reagents`, medtech).expect(200);
    expect(history.body.map((l: { id: string }) => l.id)).toEqual([ids.load2, ids.load1]);
    expect(history.body[1]).toMatchObject({ unloadReason: "Replaced by lot R-1002", unloadedByName: "medtech@example.ph" });

    const row = (await board()).rows[0];
    expect(row).toMatchObject({ decisiveRun: null, resultsAllowed: false, reagents: [expect.objectContaining({ lotNumber: "R-1002" })] });
    const correct = () =>
      lab("post", `/results/${ids.result}/correct`, medtech, { valueNumeric: 6.0, reason: "Re-run on the new lot", instrumentId: ids.analyzer });
    await correct()
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("qc_not_accepted"));

    await qcRun(4.95).expect(201);
    const corrected = await correct().expect(201);
    expect(corrected.body).toMatchObject({ versionNumber: 2, qcStatus: "accepted", reagents: [expect.objectContaining({ loadId: ids.load2 })] });
    ids.result = corrected.body.id;

    // Without the restart, the runs before the change count again.
    await lab("put", "/policy", pathologist, {
      allowSelfVerification: false,
      allowSelfApproval: false,
      releaseOnApproval: false,
      qcAfterReagentChange: false,
      reason: "QC plan revised",
    }).expect(200);
    const all = (await board()).rows[0];
    expect(new Date(all.qcSince).getTime()).toBeLessThan(new Date(loaded.body.loadedAt).getTime());
  });

  it("refuses QC runs and results while an expired lot is loaded, until it is unloaded", async () => {
    // A lot that expired while loaded (inserted as history: loads are made through the API, which refuses expired lots).
    const expiredLot = await ctx.pool.query<{ id: string }>(
      `INSERT INTO inventory_lot (organization_id, item_id, lot_number, expiry_date) VALUES ($1, $2, 'R-0999', current_date - 1) RETURNING id`,
      [tenant.organizationId, ids.reagentItem],
    );
    await lab("post", `/instruments/${ids.analyzer}/reagents`, medtech, { inventoryLotId: expiredLot.rows[0]!.id })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("reagent_lot_expired"));
    const stale = await ctx.pool.query<{ id: string }>(
      `INSERT INTO lab_reagent_load (organization_id, facility_id, instrument_id, inventory_item_id, inventory_lot_id, item_code, item_name, lot_number,
         expiry_date, loaded_at, loaded_by)
       SELECT $1, $2, $3, $4, $5, 'glu-r1', 'Glucose reagent R1', 'R-0999', current_date - 1, now() - interval '30 days', id FROM app_user WHERE email = 'medtech@example.ph'
       RETURNING id`,
      [tenant.organizationId, tenant.facilityId, ids.analyzer, ids.reagentItem, expiredLot.rows[0]!.id],
    );
    await qcRun(5)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("reagent_lot_expired"));
    const row = (await board()).rows[0];
    expect(row.resultsAllowed).toBe(false);
    expect(row.reagents.find((r: { lotNumber: string }) => r.lotNumber === "R-0999")).toMatchObject({ expired: true });

    await lab("post", `/reagents/${stale.rows[0]!.id}/unload`, medtech, { reason: "x" }).expect(400);
    await lab("post", `/reagents/${stale.rows[0]!.id}/unload`, medtech, { reason: "Expired; discarded" }).expect(200);
    await lab("post", `/reagents/${stale.rows[0]!.id}/unload`, medtech, { reason: "Again" }).expect(404);
    await qcRun(5).expect(201);
    await expect(ctx.pool.query(`UPDATE lab_reagent_load SET lot_number = 'X' WHERE id = $1`, [ids.load2])).rejects.toThrow(/only changes when it is unloaded/);
    await expect(ctx.pool.query(`DELETE FROM lab_reagent_load WHERE id = $1`, [ids.load1])).rejects.toThrow(/not deleted/);
  });

  it("audits loads and unloads", async () => {
    const actions = (await auditRows(ctx.pool, "action LIKE 'lab.reagent.%'")).map((a) => a.action);
    expect(actions.filter((a) => a === "lab.reagent.load")).toHaveLength(2);
    expect(actions).toContain("lab.reagent.unload");
    const events = await ctx.pool.query(`SELECT event_type FROM domain_event WHERE event_type LIKE 'LaboratoryReagentLot%'`);
    expect(events.rows.map((e) => e.event_type).sort()).toEqual(["LaboratoryReagentLotLoaded", "LaboratoryReagentLotLoaded", "LaboratoryReagentLotUnloaded"]);
  });
});

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
