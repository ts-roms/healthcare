import { as, auditRows, createStaff, createTenant, createTestApp, login as harnessLogin, manilaDate, type Tenant, type TestContext } from "./harness";

/**
 * Phase 9 inventory (docs/domains/inventory.md): catalog, receipts by lot and expiry, first-expiry-first-out issues
 * that never touch expired stock, transfers, counts and write-offs with reasons, reorder levels, controlled items,
 * an append-only ledger and balances that cannot go negative.
 */
describe("inventory", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let officer: string;
  let nurse: string;
  let cashier: string;
  const ids: Record<string, string> = {};
  let key = 0;
  const nextKey = () => `inventory-key-${++key}`;

  const api = (token: string, facilityId = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1/inventory${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/inventory${url}`).set(as(token, facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1/inventory${url}`).set(as(token, facilityId)).send(body),
  });
  const stockOf = async (itemId: string, locationId: string) => {
    const res = await api(officer).get(`/stock?locationId=${locationId}`).expect(200);
    return res.body.rows.find((r: { item: { id: string } }) => r.item.id === itemId) as
      { onHand: number; usable: number; status: string; lots: Array<{ lotId: string; lotNumber: string; quantity: number; expiry: string }> } | undefined;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "inventory-org");
    await createStaff(ctx.pool, tenant, "officer@inventory.ph", ["inventory_officer"]);
    await createStaff(ctx.pool, tenant, "nurse@inventory.ph", ["nurse"]);
    await createStaff(ctx.pool, tenant, "cashier@inventory.ph", ["cashier"]);
    officer = (await login("officer@inventory.ph")).accessToken;
    nurse = (await login("nurse@inventory.ph")).accessToken;
    cashier = (await login("cashier@inventory.ph")).accessToken;
  });
  afterAll(() => ctx.close());

  const login = (email: string) => harnessLogin(ctx, email);

  it("keeps a catalog of items, suppliers and storage locations", async () => {
    await api(nurse).post("/items", { code: "paracetamol-500", name: "Paracetamol 500 mg", category: "medicine", stockUnit: "tablet" }).expect(403);
    await api(cashier).get("/items").expect(403);
    ids.para = (
      await api(officer).post("/items", { code: "paracetamol-500", name: "Paracetamol 500 mg", category: "medicine", stockUnit: "tablet" }).expect(201)
    ).body.id;
    await api(officer).post("/items", { code: "paracetamol-500", name: "Again", category: "medicine", stockUnit: "tablet" }).expect(409);
    ids.gauze = (
      await api(officer)
        .post("/items", { code: "gauze-4x4", name: "Gauze pad 4x4", category: "medical_supply", stockUnit: "piece", tracksLots: false })
        .expect(201)
    ).body.id;
    ids.tramadol = (
      await api(officer)
        .post("/items", { code: "tramadol-50", name: "Tramadol 50 mg", category: "medicine", stockUnit: "capsule", controlled: true })
        .expect(201)
    ).body.id;
    ids.supplier = (await api(officer).post("/suppliers", { code: "medsupply", name: "Med Supply Corp." }).expect(201)).body.id;
    ids.pharmacy = (await api(officer).post("/locations", { facilityId: tenant.facilityId, code: "pharmacy", name: "Pharmacy" }).expect(201)).body.id;
    ids.store = (await api(officer).post("/locations", { facilityId: tenant.facilityId, code: "storeroom", name: "Storeroom" }).expect(201)).body.id;
    ids.annex = (
      await api(officer).post("/locations", { facilityId: tenant.otherFacilityId, code: "annex-pharmacy", name: "Annex pharmacy" }).expect(201)
    ).body.id;
    const here = await api(officer).get("/locations?scope=facility").expect(200);
    expect(here.body.map((l: { code: string }) => l.code).sort()).toEqual(["pharmacy", "storeroom"]);
  });

  it("receives stock by lot and expiry, idempotently", async () => {
    await api(officer).post("/receipts", { locationId: ids.pharmacy, itemId: ids.para, quantity: 100, idempotencyKey: nextKey() }).expect(422);
    const k = nextKey();
    const soon = await api(officer)
      .post("/receipts", {
        locationId: ids.pharmacy,
        itemId: ids.para,
        lotNumber: "A1",
        expiryDate: manilaDate(20),
        quantity: 100,
        supplierId: ids.supplier,
        unitCost: 150,
        reference: "DR-1001",
        idempotencyKey: k,
      })
      .expect(201);
    expect(soon.body.movements).toEqual([expect.objectContaining({ kind: "receipt", quantity: 100, balanceAfter: 100, unitCost: 150, reference: "DR-1001" })]);
    // The same request again: the same movement, nothing added.
    const again = await api(officer)
      .post("/receipts", { locationId: ids.pharmacy, itemId: ids.para, lotNumber: "A1", expiryDate: manilaDate(20), quantity: 100, idempotencyKey: k })
      .expect(201);
    expect(again.body.movementGroupId).toBe(soon.body.movementGroupId);
    await api(nurse)
      .post("/receipts", { locationId: ids.pharmacy, itemId: ids.para, lotNumber: "B2", expiryDate: manilaDate(400), quantity: 50, idempotencyKey: nextKey() })
      .expect(201);
    await api(officer).post("/receipts", { locationId: ids.pharmacy, itemId: ids.gauze, quantity: 30, idempotencyKey: nextKey() }).expect(201);
    ids.expiredLotReceipt = (
      await api(officer)
        .post("/receipts", {
          locationId: ids.pharmacy,
          itemId: ids.para,
          lotNumber: "OLD",
          expiryDate: manilaDate(-1),
          quantity: 10,
          reason: "Found in cabinet",
          idempotencyKey: nextKey(),
        })
        .expect(201)
    ).body.movements[0].lotId;
    const para = await stockOf(ids.para, ids.pharmacy);
    expect(para).toMatchObject({ onHand: 160, usable: 150 });
    expect(para!.lots.map((l) => [l.lotNumber, l.quantity, l.expiry])).toEqual([
      ["OLD", 10, "expired"],
      ["A1", 100, "expiring"],
      ["B2", 50, "ok"],
    ]);
  });

  it("issues first-expiry-first-out, never from expired stock, and flags crossing the reorder level", async () => {
    await api(officer).put(`/locations/${ids.pharmacy}/items/${ids.para}/reorder-level`, { reorderLevel: 40 }).expect(200);
    const first = await api(nurse)
      .post("/issues", { locationId: ids.pharmacy, itemId: ids.para, quantity: 30, issuedTo: "Ward A", idempotencyKey: nextKey() })
      .expect(201);
    expect(first.body.movements).toEqual([expect.objectContaining({ kind: "issue", quantity: -30, balanceAfter: 70, issuedTo: "Ward A" })]);
    const split = await api(nurse)
      .post("/issues", { locationId: ids.pharmacy, itemId: ids.para, quantity: 80, issuedTo: "Ward B", idempotencyKey: nextKey() })
      .expect(201);
    expect(split.body.movements.map((m: { quantity: number; balanceAfter: number }) => [m.quantity, m.balanceAfter])).toEqual([
      [-70, 0],
      [-10, 40],
    ]);
    const low = await ctx.pool.query("SELECT payload FROM domain_event WHERE event_type = 'InventoryStockLow'");
    expect(low.rows).toEqual([{ payload: { locationId: ids.pharmacy, onHand: 40, reorderLevel: 40 } }]);

    // 40 usable (lot B2) and 10 expired: asking for 41 fails, and the expired lot cannot be named.
    const short = await api(nurse)
      .post("/issues", { locationId: ids.pharmacy, itemId: ids.para, quantity: 41, issuedTo: "Ward A", idempotencyKey: nextKey() })
      .expect(422);
    expect(short.body.error).toMatchObject({ code: "insufficient_stock", details: { available: 40 } });
    const expired = await api(nurse)
      .post("/issues", { locationId: ids.pharmacy, itemId: ids.para, lotId: ids.expiredLotReceipt, quantity: 1, issuedTo: "Ward A", idempotencyKey: nextKey() })
      .expect(422);
    expect(expired.body.error.code).toBe("lot_expired");
    expect((await stockOf(ids.para, ids.pharmacy))!.status).toBe("low");
    const lowList = await api(officer).get("/stock?show=low").expect(200);
    expect(lowList.body.rows.map((r: { item: { code: string } }) => r.item.code)).toEqual(["paracetamol-500"]);
  });

  it("transfers, counts and writes off with reasons; only inventory officers adjust", async () => {
    const lotB = (await stockOf(ids.para, ids.pharmacy))!.lots.find((l) => l.lotNumber === "B2")!.lotId;
    const transfer = await api(nurse)
      .post("/transfers", { fromLocationId: ids.pharmacy, toLocationId: ids.store, itemId: ids.para, quantity: 10, idempotencyKey: nextKey() })
      .expect(201);
    expect(transfer.body.movements.map((m: { kind: string; quantity: number }) => [m.kind, m.quantity])).toEqual([
      ["transfer_out", -10],
      ["transfer_in", 10],
    ]);
    // Only from a location of the selected facility.
    const other = await api(nurse)
      .post("/issues", { locationId: ids.annex, itemId: ids.para, quantity: 1, issuedTo: "x", idempotencyKey: nextKey() })
      .expect(422);
    expect(other.body.error.code).toBe("location_other_facility");

    await api(nurse)
      .post("/adjustments", { locationId: ids.store, lotId: lotB, countedQuantity: 8, reason: "Monthly count", idempotencyKey: nextKey() })
      .expect(403);
    const counted = await api(officer)
      .post("/adjustments", { locationId: ids.store, lotId: lotB, countedQuantity: 8, reason: "Monthly count", idempotencyKey: nextKey() })
      .expect(201);
    expect(counted.body.movements).toEqual([expect.objectContaining({ kind: "adjustment", quantity: -2, balanceAfter: 8, reason: "Monthly count" })]);
    expect(
      (
        await api(officer)
          .post("/adjustments", { locationId: ids.store, lotId: lotB, countedQuantity: 8, reason: "Recount", idempotencyKey: nextKey() })
          .expect(422)
      ).body.error.code,
    ).toBe("count_matches");

    await api(officer).post("/write-offs", { locationId: ids.pharmacy, lotId: ids.expiredLotReceipt, quantity: 10, idempotencyKey: nextKey() }).expect(400); // reason required
    await api(officer)
      .post("/write-offs", { locationId: ids.pharmacy, lotId: ids.expiredLotReceipt, quantity: 10, reason: "Expired", idempotencyKey: nextKey() })
      .expect(201);
    expect((await stockOf(ids.para, ids.pharmacy))!.lots.map((l) => l.lotNumber)).toEqual(["B2"]);
  });

  it("requires a reason and a reference for every movement of a controlled item", async () => {
    const bare = await api(officer)
      .post("/receipts", {
        locationId: ids.pharmacy,
        itemId: ids.tramadol,
        lotNumber: "T1",
        expiryDate: manilaDate(300),
        quantity: 20,
        idempotencyKey: nextKey(),
      })
      .expect(422);
    expect(bare.body.error.code).toBe("controlled_item_details");
    await api(officer)
      .post("/receipts", {
        locationId: ids.pharmacy,
        itemId: ids.tramadol,
        lotNumber: "T1",
        expiryDate: manilaDate(300),
        quantity: 20,
        reason: "Delivery",
        reference: "DR-2001",
        idempotencyKey: nextKey(),
      })
      .expect(201);
    await api(nurse)
      .post("/issues", { locationId: ids.pharmacy, itemId: ids.tramadol, quantity: 2, issuedTo: "Ward A", idempotencyKey: nextKey() })
      .expect(422);
    await api(nurse)
      .post("/issues", {
        locationId: ids.pharmacy,
        itemId: ids.tramadol,
        quantity: 2,
        issuedTo: "Ward A",
        reason: "Post-operative pain",
        reference: "RX-555",
        idempotencyKey: nextKey(),
      })
      .expect(201);
  });

  it("keeps the ledger append-only and balances non-negative, and audits every movement", async () => {
    await expect(ctx.pool.query("UPDATE inventory_movement SET quantity = 1")).rejects.toThrow();
    await expect(ctx.pool.query("DELETE FROM inventory_movement")).rejects.toThrow();
    await expect(ctx.pool.query("UPDATE inventory_balance SET quantity = -1")).rejects.toThrow(/check/);
    const movements = await api(officer).get(`/movements?itemId=${ids.para}`).expect(200);
    expect(movements.body.length).toBeGreaterThanOrEqual(9);
    expect(movements.body[0]).toMatchObject({ itemName: "Paracetamol 500 mg", stockUnit: "tablet" });
    const audit = await auditRows(ctx.pool, "action LIKE 'inventory.%'");
    const actions = new Set(audit.map((a) => a.action));
    for (const a of ["inventory.receive", "inventory.issue", "inventory.transfer", "inventory.adjust", "inventory.write-off", "inventory.item.create"])
      expect(actions).toContain(a);
    expect(audit.find((a) => a.action === "inventory.write-off")?.reason).toBe("Expired");
  });
});
