import { randomUUID } from "node:crypto";
import { as, auditRows, createStaff, createTenant, createTestApp, login, manilaDate, type Tenant, type TestContext } from "./harness";

/**
 * Purchase orders (docs/domains/inventory.md): drafts, submission, approval by someone else, deliveries received
 * against the lines (never more than ordered, idempotent), cancelling and closing short, and reorder suggestions that
 * count stock already on order.
 */
describe("inventory procurement", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let officer: string;
  let officer2: string;
  let admin: string;
  let nurse: string;
  const ids: Record<string, string> = {};

  const api = (token: string, facilityId = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1/inventory${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/inventory${url}`).set(as(token, facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1/inventory${url}`).set(as(token, facilityId)).send(body),
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "procurement-org");
    await createStaff(ctx.pool, tenant, "officer@procure.ph", ["inventory_officer"]);
    await createStaff(ctx.pool, tenant, "officer2@procure.ph", ["inventory_officer"]);
    await createStaff(ctx.pool, tenant, "admin@procure.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "nurse@procure.ph", ["nurse"]);
    [officer, officer2, admin, nurse] = await Promise.all(
      ["officer", "officer2", "admin", "nurse"].map(async (u) => (await login(ctx, `${u}@procure.ph`)).accessToken),
    );
    const post = async (url: string, body: object) => (await api(admin).post(url, body).expect(201)).body.id as string;
    ids.amox = await post("/items", { code: "amoxicillin-500", name: "Amoxicillin 500 mg", category: "medicine", stockUnit: "capsule" });
    ids.gloves = await post("/items", { code: "gloves-m", name: "Examination gloves (M)", category: "ppe", stockUnit: "box", tracksLots: false });
    ids.supplier = await post("/suppliers", { code: "pharma-dist", name: "Pharma Distributors Inc." });
    ids.pharmacy = await post("/locations", { facilityId: tenant.facilityId, code: "pharmacy", name: "Pharmacy" });
    ids.annex = await post("/locations", { facilityId: tenant.otherFacilityId, code: "annex", name: "Annex store" });
  });
  afterAll(() => ctx.close());

  it("suggests reordering items at or below their reorder level", async () => {
    await api(officer).put(`/locations/${ids.pharmacy}/items/${ids.amox}/reorder-level`, { reorderLevel: 100, reorderQuantity: 500 }).expect(200);
    await api(officer).put(`/locations/${ids.pharmacy}/items/${ids.gloves}/reorder-level`, { reorderLevel: 5 }).expect(200);
    await api(officer)
      .post("/receipts", {
        locationId: ids.pharmacy,
        itemId: ids.gloves,
        quantity: 20,
        supplierId: ids.supplier,
        unitCost: 25000,
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    const suggestions = await api(nurse).get("/reorder-suggestions").expect(200);
    expect(suggestions.body).toEqual([
      expect.objectContaining({ item: expect.objectContaining({ id: ids.amox }), usable: 0, onOrder: 0, reorderLevel: 100, suggestedQuantity: 500 }),
    ]);
  });

  it("drafts, edits and submits an order; the submitter cannot approve it", async () => {
    await api(nurse)
      .post("/purchase-orders", { supplierId: ids.supplier, locationId: ids.pharmacy, lines: [{ itemId: ids.amox, quantity: 10 }] })
      .expect(403);
    await api(officer)
      .post("/purchase-orders", { supplierId: ids.supplier, locationId: ids.annex, lines: [{ itemId: ids.amox, quantity: 10 }] })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("location_other_facility"));
    await api(officer)
      .post("/purchase-orders", {
        supplierId: ids.supplier,
        locationId: ids.pharmacy,
        lines: [
          { itemId: ids.amox, quantity: 10 },
          { itemId: ids.amox, quantity: 5 },
        ],
      })
      .expect(400);
    const draft = await api(officer)
      .post("/purchase-orders", { supplierId: ids.supplier, locationId: ids.pharmacy, lines: [{ itemId: ids.amox, quantity: 300, unitCost: 850 }] })
      .expect(201);
    expect(draft.body).toMatchObject({ status: "draft", poNumber: `PO-${manilaDate(0).slice(0, 4)}-000001`, totalCost: 255000, unpricedLines: 0 });
    ids.po = draft.body.id;
    const edited = await api(officer)
      .put(`/purchase-orders/${ids.po}`, {
        supplierId: ids.supplier,
        locationId: ids.pharmacy,
        notes: "Urgent",
        lines: [
          { itemId: ids.amox, quantity: 500, unitCost: 800 },
          { itemId: ids.gloves, quantity: 10 },
        ],
        version: 1,
      })
      .expect(200);
    expect(edited.body).toMatchObject({ version: 2, notes: "Urgent", totalCost: 400000, unpricedLines: 1 });
    expect(edited.body.lines.map((l: { lineNumber: number; quantityOrdered: number }) => [l.lineNumber, l.quantityOrdered])).toEqual([
      [1, 500],
      [2, 10],
    ]);
    await api(officer)
      .put(`/purchase-orders/${ids.po}`, { supplierId: ids.supplier, locationId: ids.pharmacy, lines: [{ itemId: ids.amox, quantity: 1 }], version: 1 })
      .expect(409);

    // Nothing to receive before approval.
    const submitted = await api(officer).post(`/purchase-orders/${ids.po}/submit`, { version: 2 }).expect(200);
    expect(submitted.body).toMatchObject({ status: "submitted", submittedByYou: true });
    await api(officer)
      .put(`/purchase-orders/${ids.po}`, { supplierId: ids.supplier, locationId: ids.pharmacy, lines: [{ itemId: ids.amox, quantity: 1 }], version: 3 })
      .expect(409);
    await expect(ctx.pool.query(`UPDATE inventory_purchase_order_line SET quantity_ordered = 1 WHERE purchase_order_id = $1`, [ids.po])).rejects.toThrow(
      /only records what was received/,
    );

    // On order now: the amoxicillin suggestion disappears.
    const suggestions = await api(officer).get("/reorder-suggestions").expect(200);
    expect(suggestions.body).toEqual([]);

    await api(officer).post(`/purchase-orders/${ids.po}/approve`, { version: 3 }).expect(403); // no approve permission
    // An administrator who submitted an order cannot approve it either.
    const own = await api(admin)
      .post("/purchase-orders", { supplierId: ids.supplier, locationId: ids.pharmacy, lines: [{ itemId: ids.gloves, quantity: 2 }] })
      .expect(201);
    await api(admin).post(`/purchase-orders/${own.body.id}/submit`, { version: 1 }).expect(200);
    await api(admin)
      .post(`/purchase-orders/${own.body.id}/approve`, { version: 2 })
      .expect(403)
      .expect((r) => expect(r.body.error.message).toMatch(/someone else approves/));
    await api(admin).post(`/purchase-orders/${own.body.id}/cancel`, { reason: "Ordered by mistake", version: 2 }).expect(200);

    const approved = await api(admin).post(`/purchase-orders/${ids.po}/approve`, { version: 3 }).expect(200);
    expect(approved.body).toMatchObject({ status: "approved", submittedByYou: false });
    const events = await ctx.pool.query(`SELECT event_type FROM domain_event WHERE aggregate_id = $1 ORDER BY occurred_at`, [ids.po]);
    expect(events.rows.map((e) => e.event_type)).toEqual(["InventoryPurchaseOrderSubmitted", "InventoryPurchaseOrderApproved"]);
  });

  it("receives deliveries against the lines, never more than ordered, idempotently", async () => {
    const order = (await api(officer).get(`/purchase-orders/${ids.po}`).expect(200)).body;
    const [amoxLine, glovesLine] = order.lines as Array<{ id: string }>;
    const receipt = (body: object) => api(officer2).post(`/purchase-orders/${ids.po}/receipts`, body);

    await receipt({
      reference: "DR-77",
      lines: [{ lineId: amoxLine!.id, quantity: 501, lotNumber: "AMX1", expiryDate: manilaDate(300) }],
      idempotencyKey: randomUUID(),
    })
      .expect(422)
      .expect((r) => expect(r.body.error).toMatchObject({ code: "over_receipt", details: { outstanding: 500 } }));
    await receipt({ reference: "DR-77", lines: [{ lineId: amoxLine!.id, quantity: 100 }], idempotencyKey: randomUUID() })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("lot_required"));
    await api(nurse)
      .post(`/purchase-orders/${ids.po}/receipts`, { reference: "DR-77", lines: [{ lineId: glovesLine!.id, quantity: 1 }], idempotencyKey: randomUUID() })
      .expect(403);

    const key = randomUUID();
    const first = await receipt({
      reference: "DR-77",
      lines: [
        { lineId: amoxLine!.id, quantity: 300, lotNumber: "AMX1", expiryDate: manilaDate(300) },
        { lineId: glovesLine!.id, quantity: 10 },
      ],
      idempotencyKey: key,
    }).expect(200);
    expect(first.body.status).toBe("partially_received");
    expect(first.body.lines.map((l: { quantityReceived: number; outstanding: number }) => [l.quantityReceived, l.outstanding])).toEqual([
      [300, 200],
      [10, 0],
    ]);
    // The same delivery again changes nothing.
    const again = await receipt({ reference: "DR-77", lines: [{ lineId: amoxLine!.id, quantity: 300, lotNumber: "AMX1" }], idempotencyKey: key }).expect(200);
    expect(again.body.lines[0].quantityReceived).toBe(300);

    const movements = await ctx.pool.query(
      `SELECT kind, quantity, supplier_id, unit_cost, reference, source_type, source_id FROM inventory_movement WHERE source_type = 'purchase_order_line' ORDER BY quantity`,
    );
    expect(movements.rows).toEqual([
      {
        kind: "receipt",
        quantity: 10,
        supplier_id: ids.supplier,
        unit_cost: null,
        reference: "DR-77",
        source_type: "purchase_order_line",
        source_id: glovesLine!.id,
      },
      {
        kind: "receipt",
        quantity: 300,
        supplier_id: ids.supplier,
        unit_cost: "800",
        reference: "DR-77",
        source_type: "purchase_order_line",
        source_id: amoxLine!.id,
      },
    ]);
    // Goods have arrived: the order can be closed short, not cancelled.
    await api(officer).post(`/purchase-orders/${ids.po}/cancel`, { reason: "No longer needed", version: first.body.version }).expect(409);

    const rest = await receipt({
      reference: "DR-81",
      lines: [{ lineId: amoxLine!.id, quantity: 200, lotNumber: "AMX2", expiryDate: manilaDate(400) }],
      idempotencyKey: randomUUID(),
    }).expect(200);
    expect(rest.body.status).toBe("received");
    await receipt({ reference: "DR-82", lines: [{ lineId: amoxLine!.id, quantity: 1, lotNumber: "AMX2" }], idempotencyKey: randomUUID() }).expect(409);
    await expect(ctx.pool.query(`UPDATE inventory_purchase_order SET notes = 'x' WHERE id = $1`, [ids.po])).rejects.toThrow(/can no longer change/);
    const stock = await api(officer).get(`/stock?locationId=${ids.pharmacy}`).expect(200);
    expect(stock.body.rows.find((r: { item: { id: string } }) => r.item.id === ids.amox)).toMatchObject({ onHand: 500 });
  });

  it("closes an order short with a reason", async () => {
    const po = await api(officer)
      .post("/purchase-orders", { supplierId: ids.supplier, locationId: ids.pharmacy, lines: [{ itemId: ids.gloves, quantity: 50 }] })
      .expect(201);
    await api(officer).post(`/purchase-orders/${po.body.id}/close`, { reason: "Supplier out of stock", version: 1 }).expect(409);
    await api(officer).post(`/purchase-orders/${po.body.id}/submit`, { version: 1 }).expect(200);
    await api(admin).post(`/purchase-orders/${po.body.id}/approve`, { version: 2 }).expect(200);
    const line = po.body.lines[0].id;
    await api(officer)
      .post(`/purchase-orders/${po.body.id}/receipts`, { reference: "DR-90", lines: [{ lineId: line, quantity: 20 }], idempotencyKey: randomUUID() })
      .expect(200);
    await api(officer).post(`/purchase-orders/${po.body.id}/close`, { reason: "x", version: 4 }).expect(400);
    const closed = await api(officer).post(`/purchase-orders/${po.body.id}/close`, { reason: "Supplier out of stock", version: 4 }).expect(200);
    expect(closed.body).toMatchObject({ status: "closed", endReason: "Supplier out of stock" });
    const open = await api(officer).get("/purchase-orders?status=open").expect(200);
    expect(open.body).toEqual([]);
    const all = await api(officer).get("/purchase-orders").expect(200);
    expect(all.body.map((o: { status: string }) => o.status).sort()).toEqual(["cancelled", "closed", "received"]);
    // Orders belong to their facility.
    await api(officer, tenant.otherFacilityId).get(`/purchase-orders/${po.body.id}`).expect(404);
  });

  it("audits every step", async () => {
    const actions = (await auditRows(ctx.pool, "action LIKE 'inventory.purchase-order.%'")).map((a) => a.action);
    for (const action of ["create", "update", "submit", "approve", "receive", "cancel", "close"])
      expect(actions).toContain(`inventory.purchase-order.${action}`);
  });
});
