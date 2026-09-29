import { randomUUID } from "node:crypto";
import { as, auditRows, createStaff, createTenant, createTestApp, login, manilaDate, type Tenant, type TestContext } from "./harness";

/**
 * Inventory valuation and supplier invoices (docs/domains/inventory.md): lot cost as the weighted average of priced
 * receipts, a cost recorded on every other movement, stock value and usage at cost; supplier invoices matched against
 * what was ordered and received, approved by someone else, paid or voided, and never edited.
 */
describe("inventory valuation and supplier invoices", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let officer: string;
  let admin: string;
  let nurse: string;
  const ids: Record<string, string> = {};

  const api = (token: string, facilityId = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1/inventory${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/inventory${url}`).set(as(token, facilityId)).send(body),
  });
  const key = () => randomUUID();

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "valuation-org");
    await createStaff(ctx.pool, tenant, "officer@value.ph", ["inventory_officer"]);
    await createStaff(ctx.pool, tenant, "admin@value.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "nurse@value.ph", ["nurse"]);
    [officer, admin, nurse] = await Promise.all(["officer", "admin", "nurse"].map(async (u) => (await login(ctx, `${u}@value.ph`)).accessToken));
    const post = async (url: string, body: object) => (await api(admin).post(url, body).expect(201)).body.id as string;
    ids.amox = await post("/items", { code: "amoxicillin-500", name: "Amoxicillin 500 mg", category: "medicine", stockUnit: "capsule" });
    ids.gloves = await post("/items", { code: "gloves-m", name: "Examination gloves (M)", category: "ppe", stockUnit: "box", tracksLots: false });
    ids.supplier = await post("/suppliers", { code: "pharma-dist", name: "Pharma Distributors Inc." });
    ids.pharmacy = await post("/locations", { facilityId: tenant.facilityId, code: "pharmacy", name: "Pharmacy" });

    // An approved order: 300 capsules at ₱8.50, 10 boxes at ₱120.00.
    const po = await api(officer)
      .post("/purchase-orders", {
        supplierId: ids.supplier,
        locationId: ids.pharmacy,
        lines: [
          { itemId: ids.amox, quantity: 300, unitCost: 850 },
          { itemId: ids.gloves, quantity: 10, unitCost: 12_000 },
        ],
      })
      .expect(201);
    ids.po = po.body.id;
    [ids.amoxLine, ids.glovesLine] = po.body.lines.map((l: { id: string }) => l.id);
    await api(officer).post(`/purchase-orders/${ids.po}/submit`, { version: 1 }).expect(200);
    await api(admin).post(`/purchase-orders/${ids.po}/approve`, { version: 2 }).expect(200);
  });
  afterAll(() => ctx.close());

  it("values stock at each lot's average receipt cost and records that cost on every other movement", async () => {
    // Delivery: 200 capsules of lot AMX1 and the 10 boxes, at the order's prices.
    await api(officer)
      .post(`/purchase-orders/${ids.po}/receipts`, {
        reference: "DR-1",
        lines: [
          { lineId: ids.amoxLine, quantity: 200, lotNumber: "AMX1", expiryDate: manilaDate(300) },
          { lineId: ids.glovesLine, quantity: 10 },
        ],
        idempotencyKey: key(),
      })
      .expect(200);
    // More of the same lot bought elsewhere at ₱10.00, and a donated lot with no cost.
    await api(officer)
      .post("/receipts", {
        locationId: ids.pharmacy,
        itemId: ids.amox,
        lotNumber: "AMX1",
        expiryDate: manilaDate(300),
        quantity: 100,
        unitCost: 1_000,
        idempotencyKey: key(),
      })
      .expect(201);
    await api(officer)
      .post("/receipts", { locationId: ids.pharmacy, itemId: ids.amox, lotNumber: "DON1", expiryDate: manilaDate(400), quantity: 50, idempotencyKey: key() })
      .expect(201);

    // Lot AMX1 costs (200 × 850 + 100 × 1000) / 300 = 900 per capsule; FEFO takes it first.
    const issue = await api(nurse)
      .post("/issues", { locationId: ids.pharmacy, itemId: ids.amox, quantity: 30, issuedTo: "Ward A", idempotencyKey: key() })
      .expect(201);
    ids.amoxLot = issue.body.movements[0].lotId;
    const gloves = await api(nurse)
      .post("/issues", { locationId: ids.pharmacy, itemId: ids.gloves, quantity: 1, issuedTo: "ER", idempotencyKey: key() })
      .expect(201);
    await api(officer)
      .post("/write-offs", { locationId: ids.pharmacy, lotId: gloves.body.movements[0].lotId, quantity: 2, reason: "Torn packaging", idempotencyKey: key() })
      .expect(201);
    const costs = await ctx.pool.query<{ kind: string; quantity: number; unit_cost: string | null }>(
      `SELECT kind, quantity, unit_cost FROM inventory_movement WHERE organization_id = $1 AND kind <> 'receipt' ORDER BY recorded_at`,
      [tenant.organizationId],
    );
    expect(costs.rows.map((r) => [r.kind, r.quantity, r.unit_cost === null ? null : Number(r.unit_cost)])).toEqual([
      ["issue", -30, 900],
      ["issue", -1, 12_000],
      ["write_off", -2, 12_000],
    ]);

    await api(nurse).get("/valuation").expect(403);
    const value = (await api(officer).get("/valuation").expect(200)).body;
    // 270 × 900 + 7 × 12 000; the donated 50 are unvalued.
    expect(value.totalValue).toBe(243_000 + 84_000);
    expect(value.unvaluedLines).toBe(1);
    expect(value.lines).toEqual([
      expect.objectContaining({ name: "Amoxicillin 500 mg", quantity: 320, value: 243_000, unvaluedQuantity: 50, averageUnitCost: 900 }),
      expect.objectContaining({ name: "Examination gloves (M)", quantity: 7, value: 84_000, unvaluedQuantity: 0, averageUnitCost: 12_000 }),
    ]);
    expect(value.byCategory).toEqual([
      { category: "medicine", value: 243_000, lines: 1 },
      { category: "ppe", value: 84_000, lines: 1 },
    ]);
    expect(value.byLocation).toEqual([{ locationId: ids.pharmacy, name: "Pharmacy", value: 327_000, lines: 2 }]);

    const usage = (
      await api(officer)
        .get(`/valuation/usage?from=${manilaDate(0)}&to=${manilaDate(0)}`)
        .expect(200)
    ).body;
    const row = (kind: string) => usage.rows.find((r: { kind: string; sourceType: string | null }) => r.kind === kind && r.sourceType === null);
    expect(usage.rows.find((r: { sourceType: string | null }) => r.sourceType === "purchase_order_line")).toMatchObject({
      kind: "receipt",
      quantity: 210,
      value: 290_000,
    });
    expect(row("receipt")).toMatchObject({ quantity: 150, value: 100_000, unvaluedQuantity: 50 });
    expect(row("issue")).toMatchObject({ quantity: -31, value: -39_000 });
    expect(row("write_off")).toMatchObject({ quantity: -2, value: -24_000 });
    expect(usage.topItems).toEqual([
      expect.objectContaining({ name: "Examination gloves (M)", quantity: 3, value: 36_000 }),
      expect.objectContaining({ name: "Amoxicillin 500 mg", quantity: 30, value: 27_000 }),
    ]);
    await api(officer)
      .get(`/valuation/usage?from=${manilaDate(0)}&to=${manilaDate(-1)}`)
      .expect(400);
    await api(officer)
      .get(`/valuation/usage?from=${manilaDate(-400)}&to=${manilaDate(0)}`)
      .expect(400);
  });

  it("invoices only what was received and not yet invoiced, with price differences shown", async () => {
    const invoicing = (await api(officer).get(`/purchase-orders/${ids.po}/invoicing`).expect(200)).body;
    expect(
      invoicing.lines.map((l: { quantityOrdered: number; quantityReceived: number; quantityInvoiced: number; invoiceable: number }) => [
        l.quantityOrdered,
        l.quantityReceived,
        l.quantityInvoiced,
        l.invoiceable,
      ]),
    ).toEqual([
      [300, 200, 0, 200],
      [10, 10, 0, 10],
    ]);

    const record = (token: string, body: object) => api(token).post(`/purchase-orders/${ids.po}/invoices`, body);
    await record(officer, {
      invoiceNumber: "SI-1001",
      invoiceDate: manilaDate(-2),
      lines: [{ purchaseOrderLineId: ids.amoxLine, quantity: 250, unitPrice: 870 }],
    })
      .expect(422)
      .expect((r) => expect(r.body.error).toMatchObject({ code: "invoiced_beyond_received", details: [{ invoiceable: 200, requested: 250 }] }));
    await record(nurse, {
      invoiceNumber: "SI-1001",
      invoiceDate: manilaDate(-2),
      lines: [{ purchaseOrderLineId: ids.amoxLine, quantity: 1, unitPrice: 850 }],
    }).expect(403);

    // ₱8.70 invoiced against ₱8.50 ordered.
    const first = await record(officer, {
      invoiceNumber: "SI-1001",
      invoiceDate: manilaDate(-2),
      dueDate: manilaDate(28),
      vatAmount: 35_280,
      lines: [
        { purchaseOrderLineId: ids.amoxLine, quantity: 150, unitPrice: 870 },
        { purchaseOrderLineId: ids.glovesLine, quantity: 10, unitPrice: 12_000 },
      ],
    }).expect(201);
    ids.first = first.body.id;
    expect(first.body).toMatchObject({
      status: "recorded",
      poNumber: expect.stringMatching(/^PO-/),
      linesTotal: 250_500,
      vatAmount: 35_280,
      total: 285_780,
      overdue: false,
    });
    expect(first.body.lines.map((l: { itemName: string; amount: number; variance: number | null }) => [l.itemName, l.amount, l.variance])).toEqual([
      ["Amoxicillin 500 mg", 130_500, 20],
      ["Examination gloves (M)", 120_000, 0],
    ]);
    await record(officer, {
      invoiceNumber: "si-1001 ",
      invoiceDate: manilaDate(-2),
      lines: [{ purchaseOrderLineId: ids.amoxLine, quantity: 1, unitPrice: 850 }],
    })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("duplicate_invoice_number"));

    // The rest of the capsules, due yesterday: overdue.
    const second = await record(admin, {
      invoiceNumber: "SI-1002",
      invoiceDate: manilaDate(-5),
      dueDate: manilaDate(-1),
      lines: [{ purchaseOrderLineId: ids.amoxLine, quantity: 50, unitPrice: 850 }],
    }).expect(201);
    ids.second = second.body.id;
    expect(second.body.overdue).toBe(true);
    await record(officer, {
      invoiceNumber: "SI-1003",
      invoiceDate: manilaDate(-1),
      lines: [{ purchaseOrderLineId: ids.glovesLine, quantity: 1, unitPrice: 12_000 }],
    })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("invoiced_beyond_received"));
  });

  it("approves by someone else (a price difference needs a note), pays, voids, and never edits", async () => {
    await api(officer).post(`/supplier-invoices/${ids.first}/approve`, { version: 1 }).expect(403); // no approve permission
    await api(admin)
      .post(`/supplier-invoices/${ids.second}/approve`, { version: 1 })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("same_person"));
    await api(admin)
      .post(`/supplier-invoices/${ids.first}/approve`, { version: 1 })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("approval_note_required"));
    const approved = await api(admin)
      .post(`/supplier-invoices/${ids.first}/approve`, { version: 1, note: "Supplier price increase from September" })
      .expect(200);
    expect(approved.body).toMatchObject({ status: "approved", approvalNote: "Supplier price increase from September", version: 2 });

    await api(officer)
      .post(`/supplier-invoices/${ids.first}/payment`, { version: 2, paidOn: manilaDate(1), paymentReference: "CHK-5521" })
      .expect(422);
    await api(officer)
      .post(`/supplier-invoices/${ids.second}/payment`, { version: 1, paidOn: manilaDate(0), paymentReference: "CHK-5521" })
      .expect(422); // not approved
    const paid = await api(officer)
      .post(`/supplier-invoices/${ids.first}/payment`, { version: 2, paidOn: manilaDate(0), paymentReference: "CHK-5521" })
      .expect(200);
    expect(paid.body).toMatchObject({ status: "paid", paidOn: manilaDate(0), paymentReference: "CHK-5521" });
    await api(officer)
      .post(`/supplier-invoices/${ids.first}/void`, { version: 3, reason: "Wrong invoice" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("invalid_invoice_status"));

    // Voiding frees the quantity and the number.
    await api(officer).post(`/supplier-invoices/${ids.second}/void`, { version: 1, reason: "Recorded against the wrong order" }).expect(200);
    const again = await api(officer)
      .post(`/purchase-orders/${ids.po}/invoices`, {
        invoiceNumber: "SI-1002",
        invoiceDate: manilaDate(-5),
        lines: [{ purchaseOrderLineId: ids.amoxLine, quantity: 50, unitPrice: 850 }],
      })
      .expect(201);

    const open = (await api(nurse).get("/supplier-invoices?status=open").expect(200)).body;
    expect(open.map((i: { id: string }) => i.id)).toEqual([again.body.id]);
    expect((await api(nurse).get("/supplier-invoices?status=overdue").expect(200)).body).toEqual([]);
    const forOrder = (await api(nurse).get(`/supplier-invoices?purchaseOrderId=${ids.po}`).expect(200)).body;
    expect(forOrder.map((i: { status: string }) => i.status).sort()).toEqual(["paid", "recorded", "void"]);

    await expect(ctx.pool.query(`UPDATE inventory_supplier_invoice SET total = 1 WHERE id = $1`, [again.body.id])).rejects.toThrow(/not edited/);
    await expect(ctx.pool.query(`DELETE FROM inventory_supplier_invoice WHERE id = $1`, [ids.second])).rejects.toThrow(/never deleted/);
    await expect(ctx.pool.query(`UPDATE inventory_supplier_invoice_line SET quantity = 1 WHERE invoice_id = $1`, [again.body.id])).rejects.toThrow();

    const actions = (await auditRows(ctx.pool, "action LIKE 'inventory.supplier-invoice.%'")).map((a) => a.action);
    expect(new Set(actions)).toEqual(
      new Set(["inventory.supplier-invoice.record", "inventory.supplier-invoice.approve", "inventory.supplier-invoice.pay", "inventory.supplier-invoice.void"]),
    );
    const events = await ctx.pool.query(`SELECT DISTINCT event_type FROM domain_event WHERE event_type LIKE 'InventorySupplierInvoice%'`);
    expect(events.rows.map((e) => e.event_type).sort()).toEqual([
      "InventorySupplierInvoiceApproved",
      "InventorySupplierInvoicePaid",
      "InventorySupplierInvoiceRecorded",
      "InventorySupplierInvoiceVoided",
    ]);
  });
});
