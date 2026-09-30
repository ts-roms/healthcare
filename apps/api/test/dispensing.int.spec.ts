import { randomUUID } from "node:crypto";
import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

/**
 * Dispensing from prescriptions (docs/domains/prescription.md): stock leaves inventory in the dispensing transaction,
 * first-expiry-first-out; no more than prescribed when the units match; controlled items carry the prescription number;
 * mistaken dispenses are reversed once, returning the same lots; only active prescriptions are dispensed.
 */
describe("dispensing", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let pharmacist: string;
  let cashier: string;
  const ids: Record<string, string> = {};

  const req = (token: string, facilityId = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });
  const balance = async (lotNumber: string) =>
    (
      await ctx.pool.query<{ quantity: number }>(
        `SELECT b.quantity FROM inventory_balance b JOIN inventory_lot l ON l.id = b.lot_id WHERE b.location_id = $1 AND l.lot_number = $2`,
        [ids.pharmacy, lotNumber],
      )
    ).rows[0]?.quantity;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "dispensing-org");
    await createStaff(ctx.pool, tenant, "admin@dispense.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "santos@dispense.ph", ["physician"]);
    await createStaff(ctx.pool, tenant, "pharmacist@dispense.ph", ["pharmacist"]);
    await createStaff(ctx.pool, tenant, "cashier@dispense.ph", ["cashier"]);
    [admin, doctor, pharmacist, cashier] = await Promise.all(
      ["admin", "santos", "pharmacist", "cashier"].map(async (u) => (await login(ctx, `${u}@dispense.ph`)).accessToken),
    );

    // Pharmacy stock: amoxicillin in two lots (one expiring sooner, one expired), a controlled item, and syrup bottles.
    const inv = async (url: string, body: object) => (await req(admin).post(`/inventory${url}`, body).expect(201)).body;
    ids.pharmacy = (await inv("/locations", { facilityId: tenant.facilityId, code: "pharmacy", name: "Pharmacy" })).id;
    ids.amox = (await inv("/items", { code: "amoxicillin-500", name: "Amoxicillin 500 mg", category: "medicine", stockUnit: "capsule" })).id;
    ids.tramadol = (await inv("/items", { code: "tramadol-50", name: "Tramadol 50 mg", category: "medicine", stockUnit: "capsule", controlled: true })).id;
    ids.syrup = (await inv("/items", { code: "salbutamol-syrup", name: "Salbutamol syrup 60 mL", category: "medicine", stockUnit: "bottle" })).id;
    // A laboratory reagent kept in the same room: never dispensed.
    ids.reagent = (await inv("/items", { code: "glucose-reagent", name: "Glucose reagent", category: "reagent", stockUnit: "kit" })).id;
    const receive = (itemId: string, lotNumber: string, days: number, quantity: number, extra: object = {}) =>
      inv("/receipts", { locationId: ids.pharmacy, itemId, lotNumber, expiryDate: manilaDate(days), quantity, idempotencyKey: randomUUID(), ...extra });
    await receive(ids.amox, "AMX-SOON", 30, 10);
    await receive(ids.amox, "AMX-LATE", 300, 100);
    await receive(ids.amox, "AMX-OLD", -2, 50, { reason: "Returned from ward" });
    await receive(ids.tramadol, "TRM-1", 200, 20, { reason: "Initial stock", reference: "DR-1" });
    await receive(ids.syrup, "SAL-1", 200, 5);
    await receive(ids.reagent, "GLU-1", 200, 3);

    // A consultation with a prescription: 30 amoxicillin capsules (no refills), tramadol, and salbutamol in mL.
    const visitTypeId = (
      await req(admin).post("/clinic/visit-types", { code: "consult", name: "Consultation", defaultDurationMinutes: 15, requiresTriage: false }).expect(201)
    ).body.id;
    ids.patient = (await req(admin).post("/patients", juan).expect(201)).body.id;
    const visit = await req(admin).post("/queue/walk-ins", { patientId: ids.patient, visitTypeId }).expect(201);
    ids.encounter = (await req(doctor).post("/encounters", { visitId: visit.body.id }).expect(201)).body.id;
    const item = (genericName: string, quantity: number, quantityUnit: string) => ({
      genericName,
      route: "oral",
      frequency: "three_times_daily",
      quantity,
      quantityUnit,
      instructions: "As directed",
    });
    const rx = await req(doctor)
      .post("/prescriptions", {
        encounterId: ids.encounter,
        items: [item("Amoxicillin", 30, "capsules"), item("Tramadol", 10, "capsules"), item("Salbutamol", 120, "mL")],
      })
      .expect(201);
    ids.rx = rx.body.id;
    ids.rxNumber = rx.body.prescriptionNumber;
    [ids.lineAmox, ids.lineTramadol, ids.lineSalbutamol] = rx.body.items.map((i: { id: string }) => i.id);
  });
  afterAll(() => ctx.close());

  it("finds a prescription by number and shows who it is for", async () => {
    await req(cashier).get(`/dispensing/prescriptions?number=${ids.rxNumber}`).expect(403);
    await req(pharmacist).get("/dispensing/prescriptions?number=RX99999999").expect(404);
    const found = await req(pharmacist).get(`/dispensing/prescriptions?number=${ids.rxNumber!.toLowerCase()}`).expect(200);
    expect(found.body).toEqual({ prescriptionId: ids.rx });
    const view = await req(pharmacist).get(`/dispensing/prescriptions/${ids.rx}`).expect(200);
    expect(view.body.patient).toMatchObject({ displayName: "DELA CRUZ, Juan Santos", patientNumber: expect.any(String) });
    expect(view.body.items.map((i: { remaining: number }) => i.remaining)).toEqual([30, 10, 120]);
    const stock = await req(pharmacist).get("/dispensing/stock").expect(200);
    expect(stock.body.find((s: { itemId: string }) => s.itemId === ids.amox)).toMatchObject({ quantity: 110, locationName: "Pharmacy" }); // expired lot excluded
  });

  it("dispenses first-expiry-first-out inside one transaction, never more than prescribed", async () => {
    const dispense = (lines: object[]) => req(pharmacist).post(`/dispensing/prescriptions/${ids.rx}/dispenses`, { lines });
    const amox = (quantity: number) => ({ prescriptionItemId: ids.lineAmox, inventoryItemId: ids.amox, locationId: ids.pharmacy, quantity });
    await dispense([amox(31)])
      .expect(422)
      .expect((r) => expect(r.body.error).toMatchObject({ code: "exceeds_prescribed", details: { remaining: 30 } }));

    // Two lines in one request: the second fails (not enough syrup), so neither is recorded and no stock moves.
    await dispense([amox(20), { prescriptionItemId: ids.lineSalbutamol, inventoryItemId: ids.syrup, locationId: ids.pharmacy, quantity: 6 }])
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("insufficient_stock"));
    expect(await balance("AMX-SOON")).toBe(10);

    const first = await dispense([
      amox(20),
      { prescriptionItemId: ids.lineSalbutamol, inventoryItemId: ids.syrup, locationId: ids.pharmacy, quantity: 2 },
    ]).expect(201);
    expect(first.body.dispensed[0].lots.map((l: { lotNumber: string; quantity: number }) => [l.lotNumber, l.quantity]).sort()).toEqual([
      ["AMX-LATE", 10],
      ["AMX-SOON", 10],
    ]);
    expect(await balance("AMX-SOON")).toBe(0);
    expect(await balance("AMX-LATE")).toBe(90);
    expect(await balance("AMX-OLD")).toBe(50);
    // Salbutamol was prescribed in mL and dispensed in bottles: the platform cannot compare, so "remaining" is unknown.
    expect(first.body.items.map((i: { remaining: number | null }) => i.remaining)).toEqual([10, 10, null]);
    await dispense([amox(11)])
      .expect(422)
      .expect((r) => expect(r.body.error.details).toMatchObject({ remaining: 10 }));

    const movements = await ctx.pool.query(`SELECT kind, source_type, reference, issued_to FROM inventory_movement WHERE movement_group_id = $1`, [
      first.body.dispensed[0].stockMovementGroupId,
    ]);
    expect(movements.rows).toEqual([
      { kind: "issue", source_type: "prescription_dispense", reference: ids.rxNumber, issued_to: "Dispensed on prescription" },
      { kind: "issue", source_type: "prescription_dispense", reference: ids.rxNumber, issued_to: "Dispensed on prescription" },
    ]);
    ids.dispense = first.body.dispensed[0].id;
  });

  it("gives controlled items the prescription number as their movement reference", async () => {
    const res = await req(pharmacist)
      .post(`/dispensing/prescriptions/${ids.rx}/dispenses`, {
        lines: [{ prescriptionItemId: ids.lineTramadol, inventoryItemId: ids.tramadol, locationId: ids.pharmacy, quantity: 10 }],
      })
      .expect(201);
    const movement = await ctx.pool.query(`SELECT reference, reason FROM inventory_movement WHERE movement_group_id = $1`, [
      res.body.dispensed[0].stockMovementGroupId,
    ]);
    expect(movement.rows).toEqual([{ reference: ids.rxNumber, reason: "Dispensed on prescription" }]);
  });

  it("reverses a mistaken dispense once, returning the same lots", async () => {
    await req(pharmacist).post(`/dispensing/dispenses/${ids.dispense}/reverse`, { reason: "x" }).expect(400);
    const reversed = await req(pharmacist).post(`/dispensing/dispenses/${ids.dispense}/reverse`, { reason: "Patient given the wrong strength" }).expect(200);
    expect(reversed.body.dispenses.find((d: { id: string }) => d.id === ids.dispense)).toMatchObject({
      status: "reversed",
      reversalReason: "Patient given the wrong strength",
    });
    expect(reversed.body.items[0].remaining).toBe(30);
    expect(await balance("AMX-SOON")).toBe(10);
    expect(await balance("AMX-LATE")).toBe(100);
    await req(pharmacist).post(`/dispensing/dispenses/${ids.dispense}/reverse`, { reason: "Again, by mistake" }).expect(409);
    await expect(ctx.pool.query(`UPDATE prescription_dispense SET quantity = 1 WHERE id = $1`, [ids.dispense])).rejects.toThrow(
      /only changes when it is reversed/,
    );
    await expect(ctx.pool.query(`DELETE FROM prescription_dispense WHERE id = $1`, [ids.dispense])).rejects.toThrow(/not deleted/);
    await expect(
      ctx.pool.query(
        `INSERT INTO inventory_movement (organization_id, movement_group_id, kind, location_id, item_id, lot_id, quantity, balance_after, reason, source_type, source_id, recorded_by)
         SELECT organization_id, gen_random_uuid(), 'return', location_id, item_id, lot_id, 1, 1, 'again', source_type, source_id, recorded_by
         FROM inventory_movement WHERE source_id = $1 AND kind = 'return' LIMIT 1`,
        [ids.dispense],
      ),
    ).rejects.toThrow(/inventory_movement_source_once/);
  });

  it("lists today's dispenses at the facility", async () => {
    const today = await req(pharmacist).get("/dispensing/dispenses").expect(200);
    expect(today.body.dispenses).toHaveLength(3);
    expect(today.body.dispenses[0].patient).toMatchObject({ displayName: "DELA CRUZ, Juan Santos" });
  });

  it("dispenses only medicines and medical supplies", async () => {
    const stock = await req(pharmacist).get("/dispensing/stock").expect(200);
    expect(stock.body.some((s: { itemId: string }) => s.itemId === ids.reagent)).toBe(false);
    const refused = await req(pharmacist)
      .post(`/dispensing/prescriptions/${ids.rx}/dispenses`, {
        lines: [{ prescriptionItemId: ids.lineAmox, inventoryItemId: ids.reagent, locationId: ids.pharmacy, quantity: 1 }],
      })
      .expect(422);
    expect(refused.body.error).toMatchObject({ code: "item_category_not_allowed", details: { category: "reagent" } });
    expect(await balance("GLU-1")).toBe(3);
  });

  it("dispenses only active prescriptions", async () => {
    await req(doctor).post(`/prescriptions/${ids.rx}/cancel`, { reason: "Changed treatment plan" }).expect(200);
    await req(pharmacist)
      .post(`/dispensing/prescriptions/${ids.rx}/dispenses`, {
        lines: [{ prescriptionItemId: ids.lineAmox, inventoryItemId: ids.amox, locationId: ids.pharmacy, quantity: 1 }],
      })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("prescription_not_active"));
  });

  it("audits dispensing with the patient", async () => {
    const rows = await auditRows(ctx.pool, "action LIKE 'prescription.dispens%'");
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["prescription.dispensing.view", "prescription.dispense", "prescription.dispense.reverse", "prescription.dispense.list"]),
    );
    expect(rows.every((r) => r.patient_id === ids.patient)).toBe(true);
    const events = await ctx.pool.query(`SELECT event_type FROM domain_event WHERE event_type LIKE 'PrescriptionDispens%' ORDER BY occurred_at`);
    expect(events.rows.map((e) => e.event_type)).toEqual(["PrescriptionDispensed", "PrescriptionDispensed", "PrescriptionDispenseReversed"]);
  });

  it("lists the facility's prescriptions for clinicians, names only, audited", async () => {
    const today = manilaDate(0);
    const log = (t: string, q = "") => req(t).get(`/prescriptions/log?from=${today}&to=${today}${q}`);
    await log(cashier).expect(403);
    await req(doctor).get(`/prescriptions/log?from=${today}&to=2000-01-01`).expect(400);
    await log(doctor, "&number=12345").expect(400);
    const all = await log(doctor).expect(200);
    const row = all.body.items.find((r: { id: string }) => r.id === ids.rx);
    expect(row).toMatchObject({
      prescriptionNumber: ids.rxNumber,
      // Cancelled by the test above, after some of it was dispensed.
      status: "cancelled",
      dispensed: true,
      patient: { id: ids.patient, patientNumber: expect.stringMatching(/^P\d{8}$/) },
      prescriber: { name: expect.any(String) },
    });
    expect(row.medicines).toEqual(expect.arrayContaining([expect.stringContaining("Amoxicillin")]));
    expect(JSON.stringify(all.body)).not.toMatch(/instructions|dose|notes|allergyOverrideReason/i);
    expect((await log(doctor, `&number=${ids.rxNumber!.toLowerCase()}`).expect(200)).body.items.map((r: { id: string }) => r.id)).toEqual([ids.rx]);
    expect((await log(doctor, "&mine=true").expect(200)).body.items.map((r: { id: string }) => r.id)).toContain(ids.rx);
    expect((await log(doctor, "&status=active").expect(200)).body.items.some((r: { id: string }) => r.id === ids.rx)).toBe(false);
    await log(admin, "&mine=true").expect(422);
    const audit = await auditRows(ctx.pool, "action = 'prescription.log.view'");
    expect(audit.some((a) => (a.metadata?.patientIds as string[] | undefined)?.includes(ids.patient!))).toBe(true);
  });
});
