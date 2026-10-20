import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * Service points (docs/domains/clinic.md, "Service points"; migration 0113, ADR-0014): the organization defines its
 * own queue lines per facility; a nurse sends a triaged patient to one; the board shows one service point's queue;
 * every move is kept in an append-only routing history; the waiting-room display never shows it.
 */
describe("service points", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let desk: string;
  let nurse: string;
  let visitTypeId: string;
  let patientId: string;
  let visitId: string;
  let version: number;
  const points: Record<"opd" | "er" | "xray", { id: string; version: number }> = {
    opd: { id: "", version: 0 },
    er: { id: "", version: 0 },
    xray: { id: "", version: 0 },
  };
  let annexPointId: string;

  const at = (token: string, facilityId = tenant.facilityId) => as(token, facilityId);

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "service-points-org");
    await createStaff(ctx.pool, tenant, "admin@sp.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@sp.ph", [{ role: "receptionist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "nurse@sp.ph", ["nurse"]);
    admin = (await login(ctx, "admin@sp.ph")).accessToken;
    desk = (await login(ctx, "desk@sp.ph")).accessToken;
    nurse = (await login(ctx, "nurse@sp.ph")).accessToken;
    visitTypeId = (
      await ctx.http().post("/api/v1/clinic/visit-types").set(as(admin)).send({ code: "consult", name: "Consultation", defaultDurationMinutes: 15 }).expect(201)
    ).body.id;
    patientId = (await ctx.http().post("/api/v1/patients").set(at(desk)).send(juan).expect(201)).body.id;
  });

  afterAll(() => ctx.close());

  it("lets the organization define its own service points per facility (clinic.configure), codes unique per facility", async () => {
    for (const [key, name, kind] of [
      ["opd", "Consultation", "consultation"],
      ["er", "Emergency room", "emergency"],
      ["xray", "X-ray", "imaging"],
    ] as const) {
      const created = await ctx
        .http()
        .post("/api/v1/clinic/service-points")
        .set(as(admin))
        .send({ facilityId: tenant.facilityId, code: key, name, kind })
        .expect(201);
      expect(created.body).toMatchObject({ facilityId: tenant.facilityId, code: key, name, kind, status: "active", version: 1 });
      expect(created.body.organizationId).toBeUndefined();
      points[key] = { id: created.body.id, version: created.body.version };
    }
    // The same code at another facility is fine; at the same facility it is a conflict.
    annexPointId = (
      await ctx
        .http()
        .post("/api/v1/clinic/service-points")
        .set(as(admin))
        .send({ facilityId: tenant.otherFacilityId, code: "er", name: "Annex ER", kind: "emergency" })
        .expect(201)
    ).body.id;
    const duplicate = await ctx
      .http()
      .post("/api/v1/clinic/service-points")
      .set(as(admin))
      .send({ facilityId: tenant.facilityId, code: "er", name: "Another ER", kind: "emergency" })
      .expect(409);
    expect(duplicate.body.error.code).toBe("service_point_exists");
    // Nurses read the list (they choose from it at triage) but cannot change it.
    await ctx
      .http()
      .post("/api/v1/clinic/service-points")
      .set(as(nurse))
      .send({ facilityId: tenant.facilityId, code: "lab", name: "Laboratory", kind: "other" })
      .expect(403);
    const list = await ctx.http().get("/api/v1/clinic/service-points").set(as(nurse)).query({ facilityId: tenant.facilityId }).expect(200);
    // Kind order: consultation, emergency, imaging, other.
    expect(list.body.map((s: { code: string }) => s.code)).toEqual(["opd", "er", "xray"]);
    const audits = await auditRows(ctx.pool, "action = 'service-point.create'");
    expect(audits).toHaveLength(4);
  });

  it("queues a walk-in on the facility's own line and refuses to route it before triage", async () => {
    const walkIn = await ctx
      .http()
      .post("/api/v1/queue/walk-ins")
      .set(at(desk))
      .send({ patientId, visitTypeId, priority: "routine", chiefComplaint: "Chest pain" })
      .expect(201);
    visitId = walkIn.body.id;
    version = walkIn.body.version;
    expect(walkIn.body).toMatchObject({ status: "waiting", servicePointId: null });
    const refused = await ctx.http().post(`/api/v1/queue/visits/${visitId}/route`).set(at(desk)).send({ servicePointId: points.er.id, version }).expect(422);
    expect(refused.body.error.code).toBe("visit_not_routable");
  });

  it("routes the patient to the emergency room as part of triage, in one transaction", async () => {
    const triage = await ctx
      .http()
      .post(`/api/v1/queue/visits/${visitId}/triage`)
      .set(at(nurse))
      .send({
        chiefComplaint: "Chest pain radiating to the left arm",
        priority: "emergency",
        riskFlags: ["cardiac"],
        vitals: { systolicMmhg: 150, diastolicMmhg: 95, heartRateBpm: 110 },
        servicePointId: points.er.id,
      })
      .expect(201);
    expect(triage.body.visit).toMatchObject({ status: "awaiting_consultation", priority: "emergency", servicePointId: points.er.id });
    version = triage.body.visit.version;
    const routing = await ctx.pool.query(`SELECT from_service_point_id, to_service_point_id, reason FROM visit_routing WHERE visit_id = $1`, [visitId]);
    expect(routing.rows).toEqual([{ from_service_point_id: null, to_service_point_id: points.er.id, reason: null }]);
    const audits = await auditRows(ctx.pool, "action = 'visit.route' AND patient_id = $1", [patientId]);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ toCode: "er" });
    // Triaging again with the same service point records nothing new.
    const again = await ctx
      .http()
      .post(`/api/v1/queue/visits/${visitId}/triage`)
      .set(at(nurse))
      .send({ chiefComplaint: "Chest pain", priority: "emergency", riskFlags: [], servicePointId: points.er.id })
      .expect(201);
    version = again.body.visit.version;
    expect((await ctx.pool.query(`SELECT count(*)::int AS n FROM visit_routing WHERE visit_id = $1`, [visitId])).rows[0]).toEqual({ n: 1 });
  });

  it("shows one service point's queue on the board, in service order, and the whole facility without a filter", async () => {
    const other = (
      await ctx
        .http()
        .post("/api/v1/patients")
        .set(at(desk))
        .send({ familyName: "Reyes", givenName: "Maria", sex: "female", birthDate: "1992-07-15", contacts: [{ system: "mobile", value: "0918 765 4321" }] })
        .expect(201)
    ).body.id;
    const routine = await ctx.http().post("/api/v1/queue/walk-ins").set(at(desk)).send({ patientId: other, visitTypeId, priority: "routine" }).expect(201);
    await ctx
      .http()
      .post(`/api/v1/queue/visits/${routine.body.id}/triage`)
      .set(at(nurse))
      .send({ chiefComplaint: "Cough", priority: "routine", riskFlags: [], servicePointId: points.er.id })
      .expect(201);

    const er = await ctx.http().get("/api/v1/queue").set(at(desk)).query({ servicePointId: points.er.id }).expect(200);
    expect(er.body.map((v: { id: string; priority: string }) => [v.id, v.priority])).toEqual([
      [visitId, "emergency"],
      [routine.body.id, "routine"],
    ]);
    expect(er.body[0].servicePoint).toEqual({ id: points.er.id, code: "er", name: "Emergency room", kind: "emergency" });
    const opd = await ctx.http().get("/api/v1/queue").set(at(desk)).query({ servicePointId: points.opd.id }).expect(200);
    expect(opd.body).toEqual([]);
    const all = await ctx.http().get("/api/v1/queue").set(at(desk)).expect(200);
    expect(all.body).toHaveLength(2);
    const views = await auditRows(ctx.pool, "action = 'queue.view'");
    expect(views.at(-3)?.metadata).toMatchObject({ servicePointId: points.er.id, count: 2 });
  });

  it("moves the patient on from the queue board with a reason, keeping the history", async () => {
    const moved = await ctx
      .http()
      .post(`/api/v1/queue/visits/${visitId}/route`)
      .set(at(desk))
      .send({ servicePointId: points.xray.id, reason: "Chest X-ray requested by the ER physician", version })
      .expect(200);
    expect(moved.body).toMatchObject({ servicePointId: points.xray.id, status: "awaiting_consultation", version: version + 1 });
    version = moved.body.version;
    // A stale version is a conflict; the same target is refused; another facility's service point is not found.
    await ctx
      .http()
      .post(`/api/v1/queue/visits/${visitId}/route`)
      .set(at(desk))
      .send({ servicePointId: points.er.id, version: version - 1 })
      .expect(409);
    const same = await ctx.http().post(`/api/v1/queue/visits/${visitId}/route`).set(at(desk)).send({ servicePointId: points.xray.id, version }).expect(422);
    expect(same.body.error.code).toBe("already_at_service_point");
    await ctx.http().post(`/api/v1/queue/visits/${visitId}/route`).set(at(desk)).send({ servicePointId: annexPointId, version }).expect(404);

    const history = await ctx.http().get(`/api/v1/queue/visits/${visitId}/routing`).set(at(nurse)).expect(200);
    expect(
      history.body.map((r: { from: { code: string } | null; to: { code: string }; reason: string | null }) => [r.from?.code ?? null, r.to.code, r.reason]),
    ).toEqual([
      [null, "er", null],
      ["er", "xray", "Chest X-ray requested by the ER physician"],
    ]);
    // The history is append-only.
    await expect(ctx.pool.query(`UPDATE visit_routing SET reason = 'x' WHERE visit_id = $1`, [visitId])).rejects.toThrow(/append-only/);
    const events = await ctx.pool.query(`SELECT payload FROM domain_event WHERE event_type = 'VisitRouted' AND aggregate_id = $1 ORDER BY occurred_at`, [
      visitId,
    ]);
    expect(events.rows.map((r) => r.payload)).toEqual([
      expect.objectContaining({ fromServicePointId: null, toServicePointId: points.er.id }),
      expect.objectContaining({ fromServicePointId: points.er.id, toServicePointId: points.xray.id }),
    ]);
  });

  it("refuses an inactive service point for new routing but keeps the visits already there", async () => {
    const deactivated = await ctx
      .http()
      .patch(`/api/v1/clinic/service-points/${points.opd.id}`)
      .set(as(admin))
      .send({ status: "inactive", version: points.opd.version })
      .expect(200);
    expect(deactivated.body.status).toBe("inactive");
    const refused = await ctx.http().post(`/api/v1/queue/visits/${visitId}/route`).set(at(desk)).send({ servicePointId: points.opd.id, version }).expect(422);
    expect(refused.body.error.code).toBe("service_point_inactive");
    // Active-only by default; includeInactive lists it for the settings screen.
    const active = await ctx.http().get("/api/v1/clinic/service-points").set(as(admin)).query({ facilityId: tenant.facilityId }).expect(200);
    expect(active.body.map((s: { code: string }) => s.code)).toEqual(["er", "xray"]);
    const everything = await ctx
      .http()
      .get("/api/v1/clinic/service-points")
      .set(as(admin))
      .query({ facilityId: tenant.facilityId, includeInactive: "true" })
      .expect(200);
    expect(everything.body).toHaveLength(3);
    // Renaming is audited with before and after; the code never changes.
    const renamed = await ctx
      .http()
      .patch(`/api/v1/clinic/service-points/${points.xray.id}`)
      .set(as(admin))
      .send({ name: "Radiology", version: points.xray.version })
      .expect(200);
    expect(renamed.body).toMatchObject({ code: "xray", name: "Radiology", version: 2 });
    const stillThere = await ctx.http().get(`/api/v1/queue/visits/${visitId}`).set(at(desk)).expect(200);
    expect(stillThere.body.servicePointId).toBe(points.xray.id);
  });

  it("keeps the waiting-room display to the ticket and the place called", async () => {
    const called = await ctx.http().post(`/api/v1/queue/visits/${visitId}/call`).set(at(desk)).send({ calledTo: "Radiology 1", version }).expect(200);
    version = called.body.version;
    const display = await ctx.http().get("/api/v1/queue/display").set(at(desk)).expect(200);
    expect(display.body.calls[0]).toEqual({ ticket: called.body.ticket, calledTo: "Radiology 1", calledAt: expect.any(String) });
    expect(JSON.stringify(display.body)).not.toMatch(/servicePoint|xray|Radiology"|emergency/);
  });

  it("cannot route a closed visit", async () => {
    const closed = await ctx
      .http()
      .post(`/api/v1/queue/visits/${visitId}/move`)
      .set(at(desk))
      .send({ status: "left_without_being_seen", reason: "Went home before the X-ray", version })
      .expect(200);
    const refused = await ctx
      .http()
      .post(`/api/v1/queue/visits/${visitId}/route`)
      .set(at(desk))
      .send({ servicePointId: points.er.id, version: closed.body.version })
      .expect(422);
    expect(refused.body.error.code).toBe("visit_not_routable");
  });
});
