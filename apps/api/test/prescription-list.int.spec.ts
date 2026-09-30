import { as, auditRows, createClinician, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * The facility's prescription list (staff /clinic/prescriptions; docs/domains/prescription.md): prescriptions issued at
 * the selected facility over a period of its calendar days, by status or only the signed-in practitioner's, with patient
 * and prescriber names; every patient listed is audited.
 */
describe("prescriptions issued at a facility", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let santos: string;
  let reyes: string;
  let cashier: string;
  const ids: Record<string, string> = {};

  const req = (token: string, facilityId = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });
  const item = (genericName: string, quantity = 10) => ({
    genericName,
    strength: "500 mg",
    dosageForm: "capsule",
    route: "oral",
    frequency: "three_times_daily",
    quantity,
    quantityUnit: "capsules",
    instructions: "As directed",
  });
  const issued = (token: string, query = "") => req(token).get(`/prescriptions/issued${query}`);

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "rx-list-org");
    await createStaff(ctx.pool, tenant, "admin@rxlist.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "santos@rxlist.ph", ["physician"]);
    await createClinician(ctx, tenant, "reyes@rxlist.ph", ["physician"]);
    await createStaff(ctx.pool, tenant, "cashier@rxlist.ph", ["cashier"]);
    [admin, santos, reyes, cashier] = await Promise.all(
      ["admin", "santos", "reyes", "cashier"].map(async (u) => (await login(ctx, `${u}@rxlist.ph`)).accessToken),
    );
    const visitTypeId = (
      await req(admin).post("/clinic/visit-types", { code: "consult", name: "Consultation", defaultDurationMinutes: 15, requiresTriage: false }).expect(201)
    ).body.id;
    ids.patient = (await req(admin).post("/patients", juan).expect(201)).body.id;
    ids.maria = (
      await req(admin)
        .post("/patients", {
          ...juan,
          familyName: "Reyes",
          givenName: "Maria",
          middleName: undefined,
          birthDate: "1991-07-09",
          contacts: [{ system: "mobile", value: "0918 765 4321" }],
          identifiers: [],
        })
        .expect(201)
    ).body.id;
    const encounter = async (token: string, patientId: string) => {
      const visit = await req(admin).post("/queue/walk-ins", { patientId, visitTypeId }).expect(201);
      return (await req(token).post("/encounters", { visitId: visit.body.id }).expect(201)).body.id as string;
    };
    // Santos prescribes, then corrects it (the first becomes superseded); Reyes prescribes and cancels.
    const santosEncounter = await encounter(santos, ids.patient);
    ids.first = (
      await req(santos)
        .post("/prescriptions", { encounterId: santosEncounter, items: [item("Amoxicillin")] })
        .expect(201)
    ).body.id;
    ids.replacement = (
      await req(santos)
        .post(`/prescriptions/${ids.first}/replace`, { items: [item("Amoxicillin", 21)], reason: "Wrong quantity" })
        .expect(201)
    ).body.id;
    const reyesEncounter = await encounter(reyes, ids.maria);
    ids.cancelled = (
      await req(reyes)
        .post("/prescriptions", { encounterId: reyesEncounter, items: [item("Cetirizine"), item("Paracetamol")] })
        .expect(201)
    ).body.id;
    await req(reyes).post(`/prescriptions/${ids.cancelled}/cancel`, { reason: "Patient already has some" }).expect(200);
    // One issued ten days ago (moved in the database: prescriptions are issued now).
    ids.old = (
      await req(reyes)
        .post("/prescriptions", { encounterId: reyesEncounter, items: [item("Losartan")] })
        .expect(201)
    ).body.id;
    await ctx.pool.query("ALTER TABLE prescription DISABLE TRIGGER USER");
    await ctx.pool.query("UPDATE prescription SET issued_at = issued_at - interval '10 days' WHERE id = $1", [ids.old]);
    await ctx.pool.query("ALTER TABLE prescription ENABLE TRIGGER USER");
  });
  afterAll(() => ctx.close());

  it("lists today's prescriptions at the facility, newest first, with patient, prescriber and what was prescribed", async () => {
    const res = await issued(santos).expect(200);
    expect(res.body).toMatchObject({ facilityId: tenant.facilityId, counts: { active: 1, cancelled: 1, superseded: 1 }, truncated: false });
    expect(res.body.from).toBe(res.body.to);
    expect(res.body.rows.map((r: { id: string }) => r.id)).toEqual([ids.cancelled, ids.replacement, ids.first]);
    const cancelled = res.body.rows[0];
    expect(cancelled).toMatchObject({
      status: "cancelled",
      prescriptionNumber: expect.stringMatching(/^RX\d{8}$/),
      patient: { displayName: expect.stringMatching(/REYES, Maria/) },
      prescriber: { displayName: expect.any(String) },
      cancellationReason: "Patient already has some",
      items: [
        { genericName: "Cetirizine", strength: "500 mg", dosageForm: "capsule", quantity: 10, quantityUnit: "capsules" },
        { genericName: "Paracetamol", strength: "500 mg", dosageForm: "capsule", quantity: 10, quantityUnit: "capsules" },
      ],
    });
    expect(res.body.rows[1]).toMatchObject({ status: "active", replacesPrescriptionId: ids.first });
    // Only what a list needs: no dose instructions, allergy override or notes.
    expect(Object.keys(res.body.rows[1].items[0]).sort()).toEqual(["dosageForm", "genericName", "quantity", "quantityUnit", "strength"]);
    expect(res.body.rows[1]).not.toHaveProperty("allergyOverrideReason");
  });

  it("filters by status and to the signed-in practitioner, counting the whole period", async () => {
    const active = (await issued(santos, "?status=active").expect(200)).body;
    expect(active.rows.map((r: { id: string }) => r.id)).toEqual([ids.replacement]);
    expect(active.counts).toEqual({ active: 1, cancelled: 1, superseded: 1 });
    const mine = (await issued(santos, "?mine=true").expect(200)).body;
    expect(mine.rows.map((r: { id: string }) => r.id)).toEqual([ids.replacement, ids.first]);
    expect(mine.counts).toEqual({ active: 1, cancelled: 0, superseded: 1 });
    expect((await issued(admin, "?mine=true").expect(422)).body.error.code).toBe("not_a_practitioner");
  });

  it("covers a period of the facility's days, at most 92, and only the selected facility", async () => {
    const week = (await issued(reyes, `?from=${day(-14)}&to=${day(0)}`).expect(200)).body;
    expect(week.rows.map((r: { id: string }) => r.id)).toContain(ids.old);
    expect(week.rows).toHaveLength(4);
    const past = (await issued(reyes, `?from=${day(-10)}&to=${day(-10)}`).expect(200)).body;
    expect(past.rows.map((r: { id: string }) => r.id)).toEqual([ids.old]);
    expect((await issued(reyes, `?from=${day(-100)}&to=${day(0)}`).expect(400)).body.error.code).toBe("range_too_long");
    expect((await issued(reyes, `?from=${day(0)}&to=${day(-1)}`).expect(400)).body.error.code).toBe("invalid_range");
    await issued(reyes, "?from=yesterday").expect(400);
    const annex = (await req(reyes, tenant.otherFacilityId).get("/prescriptions/issued").expect(200)).body;
    expect(annex.rows).toEqual([]);
  });

  it("needs prescription.read and a facility, and audits each patient listed", async () => {
    await issued(cashier).expect(403);
    await ctx
      .http()
      .get("/api/v1/prescriptions/issued")
      .set({ Authorization: `Bearer ${santos}` })
      .expect(400);
    const before = (await auditRows(ctx.pool, `action = 'prescription.list' AND patient_id = $1`, [ids.patient])).length;
    await issued(santos).expect(200);
    const after = await auditRows(ctx.pool, `action = 'prescription.list' AND patient_id = $1`, [ids.patient]);
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)!.metadata).toEqual({ view: "facility" });
    // The per-patient list still needs a patient or an encounter.
    await req(santos).get("/prescriptions").expect(400);
  });
});

/** A Manila calendar day relative to today. */
function day(offset: number): string {
  return new Date(Date.now() + 8 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
}
