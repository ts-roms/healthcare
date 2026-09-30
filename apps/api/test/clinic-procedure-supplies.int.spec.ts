import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

interface SupplyLine {
  id: string;
  itemId: string;
  lotId: string;
  lotNumber: string | null;
  quantity: number;
  outstanding: number | null;
  returnsLineId: string | null;
}
interface SupplyUse {
  id: string;
  procedureId: string;
  kind: "issue" | "return";
  locationName: string | null;
  reason: string | null;
  lines: SupplyLine[];
}

/**
 * Supplies used in clinic procedures, taken from inventory (docs/domains/clinic.md, "Procedures"; migration 0089): the
 * dental pattern — templates per catalogue entry, issues through inventory's own rules in the clinic's transaction
 * (FEFO, never expired lots, all or nothing, only the clinic's categories), ledger rows that name the procedure,
 * idempotent retries, explicit returns, and organization isolation.
 */
describe("clinic procedure supplies", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let cashier: string;
  let outsider: string;
  let other: Tenant;
  let encounterId: string;
  let procedureId: string;
  let issued: SupplyUse;
  const ids: Record<string, string> = {};
  let n = 0;
  const key = () => `clinic-supplies-${++n}-${Date.now()}`;

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const balance = async (lotId: string) =>
    Number((await ctx.pool.query(`SELECT quantity FROM inventory_balance WHERE lot_id = $1 AND location_id = $2`, [lotId, ids.room])).rows[0]?.quantity ?? 0);
  const receive = async (itemId: string, quantity: number, lotNumber?: string, expiryDate?: string) =>
    (await api(admin).post("/inventory/receipts", { locationId: ids.room, itemId, quantity, lotNumber, expiryDate, idempotencyKey: key() }).expect(201)).body
      .movements[0].lotId as string;
  const code = (status: number, expected: string) => (r: { status: number; body: { error?: { code?: string } } }) => {
    expect(r.status).toBe(status);
    expect(r.body.error?.code).toBe(expected);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "procsup-org");
    other = await createTenant(ctx.pool, "procsup-other");
    await createStaff(ctx.pool, tenant, "admin@procsup.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "doctor@procsup.ph", ["physician"]);
    await createStaff(ctx.pool, tenant, "cashier@procsup.ph", ["cashier"]);
    await createStaff(ctx.pool, other, "admin@procsup-other.ph", ["org_admin"]);
    [admin, doctor, cashier] = await Promise.all(["admin", "doctor", "cashier"].map(async (u) => (await login(ctx, `${u}@procsup.ph`)).accessToken));
    outsider = (await login(ctx, "admin@procsup-other.ph")).accessToken;
    const patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;

    const item = async (body: object) => (await api(admin).post("/inventory/items", body).expect(201)).body.id as string;
    ids.suture = await item({ code: "suture-4-0", name: "Nylon suture 4-0", category: "medical_supply", stockUnit: "pack" });
    ids.lido = await item({ code: "lidocaine-1", name: "Lidocaine 1% vial", category: "medicine", stockUnit: "vial" });
    ids.gloves = await item({ code: "gloves-s", name: "Sterile gloves", category: "ppe", stockUnit: "pair", tracksLots: false });
    ids.composite = await item({ code: "composite", name: "Composite syringe", category: "dental_supply", stockUnit: "syringe" });
    ids.room = (
      await api(admin).post("/inventory/locations", { facilityId: tenant.facilityId, code: "proc-room", name: "Procedure room" }).expect(201)
    ).body.id;
    ids.s1 = await receive(ids.suture, 2, "S1", manilaDate(20));
    ids.s2 = await receive(ids.suture, 10, "S2", manilaDate(200));
    ids.sOld = await receive(ids.suture, 10, "S0", manilaDate(-1));
    ids.l1 = await receive(ids.lido, 5, "L1", manilaDate(300));
    ids.g = await receive(ids.gloves, 20);
    await receive(ids.composite, 4, "C1", manilaDate(300));

    ids.definition = (
      await api(admin).post("/clinic/procedure-definitions", { code: "SUT", name: "Suture repair", requiresBodySite: true }).expect(201)
    ).body.id;
    encounterId = (await api(doctor).post("/encounters", { patientId, chiefComplaint: "Laceration" }).expect(201)).body.id;
    procedureId = (await api(doctor).post(`/encounters/${encounterId}/procedures`, { definitionId: ids.definition, bodySite: "left hand" }).expect(201)).body
      .id;
  });
  afterAll(() => ctx.close());

  it("keeps supply templates per catalogue entry (clinic.configure, audited, only the clinic's categories)", async () => {
    const template = {
      items: [
        { itemId: ids.lido, quantity: 1 },
        { itemId: ids.suture, quantity: 1 },
        { itemId: ids.gloves, quantity: 1 },
      ],
    };
    await api(doctor).put(`/clinic/procedure-definitions/${ids.definition}/supplies`, template).expect(403);
    await api(admin)
      .put(`/clinic/procedure-definitions/${ids.definition}/supplies`, { items: [{ itemId: ids.composite, quantity: 1 }] })
      .expect(code(422, "invalid_supply_template"));
    await api(admin).put(`/clinic/procedure-definitions/${ids.definition}/supplies`, template).expect(200);
    const options = (await api(doctor).get("/clinic/procedure-supplies/options").expect(200)).body;
    expect(options.templates).toEqual([{ definitionId: ids.definition, ...template }]);
    expect(options.locations).toEqual([{ id: ids.room, code: "proc-room", name: "Procedure room" }]);
    // Dental supplies are not offered to clinic procedures; usable stock leaves out the expired lot.
    expect(options.items.map((i: { id: string }) => i.id).sort()).toEqual([ids.suture, ids.lido, ids.gloves].sort());
    expect(options.items.find((i: { id: string }) => i.id === ids.suture).usable).toEqual({ [ids.room]: 12 });
    expect(await auditRows(ctx.pool, `action = 'clinic.procedure-supply-template.update'`)).toHaveLength(1);
  });

  it("issues what the procedure used first expiry first, in the clinic's transaction, idempotently", async () => {
    const body = {
      locationId: ids.room,
      lines: [
        { itemId: ids.suture, quantity: 3 },
        { itemId: ids.lido, quantity: 1 },
        { itemId: ids.gloves, quantity: 2 },
      ],
      idempotencyKey: key(),
    };
    await api(cashier).post(`/procedures/${procedureId}/supplies`, body).expect(403);
    // All or nothing: too much lidocaine refuses the whole use.
    await api(doctor)
      .post(`/procedures/${procedureId}/supplies`, {
        ...body,
        lines: [
          { itemId: ids.suture, quantity: 1 },
          { itemId: ids.lido, quantity: 50 },
        ],
        idempotencyKey: key(),
      })
      .expect(422);
    expect(await balance(ids.s1)).toBe(2);
    await api(doctor)
      .post(`/procedures/${procedureId}/supplies`, { ...body, lines: [{ itemId: ids.composite, quantity: 1 }], idempotencyKey: key() })
      .expect(code(422, "invalid_supplies"));

    issued = (await api(doctor).post(`/procedures/${procedureId}/supplies`, body).expect(201)).body;
    expect(issued).toMatchObject({ procedureId, kind: "issue", locationName: "Procedure room" });
    const sutureLines = issued.lines.filter((l) => l.itemId === ids.suture);
    expect(sutureLines.map((l) => [l.lotNumber, l.quantity])).toEqual([
      ["S1", 2],
      ["S2", 1],
    ]);
    expect(await balance(ids.s1)).toBe(0);
    expect(await balance(ids.sOld)).toBe(10);
    const again = await api(doctor).post(`/procedures/${procedureId}/supplies`, body).expect(201);
    expect(again.body.id).toBe(issued.id);
    expect(await balance(ids.s2)).toBe(9);

    const ledger = await ctx.pool.query(`SELECT kind, source_type, issued_to FROM inventory_movement WHERE source_id = $1`, [procedureId]);
    expect(ledger.rows.length).toBe(4);
    expect(new Set(ledger.rows.map((r) => `${r.kind}:${r.source_type}:${r.issued_to}`))).toEqual(new Set(["issue:clinic_procedure:Clinic procedure"]));
    const audit = await auditRows(ctx.pool, `action = 'clinic.procedure-supplies.issue'`);
    expect(audit).toHaveLength(1);
    const listed = (await api(doctor).get(`/encounters/${encounterId}/procedure-supplies`).expect(200)).body as SupplyUse[];
    expect(listed.map((u) => u.id)).toEqual([issued.id]);
  });

  it("returns unused supplies to the lots they came from, never more than is out", async () => {
    const line = issued.lines.find((l) => l.itemId === ids.suture && l.lotNumber === "S2")!;
    await api(doctor)
      .post(`/procedures/${procedureId}/supplies/returns`, { lines: [{ lineId: line.id, quantity: 2 }], reason: "Unopened", idempotencyKey: key() })
      .expect(code(422, "invalid_supply_return"));
    const returned = await api(doctor)
      .post(`/procedures/${procedureId}/supplies/returns`, { lines: [{ lineId: line.id, quantity: 1 }], reason: "Unopened", idempotencyKey: key() })
      .expect(201);
    expect(returned.body).toMatchObject({ kind: "return", reason: "Unopened", lines: [{ returnsLineId: line.id, quantity: 1 }] });
    expect(await balance(ids.s2)).toBe(10);
    const listed = (await api(doctor).get(`/encounters/${encounterId}/procedure-supplies`).expect(200)).body as SupplyUse[];
    expect(listed.find((u) => u.kind === "issue")!.lines.find((l) => l.id === line.id)!.outstanding).toBe(0);
    await expect(ctx.pool.query(`UPDATE clinic_procedure_supply_use SET reason = 'x' WHERE id = $1`, [returned.body.id])).rejects.toThrow();
  });

  it("refuses new supplies once the procedure is entered in error, and keeps other organizations out", async () => {
    await api(doctor).post(`/procedures/${procedureId}/entered-in-error`, { reason: "Wrong consultation" }).expect(200);
    await api(doctor)
      .post(`/procedures/${procedureId}/supplies`, { locationId: ids.room, lines: [{ itemId: ids.gloves, quantity: 1 }], idempotencyKey: key() })
      .expect(code(422, "procedure_entered_in_error"));
    await ctx
      .http()
      .post(`/api/v1/procedures/${procedureId}/supplies`)
      .set(as(outsider, other.facilityId))
      .send({ locationId: ids.room, lines: [{ itemId: ids.gloves, quantity: 1 }], idempotencyKey: key() })
      .expect(404);
    expect((await ctx.http().get(`/api/v1/encounters/${encounterId}/procedure-supplies`).set(as(outsider)).expect(200)).body).toEqual([]);
  });
});
