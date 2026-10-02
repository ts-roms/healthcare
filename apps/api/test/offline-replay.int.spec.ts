import { as, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * Offline capture and replay (ADR-0013): the staff app replays actions captured without a connection through the
 * same routes as live work, each with its own Idempotency-Key, in capture order (registration → walk-in → triage).
 * The API validates every replay as if typed live, and a repeat of a replay returns the stored answer, never a
 * second record.
 */
describe("offline replay through idempotency keys", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let desk: string;
  let visitTypeId: string;

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object, key?: string) =>
      ctx
        .http()
        .post(`/api/v1${url}`)
        .set({ ...as(token, tenant.facilityId), ...(key ? { "idempotency-key": key } : {}) })
        .send(body),
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "offline-org");
    await createStaff(ctx.pool, tenant, "admin@offline.ph", ["org_admin"]);
    desk = (await login(ctx, "admin@offline.ph")).accessToken;
    visitTypeId = (
      await api(desk).post("/clinic/visit-types", { code: "CONS", name: "Consultation", defaultDurationMinutes: 15, requiresTriage: true }).expect(201)
    ).body.id;
  });
  afterAll(() => ctx.close());

  it("replays a captured registration, walk-in and triage once each, and answers a repeated replay from the stored response", async () => {
    const keys = { register: "offline:reg:11111111", walkIn: "offline:walk:22222222", triage: "offline:triage:33333333" };
    const first = await api(desk)
      .post("/patients", { ...juan, identifiers: [] }, keys.register)
      .expect(201);
    const again = await api(desk)
      .post("/patients", { ...juan, identifiers: [] }, keys.register)
      .expect(201);
    expect(again.body).toEqual(first.body);
    const patients = await ctx.pool.query("SELECT count(*)::int AS n FROM patient WHERE organization_id = $1", [tenant.organizationId]);
    expect(patients.rows[0]).toEqual({ n: 1 });
    // The same key with a different body is refused: a replay never silently sends something else.
    await api(desk)
      .post("/patients", { ...juan, identifiers: [], givenName: "Pedro" }, keys.register)
      .expect(422);

    const walkIn = await api(desk)
      .post("/queue/walk-ins", { patientId: first.body.id, visitTypeId, priority: "routine", chiefComplaint: "Fever" }, keys.walkIn)
      .expect(201);
    const walkInAgain = await api(desk)
      .post("/queue/walk-ins", { patientId: first.body.id, visitTypeId, priority: "routine", chiefComplaint: "Fever" }, keys.walkIn)
      .expect(201);
    expect(walkInAgain.body.ticket).toBe(walkIn.body.ticket);
    const visits = await ctx.pool.query("SELECT count(*)::int AS n FROM visit WHERE patient_id = $1", [first.body.id]);
    expect(visits.rows[0]).toEqual({ n: 1 });

    const triageBody = { chiefComplaint: "Fever", priority: "routine", riskFlags: [], vitals: { temperatureC: 38.4, heartRateBpm: 96 }, completeTriage: true };
    const triage = await api(desk).post(`/queue/visits/${walkIn.body.id}/triage`, triageBody, keys.triage).expect(201);
    expect(triage.body.visit.status).toBe("awaiting_consultation");
    const triageAgain = await api(desk).post(`/queue/visits/${walkIn.body.id}/triage`, triageBody, keys.triage).expect(201);
    expect(triageAgain.body).toEqual(triage.body);
    const vitals = await ctx.pool.query("SELECT count(*)::int AS n FROM vital_sign_set WHERE patient_id = $1", [first.body.id]);
    expect(vitals.rows[0]).toEqual({ n: 1 });
  });

  it("refuses a replay the live screen would refuse: a duplicate registration is parked for review, not merged", async () => {
    const refused = await api(desk)
      .post("/patients", { ...juan, identifiers: [] }, "offline:reg:44444444")
      .expect(409);
    expect(refused.body.error.code).toBe("possible_duplicates");
    expect(refused.body.error.details.candidates).toHaveLength(1);
  });
});
