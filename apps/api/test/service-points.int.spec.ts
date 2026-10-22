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
  let auditor: string;
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
    await createStaff(ctx.pool, tenant, "auditor@sp.ph", ["auditor"]);
    auditor = (await login(ctx, "auditor@sp.ph")).accessToken;
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
    expect(er.body[0].servicePoint).toEqual({ id: points.er.id, code: "er", name: "Emergency room", kind: "emergency", location: null });
    expect(er.body[0].route).toEqual([]);
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
    await ctx
      .http()
      .put(`/api/v1/queue/visits/${visitId}/route-plan`)
      .set(at(desk))
      .send({ servicePointIds: [points.er.id], version: closed.body.version })
      .expect(422);
  });

  // ---- Visit routes (migration 0115) ------------------------------------------------------------------------

  describe("visit routes", () => {
    let labId: string;
    let routed: string;
    let routedVersion: number;
    const stepsOf = (route: Array<{ status: string; servicePointId: string; note: string | null }>) =>
      route.map((s) => [s.servicePointId === labId ? "lab" : s.servicePointId === points.xray.id ? "xray" : "er", s.status, s.note]);

    it("gives a service point a location the display will say, and lets the facility call automatically on a route", async () => {
      labId = (
        await ctx
          .http()
          .post("/api/v1/clinic/service-points")
          .set(as(admin))
          .send({ facilityId: tenant.facilityId, code: "lab", name: "Laboratory", kind: "other", location: "Laboratory, 2nd floor" })
          .expect(201)
      ).body.id;
      const xray = await ctx
        .http()
        .patch(`/api/v1/clinic/service-points/${points.xray.id}`)
        .set(as(admin))
        .send({ location: "X-ray room, ground floor", version: 2 })
        .expect(200);
      expect(xray.body).toMatchObject({ location: "X-ray room, ground floor", version: 3 });
      points.xray.version = 3;
      // Defaults: nothing is called automatically; the setting is per facility and audited.
      const defaults = await ctx.http().get("/api/v1/clinic/service-point-settings").set(as(nurse)).query({ facilityId: tenant.facilityId }).expect(200);
      expect(defaults.body).toEqual({ facilityId: tenant.facilityId, autoCallOnRoute: false, seniorsFirst: false, version: null, updatedAt: null });
      await ctx.http().put("/api/v1/clinic/service-point-settings").set(as(nurse)).send({ facilityId: tenant.facilityId, autoCallOnRoute: true }).expect(403);
      const on = await ctx
        .http()
        .put("/api/v1/clinic/service-point-settings")
        .set(as(admin))
        .send({ facilityId: tenant.facilityId, autoCallOnRoute: true })
        .expect(200);
      expect(on.body).toMatchObject({ autoCallOnRoute: true, version: 1 });
      // A stale version is a conflict.
      await ctx
        .http()
        .put("/api/v1/clinic/service-point-settings")
        .set(as(admin))
        .send({ facilityId: tenant.facilityId, autoCallOnRoute: false, version: 7 })
        .expect(409);
      expect(await auditRows(ctx.pool, "action = 'service-point-setting.update'")).toHaveLength(1);
    });

    it("plans a route of three stops at triage: the first stop current, the others planned, in one transaction", async () => {
      const patient = (
        await ctx
          .http()
          .post("/api/v1/patients")
          .set(at(desk))
          .send({ familyName: "Santos", givenName: "Ana", sex: "female", birthDate: "1980-03-02", contacts: [{ system: "mobile", value: "0917 111 2222" }] })
          .expect(201)
      ).body.id;
      const walkIn = await ctx.http().post("/api/v1/queue/walk-ins").set(at(desk)).send({ patientId: patient, visitTypeId, priority: "routine" }).expect(201);
      routed = walkIn.body.id;
      // A route needs its first stop.
      await ctx
        .http()
        .post(`/api/v1/queue/visits/${routed}/triage`)
        .set(at(nurse))
        .send({ chiefComplaint: "Fever", priority: "routine", riskFlags: [], route: [labId] })
        .expect(400);
      const triage = await ctx
        .http()
        .post(`/api/v1/queue/visits/${routed}/triage`)
        .set(at(nurse))
        .send({ chiefComplaint: "Fever and cough", priority: "routine", riskFlags: [], servicePointId: points.er.id, route: [labId, points.xray.id] })
        .expect(201);
      expect(triage.body.visit).toMatchObject({ status: "awaiting_consultation", servicePointId: points.er.id });
      routedVersion = triage.body.visit.version;
      const route = await ctx.http().get(`/api/v1/queue/visits/${routed}/route`).set(at(nurse)).expect(200);
      expect(stepsOf(route.body)).toEqual([
        ["er", "current", null],
        ["lab", "planned", null],
        ["xray", "planned", null],
      ]);
      expect(route.body[0].startedAt).toEqual(expect.any(String));
      expect(route.body[0].servicePoint).toMatchObject({ code: "er", name: "Emergency room" });
      // The queue rows carry the route, so the board can show the next stop.
      const board = await ctx.http().get("/api/v1/queue").set(at(desk)).query({ servicePointId: points.er.id }).expect(200);
      const row = board.body.find((v: { id: string }) => v.id === routed);
      expect(row.route.map((s: { status: string }) => s.status)).toEqual(["current", "planned", "planned"]);
      expect(await auditRows(ctx.pool, "action = 'visit.route-plan' AND resource_id = $1", [routed])).toHaveLength(1);
    });

    it("sends the patient on twice with a click each: the routing history, the audit and the display call follow", async () => {
      // Sending on needs clinic.queue.manage (the permission that moves and calls visits); an audience without it is refused.
      await ctx.http().post(`/api/v1/queue/visits/${routed}/route/next`).set(at(auditor)).send({ version: routedVersion }).expect(403);
      const first = await ctx
        .http()
        .post(`/api/v1/queue/visits/${routed}/route/next`)
        .set(at(desk))
        .send({ note: "Seen by the ER physician; CBC requested", version: routedVersion })
        .expect(200);
      expect(first.body.called).toBe(true);
      expect(first.body.visit).toMatchObject({ servicePointId: labId, calledTo: "Laboratory, 2nd floor", status: "awaiting_consultation" });
      expect(first.body.visit.calledAt).toEqual(expect.any(String));
      expect(stepsOf(first.body.route)).toEqual([
        ["er", "done", "Seen by the ER physician; CBC requested"],
        ["lab", "current", null],
        ["xray", "planned", null],
      ]);
      routedVersion = first.body.visit.version;
      // The waiting-room display announces the call as any other: ticket and the location, nothing else.
      const display = await ctx.http().get("/api/v1/queue/display").set(at(desk)).expect(200);
      expect(display.body.calls[0]).toEqual({ ticket: first.body.visit.ticket, calledTo: "Laboratory, 2nd floor", calledAt: first.body.visit.calledAt });
      expect(JSON.stringify(display.body)).not.toMatch(/route|servicePoint|Santos/);
      // A stale version is a conflict; then the second step.
      await ctx
        .http()
        .post(`/api/v1/queue/visits/${routed}/route/next`)
        .set(at(desk))
        .send({ version: routedVersion - 1 })
        .expect(409);
      const second = await ctx.http().post(`/api/v1/queue/visits/${routed}/route/next`).set(at(desk)).send({ version: routedVersion }).expect(200);
      expect(second.body.visit).toMatchObject({ servicePointId: points.xray.id, calledTo: "X-ray room, ground floor" });
      expect(stepsOf(second.body.route).map((s) => s[1])).toEqual(["done", "done", "current"]);
      routedVersion = second.body.visit.version;
      const history = await ctx.http().get(`/api/v1/queue/visits/${routed}/routing`).set(at(desk)).expect(200);
      expect(history.body.map((r: { from: { code: string } | null; to: { code: string } }) => [r.from?.code ?? null, r.to.code])).toEqual([
        [null, "er"],
        ["er", "lab"],
        ["lab", "xray"],
      ]);
      const calls = await auditRows(ctx.pool, "action = 'visit.call' AND resource_id = $1", [routed]);
      expect(calls).toHaveLength(2);
      expect(calls[0]!.metadata).toMatchObject({ automatic: true });
      expect(await auditRows(ctx.pool, "action = 'visit.route-advance' AND resource_id = $1", [routed])).toHaveLength(2);
      const events = await ctx.pool.query(`SELECT count(*)::int AS n FROM domain_event WHERE event_type = 'VisitRouteAdvanced' AND aggregate_id = $1`, [
        routed,
      ]);
      expect(events.rows[0]).toEqual({ n: 2 });
    });

    it("finishes the last stop without moving, says the route is complete, and plans more stops from the board", async () => {
      const last = await ctx.http().post(`/api/v1/queue/visits/${routed}/route/next`).set(at(desk)).send({ version: routedVersion }).expect(200);
      expect(last.body).toMatchObject({ called: false });
      expect(last.body.visit).toMatchObject({ servicePointId: points.xray.id, calledTo: "X-ray room, ground floor", version: routedVersion });
      expect(stepsOf(last.body.route).map((s) => s[1])).toEqual(["done", "done", "done"]);
      const complete = await ctx.http().post(`/api/v1/queue/visits/${routed}/route/next`).set(at(desk)).send({ version: routedVersion }).expect(422);
      expect(complete.body.error.code).toBe("route_complete");
      // Back to the ER, then the laboratory again: planned from the board; a stop may not repeat the one before it.
      const repeated = await ctx
        .http()
        .put(`/api/v1/queue/visits/${routed}/route-plan`)
        .set(at(desk))
        .send({ servicePointIds: [points.xray.id, labId], version: routedVersion })
        .expect(422);
      expect(repeated.body.error.code).toBe("route_step_repeated");
      const planned = await ctx
        .http()
        .put(`/api/v1/queue/visits/${routed}/route-plan`)
        .set(at(desk))
        .send({ servicePointIds: [points.er.id, labId], version: routedVersion })
        .expect(200);
      expect(stepsOf(planned.body.route)).toEqual([
        ["er", "done", "Seen by the ER physician; CBC requested"],
        ["lab", "done", null],
        ["xray", "done", null],
        ["er", "planned", null],
        ["lab", "planned", null],
      ]);
      // Re-planning replaces the planned stops only; the removed ones stay as history.
      const replanned = await ctx
        .http()
        .put(`/api/v1/queue/visits/${routed}/route-plan`)
        .set(at(desk))
        .send({ servicePointIds: [labId, points.er.id], version: routedVersion })
        .expect(200);
      expect(stepsOf(replanned.body.route).slice(3)).toEqual([
        ["lab", "planned", null],
        ["er", "planned", null],
      ]);
      const removed = await ctx.pool.query(`SELECT count(*)::int AS n FROM visit_route_step WHERE visit_id = $1 AND status = 'removed'`, [routed]);
      expect(removed.rows[0]).toEqual({ n: 2 });
      // An inactive service point cannot be planned.
      const inactive = await ctx
        .http()
        .put(`/api/v1/queue/visits/${routed}/route-plan`)
        .set(at(desk))
        .send({ servicePointIds: [points.opd.id], version: routedVersion })
        .expect(422);
      expect(inactive.body.error.code).toBe("service_point_inactive");
    });

    it("skips a step with a reason: a planned one stays put, the current one sends the patient on", async () => {
      const route = (await ctx.http().get(`/api/v1/queue/visits/${routed}/route`).set(at(desk)).expect(200)).body;
      const plannedLab = route.find((s: { status: string; servicePointId: string }) => s.status === "planned" && s.servicePointId === labId);
      await ctx.http().post(`/api/v1/queue/visits/${routed}/route/skip`).set(at(desk)).send({ stepId: plannedLab.id, version: routedVersion }).expect(400);
      const skipped = await ctx
        .http()
        .post(`/api/v1/queue/visits/${routed}/route/skip`)
        .set(at(desk))
        .send({ stepId: plannedLab.id, reason: "Sample already taken this morning", version: routedVersion })
        .expect(200);
      expect(skipped.body).toMatchObject({ called: false });
      expect(skipped.body.visit).toMatchObject({ servicePointId: points.xray.id, version: routedVersion });
      expect(stepsOf(skipped.body.route).slice(3)).toEqual([
        ["lab", "skipped", "Sample already taken this morning"],
        ["er", "planned", null],
      ]);
      // A finished step cannot be skipped again; the visit is sent on to the ER with "done here".
      const final = await ctx
        .http()
        .post(`/api/v1/queue/visits/${routed}/route/skip`)
        .set(at(desk))
        .send({ stepId: plannedLab.id, reason: "Twice", version: routedVersion })
        .expect(422);
      expect(final.body.error.code).toBe("route_step_final");
      const toEr = await ctx.http().post(`/api/v1/queue/visits/${routed}/route/next`).set(at(desk)).send({ version: routedVersion }).expect(200);
      expect(toEr.body.visit).toMatchObject({ servicePointId: points.er.id, calledTo: "Emergency room" });
      expect(toEr.body.called).toBe(true);
      routedVersion = toEr.body.visit.version;
      // Skipping the current step moves the patient to the next planned one — none here, so they stay and the route is complete.
      const current = toEr.body.route.find((s: { status: string }) => s.status === "current");
      const skipCurrent = await ctx
        .http()
        .post(`/api/v1/queue/visits/${routed}/route/skip`)
        .set(at(desk))
        .send({ stepId: current.id, reason: "ER physician off duty; back to the consultation line", version: routedVersion })
        .expect(200);
      expect(stepsOf(skipCurrent.body.route).at(-1)).toEqual(["er", "skipped", "ER physician off duty; back to the consultation line"]);
      expect(await auditRows(ctx.pool, "action = 'visit.route-skip' AND resource_id = $1", [routed])).toHaveLength(2);
      // The planning itself is never rewritten; a finished step is final.
      await expect(ctx.pool.query(`UPDATE visit_route_step SET position = 9 WHERE id = $1`, [current.id])).rejects.toThrow(/append-only/);
      await expect(ctx.pool.query(`UPDATE visit_route_step SET status = 'planned' WHERE id = $1`, [current.id])).rejects.toThrow(/append-only/);
      await expect(ctx.pool.query(`DELETE FROM visit_route_step WHERE id = $1`, [current.id])).rejects.toThrow(/append-only/);
    });

    it("sends a visit with no current step to its first planned stop, without a call when the facility turns it off", async () => {
      await ctx
        .http()
        .put("/api/v1/clinic/service-point-settings")
        .set(as(admin))
        .send({ facilityId: tenant.facilityId, autoCallOnRoute: false, version: 1 })
        .expect(200);
      const patient = (
        await ctx
          .http()
          .post("/api/v1/patients")
          .set(at(desk))
          .send({ familyName: "Cruz", givenName: "Ben", sex: "male", birthDate: "1975-11-20", contacts: [{ system: "mobile", value: "0917 333 4444" }] })
          .expect(201)
      ).body.id;
      const walkIn = await ctx.http().post("/api/v1/queue/walk-ins").set(at(desk)).send({ patientId: patient, visitTypeId, priority: "routine" }).expect(201);
      // No route yet: nothing to send on; and no planning before triage.
      await ctx
        .http()
        .put(`/api/v1/queue/visits/${walkIn.body.id}/route-plan`)
        .set(at(desk))
        .send({ servicePointIds: [labId], version: walkIn.body.version })
        .expect(422);
      const triaged = await ctx
        .http()
        .post(`/api/v1/queue/visits/${walkIn.body.id}/triage`)
        .set(at(nurse))
        .send({ chiefComplaint: "Follow-up", priority: "routine", riskFlags: [] })
        .expect(201);
      const noRoute = await ctx
        .http()
        .post(`/api/v1/queue/visits/${walkIn.body.id}/route/next`)
        .set(at(desk))
        .send({ version: triaged.body.visit.version })
        .expect(422);
      expect(noRoute.body.error.code).toBe("no_route");
      // Still on the consultation line (null), with a plan from the board: "send on" goes to the first stop, no call.
      const planned = await ctx
        .http()
        .put(`/api/v1/queue/visits/${walkIn.body.id}/route-plan`)
        .set(at(desk))
        .send({ servicePointIds: [labId, points.xray.id], version: triaged.body.visit.version })
        .expect(200);
      expect(planned.body.route.map((s: { status: string }) => s.status)).toEqual(["planned", "planned"]);
      const sent = await ctx
        .http()
        .post(`/api/v1/queue/visits/${walkIn.body.id}/route/next`)
        .set(at(desk))
        .send({ version: triaged.body.visit.version })
        .expect(200);
      expect(sent.body).toMatchObject({ called: false });
      expect(sent.body.visit).toMatchObject({ servicePointId: labId, calledTo: null });
      expect(sent.body.route.map((s: { status: string }) => s.status)).toEqual(["current", "planned"]);
    });
  });
});
