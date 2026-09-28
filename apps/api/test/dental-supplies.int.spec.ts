import {
  as,
  auditRows,
  createClinician,
  createStaff,
  createTenant,
  createTestApp,
  drainEvents,
  juan,
  login,
  manilaDate,
  type Tenant,
  type TestContext,
} from "./harness";

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
  lines: SupplyLine[];
}

/**
 * Dental supply use from inventory (docs/domains/dental.md#supplies-used): templates per procedure type, the supplies
 * a procedure used issued through inventory's own rules in dentistry's transaction (FEFO, never expired lots, all or
 * nothing, controlled items with reason and reference), ledger rows that name the procedure, idempotent retries,
 * explicit returns of unused supplies, and organization isolation.
 */
describe("dental supplies", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let other: Tenant;
  let admin: string;
  let dentist: string;
  let assistant: string;
  let otherAdmin: string;
  let patientId: string;
  let procedureId: string;
  let issueUse: SupplyUse;
  const ids: Record<string, string> = {};
  let n = 0;
  const key = () => `dental-supplies-${++n}-${Date.now()}`;

  const api = (token: string, facilityId: string | undefined = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });
  const balance = async (lotId: string, locationId = ids.cabinet) =>
    Number((await ctx.pool.query(`SELECT quantity FROM inventory_balance WHERE lot_id = $1 AND location_id = $2`, [lotId, locationId])).rows[0]?.quantity ?? 0);
  const ledger = async () =>
    (
      await ctx.pool.query(
        `SELECT kind, item_id, lot_id, quantity, issued_to, reason, reference, source_type, source_id FROM inventory_movement WHERE source_id = $1 ORDER BY recorded_at, id`,
        [procedureId],
      )
    ).rows;
  const receive = async (itemId: string, quantity: number, lotNumber?: string, expiryDate?: string) =>
    (await api(admin).post("/inventory/receipts", { locationId: ids.cabinet, itemId, quantity, lotNumber, expiryDate, idempotencyKey: key() }).expect(201)).body
      .movements[0].lotId as string;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "supplies-org");
    other = await createTenant(ctx.pool, "supplies-other");
    await createStaff(ctx.pool, tenant, "admin@supplies.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "dentist@supplies.ph", ["dentist"], "dentist");
    await createStaff(ctx.pool, tenant, "assistant@supplies.ph", ["dental_assistant"]);
    await createStaff(ctx.pool, other, "admin@supplies-other.ph", ["org_admin"]);
    admin = (await login(ctx, "admin@supplies.ph")).accessToken;
    dentist = (await login(ctx, "dentist@supplies.ph")).accessToken;
    assistant = (await login(ctx, "assistant@supplies.ph")).accessToken;
    otherAdmin = (await login(ctx, "admin@supplies-other.ph")).accessToken;
    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;

    const item = async (body: object) => (await api(admin).post("/inventory/items", body).expect(201)).body.id as string;
    ids.composite = await item({ code: "composite-a2", name: "Composite A2 syringe", category: "dental_supply", stockUnit: "syringe" });
    ids.lido = await item({ code: "lidocaine-cart", name: "Lidocaine 2% cartridge", category: "medicine", stockUnit: "cartridge" });
    ids.gloves = await item({ code: "gloves-m", name: "Exam gloves (M)", category: "ppe", stockUnit: "pair", tracksLots: false });
    ids.midazolam = await item({ code: "midazolam-5", name: "Midazolam 5 mg/mL", category: "medicine", stockUnit: "ampoule", controlled: true });
    ids.retired = await item({ code: "retired-bond", name: "Retired bonding agent", category: "dental_supply", stockUnit: "bottle" });
    await ctx.http().patch(`/api/v1/inventory/items/${ids.retired}`).set(as(admin, tenant.facilityId)).send({ status: "inactive", version: 1 }).expect(200);
    ids.cabinet = (
      await api(admin).post("/inventory/locations", { facilityId: tenant.facilityId, code: "dental-cabinet", name: "Dental cabinet" }).expect(201)
    ).body.id;
    ids.annexStore = (
      await api(admin).post("/inventory/locations", { facilityId: tenant.otherFacilityId, code: "annex-store", name: "Annex store" }).expect(201)
    ).body.id;
    ids.c1 = await receive(ids.composite, 2, "C1", manilaDate(10));
    ids.c2 = await receive(ids.composite, 5, "C2", manilaDate(100));
    ids.cOld = await receive(ids.composite, 10, "C0", manilaDate(-1));
    ids.l1 = await receive(ids.lido, 20, "L1", manilaDate(200));
    ids.g = await receive(ids.gloves, 50);
    ids.m1 = await api(admin)
      .post("/inventory/receipts", {
        locationId: ids.cabinet,
        itemId: ids.midazolam,
        quantity: 5,
        lotNumber: "M1",
        expiryDate: manilaDate(300),
        reason: "Initial stock",
        reference: "DR-77",
        idempotencyKey: key(),
      })
      .expect(201)
      .then((r) => r.body.movements[0].lotId as string);

    ids.composite1s = (
      await api(admin)
        .post("/dental/procedure-types", { code: "composite-1s", name: "Composite restoration", site: "surface", chartEffect: "restoration" })
        .expect(201)
    ).body.id;
    const encounterId = (await api(dentist).post("/encounters", { patientId, chiefComplaint: "Broken filling" }).expect(201)).body.id;
    procedureId = (
      await api(dentist)
        .post(`/dental/patients/${patientId}/procedures`, { encounterId, procedureTypeId: ids.composite1s, tooth: "16", surfaces: ["O"] })
        .expect(201)
    ).body.id;
  });
  afterAll(() => ctx.close());

  it("keeps supply templates per procedure and a default stock location per facility (settings permission, audited)", async () => {
    const template = {
      items: [
        { itemId: ids.lido, quantity: 1 },
        { itemId: ids.composite, quantity: 1 },
        { itemId: ids.gloves, quantity: 1 },
      ],
    };
    await api(dentist).put(`/dental/procedure-types/${ids.composite1s}/supplies`, template).expect(403);
    const invalid = await api(admin)
      .put(`/dental/procedure-types/${ids.composite1s}/supplies`, {
        items: [
          { itemId: ids.retired, quantity: 1 },
          { itemId: ids.lido, quantity: 1 },
          { itemId: ids.lido, quantity: 2 },
        ],
      })
      .expect(422);
    expect(invalid.body.error).toMatchObject({
      code: "invalid_supply_template",
      details: { [ids.retired]: ["Retired bonding agent is inactive"], [ids.lido]: ["listed more than once"] },
    });
    await api(admin).put(`/dental/procedure-types/${ids.composite1s}/supplies`, template).expect(200);

    await api(dentist).put(`/dental/facilities/${tenant.facilityId}/supply-location`, { locationId: ids.cabinet }).expect(403);
    const wrong = await api(admin).put(`/dental/facilities/${tenant.facilityId}/supply-location`, { locationId: ids.annexStore }).expect(422);
    expect(wrong.body.error.code).toBe("invalid_supply_location");
    await api(admin).put(`/dental/facilities/${tenant.facilityId}/supply-location`, { locationId: ids.cabinet }).expect(200);

    const options = (await api(dentist).get("/dental/supplies/options").expect(200)).body;
    expect(options.defaultLocationId).toBe(ids.cabinet);
    expect(options.locations.map((l: { id: string }) => l.id)).toEqual([ids.cabinet]);
    expect(options.templates).toEqual([{ procedureTypeId: ids.composite1s, items: template.items }]);
    const composite = options.items.find((i: { id: string }) => i.id === ids.composite);
    expect(composite.usable).toEqual({ [ids.cabinet]: 7 }); // the expired lot does not count
    expect(options.items.some((i: { id: string }) => i.id === ids.retired)).toBe(false);

    expect(await auditRows(ctx.pool, "action = 'dental.supply-template.update' AND resource_id = $1", [ids.composite1s])).toHaveLength(1);
    expect(await auditRows(ctx.pool, "action = 'dental.settings.supply-location' AND resource_id = $1", [tenant.facilityId])).toHaveLength(1);
  });

  it("issues the supplies a procedure used first-expiry-first-out, naming the procedure on the ledger, idempotently", async () => {
    const body = {
      locationId: ids.cabinet,
      lines: [
        { itemId: ids.composite, quantity: 3 },
        { itemId: ids.lido, quantity: 1 },
      ],
      idempotencyKey: key(),
    };
    await api(assistant).post(`/dental/procedures/${procedureId}/supplies`, body).expect(403);
    const created = await api(dentist).post(`/dental/procedures/${procedureId}/supplies`, body).expect(201);
    issueUse = created.body;
    expect(issueUse).toMatchObject({ procedureId, kind: "issue", locationName: "Dental cabinet" });
    expect(issueUse.lines.map((l) => [l.lotNumber, l.quantity, l.outstanding])).toEqual([
      ["C1", 2, 2],
      ["C2", 1, 1],
      ["L1", 1, 1],
    ]);
    expect(await balance(ids.c1)).toBe(0);
    expect(await balance(ids.c2)).toBe(4);
    expect(await balance(ids.cOld)).toBe(10);
    const issued = await ledger();
    expect(issued).toHaveLength(3);
    expect(issued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "issue",
          lot_id: ids.c1,
          quantity: -2,
          issued_to: "Dental procedure",
          source_type: "dental_procedure",
          source_id: procedureId,
        }),
        expect.objectContaining({ kind: "issue", lot_id: ids.c2, quantity: -1, source_type: "dental_procedure" }),
        expect.objectContaining({ kind: "issue", lot_id: ids.l1, quantity: -1, source_type: "dental_procedure" }),
      ]),
    );

    // A retry with the same key returns the same use; nothing more is issued.
    const again = await api(dentist).post(`/dental/procedures/${procedureId}/supplies`, body).expect(201);
    expect(again.body.id).toBe(issueUse.id);
    expect(await ledger()).toHaveLength(3);
    expect(await balance(ids.c2)).toBe(4);

    const record = (await api(dentist).get(`/dental/patients/${patientId}`).expect(200)).body;
    expect(record.supplyUses).toEqual([expect.objectContaining({ id: issueUse.id, procedureId, kind: "issue", recordedByName: expect.any(String) })]);

    const audits = await auditRows(ctx.pool, "action = 'dental.supplies.issue' AND patient_id = $1", [patientId]);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ supplyUseId: issueUse.id, locationId: ids.cabinet });
    const inventoryAudit = await auditRows(
      ctx.pool,
      "action = 'inventory.issue' AND metadata->'sources' @> jsonb_build_array(jsonb_build_object('id', $1::text))",
      [procedureId],
    );
    expect(inventoryAudit).toHaveLength(1);
    await drainEvents(ctx);
    const events = await ctx.pool.query(`SELECT payload FROM domain_event WHERE event_type = 'DentalSuppliesIssued' AND aggregate_id = $1`, [procedureId]);
    expect(events.rows).toEqual([{ payload: { supplyUseId: issueUse.id, movementGroupId: expect.any(String), lines: 3 } }]);
  });

  it("refuses the whole use, issuing nothing, when stock is short, lots are expired or a controlled item lacks details", async () => {
    const before = await ledger();
    const short = await api(dentist)
      .post(`/dental/procedures/${procedureId}/supplies`, {
        locationId: ids.cabinet,
        lines: [
          { itemId: ids.gloves, quantity: 2 },
          { itemId: ids.composite, quantity: 5 },
        ],
        idempotencyKey: key(),
      })
      .expect(422);
    // 4 usable in lot C2; the 10 in expired lot C0 are never issued.
    expect(short.body.error).toMatchObject({ code: "insufficient_stock", details: { itemId: ids.composite, available: 4, expired: 10 } });
    expect(await balance(ids.g)).toBe(50);
    expect(await ledger()).toEqual(before);
    expect((await ctx.pool.query(`SELECT count(*)::int AS n FROM dental_supply_use WHERE procedure_id = $1`, [procedureId])).rows[0].n).toBe(1);

    const bare = await api(dentist)
      .post(`/dental/procedures/${procedureId}/supplies`, { locationId: ids.cabinet, lines: [{ itemId: ids.midazolam, quantity: 1 }], idempotencyKey: key() })
      .expect(422);
    expect(bare.body.error.code).toBe("controlled_item_details");
    const otherFacility = await api(dentist)
      .post(`/dental/procedures/${procedureId}/supplies`, { locationId: ids.annexStore, lines: [{ itemId: ids.gloves, quantity: 1 }], idempotencyKey: key() })
      .expect(422);
    expect(otherFacility.body.error.code).toBe("location_other_facility");
    expect(await ledger()).toEqual(before);

    const controlled = await api(dentist)
      .post(`/dental/procedures/${procedureId}/supplies`, {
        locationId: ids.cabinet,
        lines: [{ itemId: ids.midazolam, quantity: 1, reason: "Conscious sedation", reference: "CS-2026-001" }],
        idempotencyKey: key(),
      })
      .expect(201);
    expect(controlled.body.lines).toEqual([expect.objectContaining({ lotNumber: "M1", quantity: 1 })]);
    expect(await balance(ids.m1)).toBe(4);
    expect((await ledger()).at(-1)).toMatchObject({ kind: "issue", reason: "Conscious sedation", reference: "CS-2026-001" });
  });

  it("returns unused supplies explicitly, never more than was issued, also after the procedure is entered in error", async () => {
    const c2Line = issueUse.lines.find((l) => l.lotNumber === "C2")!;
    const c1Line = issueUse.lines.find((l) => l.lotNumber === "C1")!;
    const tooMuch = await api(dentist)
      .post(`/dental/procedures/${procedureId}/supplies/returns`, { lines: [{ lineId: c2Line.id, quantity: 2 }], reason: "Unopened", idempotencyKey: key() })
      .expect(422);
    expect(tooMuch.body.error).toMatchObject({ code: "invalid_supply_return", details: { [c2Line.id]: ["at most 1 can be returned"] } });
    await api(assistant)
      .post(`/dental/procedures/${procedureId}/supplies/returns`, { lines: [{ lineId: c2Line.id, quantity: 1 }], reason: "Unopened", idempotencyKey: key() })
      .expect(403);

    await api(dentist).post(`/dental/procedures/${procedureId}/entered-in-error`, { reason: "Recorded on the wrong tooth" }).expect(200);
    // Used material is consumed: nothing came back automatically, and no more supplies can be issued to it.
    expect(await balance(ids.c2)).toBe(4);
    const refused = await api(dentist)
      .post(`/dental/procedures/${procedureId}/supplies`, { locationId: ids.cabinet, lines: [{ itemId: ids.gloves, quantity: 1 }], idempotencyKey: key() })
      .expect(422);
    expect(refused.body.error.code).toBe("procedure_entered_in_error");

    const body = {
      lines: [
        { lineId: c2Line.id, quantity: 1 },
        { lineId: c1Line.id, quantity: 1 },
      ],
      reason: "Syringes not opened",
      idempotencyKey: key(),
    };
    const returned = await api(dentist).post(`/dental/procedures/${procedureId}/supplies/returns`, body).expect(201);
    expect(returned.body).toMatchObject({ kind: "return", reason: "Syringes not opened" });
    expect(returned.body.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ returnsLineId: c2Line.id, quantity: 1 }),
        expect.objectContaining({ returnsLineId: c1Line.id, quantity: 1 }),
      ]),
    );
    expect(await balance(ids.c2)).toBe(5);
    expect(await balance(ids.c1)).toBe(1);
    const again = await api(dentist).post(`/dental/procedures/${procedureId}/supplies/returns`, body).expect(201);
    expect(again.body.id).toBe(returned.body.id);
    expect(await balance(ids.c2)).toBe(5);
    const returns = (await ledger()).filter((m) => m.kind === "return");
    expect(returns).toHaveLength(2);
    expect(returns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lot_id: ids.c2, quantity: 1, reason: "Syringes not opened", source_type: "dental_procedure", source_id: procedureId }),
        expect.objectContaining({ lot_id: ids.c1, quantity: 1 }),
      ]),
    );

    const record = (await api(dentist).get(`/dental/patients/${patientId}`).expect(200)).body;
    const issue = record.supplyUses.find((u: SupplyUse) => u.id === issueUse.id) as SupplyUse;
    expect(issue.lines.map((l) => [l.lotNumber, l.outstanding])).toEqual([
      ["C1", 1],
      ["C2", 0],
      ["L1", 1],
    ]);
    const second = await api(dentist)
      .post(`/dental/procedures/${procedureId}/supplies/returns`, { lines: [{ lineId: c2Line.id, quantity: 1 }], reason: "Again", idempotencyKey: key() })
      .expect(422);
    expect(second.body.error.details).toEqual({ [c2Line.id]: ["already returned in full"] });
    const audits = await auditRows(ctx.pool, "action = 'dental.supplies.return' AND patient_id = $1", [patientId]);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.reason).toBe("Syringes not opened");
    expect(
      await auditRows(ctx.pool, "action = 'inventory.return' AND metadata->'sources' @> jsonb_build_array(jsonb_build_object('id', $1::text))", [procedureId]),
    ).toHaveLength(1);

    await expect(ctx.pool.query(`UPDATE dental_supply_use_line SET quantity = 9`)).rejects.toThrow();
    await expect(ctx.pool.query(`DELETE FROM dental_supply_use`)).rejects.toThrow();
  });

  it("keeps organizations apart", async () => {
    const options = (await api(otherAdmin, other.facilityId).get("/dental/supplies/options").expect(200)).body;
    expect(options.templates).toEqual([]);
    expect(options.items).toEqual([]);
    await api(otherAdmin, other.facilityId)
      .post(`/dental/procedures/${procedureId}/supplies`, { locationId: ids.cabinet, lines: [{ itemId: ids.gloves, quantity: 1 }], idempotencyKey: key() })
      .expect(404);
    await api(otherAdmin, other.facilityId).put(`/dental/procedure-types/${ids.composite1s}/supplies`, { items: [] }).expect(404);
    await api(otherAdmin, other.facilityId).put(`/dental/facilities/${tenant.facilityId}/supply-location`, { locationId: null }).expect(404);
    const otherType = (
      await api(otherAdmin, other.facilityId).post("/dental/procedure-types", { code: "extraction", name: "Extraction", site: "tooth" }).expect(201)
    ).body.id;
    const foreign = await api(otherAdmin, other.facilityId)
      .put(`/dental/procedure-types/${otherType}/supplies`, { items: [{ itemId: ids.gloves, quantity: 1 }] })
      .expect(422);
    expect(foreign.body.error.details).toEqual({ [ids.gloves]: ["unknown inventory item"] });
  });
});
