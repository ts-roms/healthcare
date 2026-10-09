import type { AddressInfo } from "node:net";
import { io, type Socket } from "socket.io-client";
import { as, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

/**
 * The waiting-room display (migration 0112, docs/domains/clinic.md "Waiting-room display"): a screen signed in with a
 * display account shows the tickets called today and where to go, and how many wait — never a patient detail.
 */
describe("waiting-room display", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let desk: string;
  let screen: string;
  const visits: Array<{ id: string; version: number; ticket: string }> = [];
  const sockets: Socket[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0, "127.0.0.1");
    tenant = await createTenant(ctx.pool, "display-org");
    await createStaff(ctx.pool, tenant, "admin@display.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@display.ph", [{ role: "receptionist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "screen@display.ph", [{ role: "queue_display", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "auditor@display.ph", ["auditor"]);
    const admin = (await login(ctx, "admin@display.ph")).accessToken;
    desk = (await login(ctx, "desk@display.ph")).accessToken;
    screen = (await login(ctx, "screen@display.ph")).accessToken;

    const visitType = await ctx
      .http()
      .post("/api/v1/clinic/visit-types")
      .set(as(admin))
      .send({ code: "consult", name: "Consultation", defaultDurationMinutes: 15 })
      .expect(201);
    const people = [
      { ...juan, identifiers: [], contacts: [] },
      { ...juan, givenName: "Pedro", birthDate: "1975-05-06", identifiers: [], contacts: [] },
      { ...juan, givenName: "Maria", sex: "female", birthDate: "1990-01-02", identifiers: [], contacts: [] },
    ];
    for (const person of people) {
      const patient = await ctx.http().post("/api/v1/patients").set(as(desk, tenant.facilityId)).send(person).expect(201);
      const visit = await ctx
        .http()
        .post("/api/v1/queue/walk-ins")
        .set(as(desk, tenant.facilityId))
        .send({ patientId: patient.body.id, visitTypeId: visitType.body.id })
        .expect(201);
      visits.push(visit.body);
    }
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    await ctx.close();
  });

  const display = (token: string, facilityId = tenant.facilityId) => ctx.http().get("/api/v1/queue/display").set(as(token, facilityId));
  const call = async (index: number, calledTo: string) => {
    const response = await ctx
      .http()
      .post(`/api/v1/queue/visits/${visits[index]!.id}/call`)
      .set(as(desk, tenant.facilityId))
      .send({ calledTo, version: visits[index]!.version })
      .expect(200);
    visits[index] = response.body;
  };

  it("shows the tickets called, newest first, with where to go, and how many wait — and nothing about the patients", async () => {
    expect((await display(screen).expect(200)).body).toMatchObject({ facilityName: expect.any(String), calls: [], waiting: 3 });

    await call(0, "Triage 1");
    await call(2, "Room 2");
    const body = (await display(screen).expect(200)).body;
    expect(Object.keys(body).sort()).toEqual(["calls", "date", "facilityName", "timeZone", "waiting"]);
    expect(body.calls).toEqual([
      { ticket: visits[2]!.ticket, calledTo: "Room 2", calledAt: expect.any(String) },
      { ticket: visits[0]!.ticket, calledTo: "Triage 1", calledAt: expect.any(String) },
    ]);
    expect(body.waiting).toBe(3);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/Dela Cruz|Juan|Pedro|Maria|priority|patient/i);
    for (const v of visits) expect(text).not.toContain(v.id);
  });

  it("closed visits leave the display", async () => {
    await ctx
      .http()
      .post(`/api/v1/queue/visits/${visits[2]!.id}/move`)
      .set(as(desk, tenant.facilityId))
      .send({ status: "left_without_being_seen", reason: "Left before being seen", version: visits[2]!.version })
      .expect(200);
    const body = (await display(screen).expect(200)).body;
    expect(body.calls.map((c: { ticket: string }) => c.ticket)).toEqual([visits[0]!.ticket]);
    expect(body.waiting).toBe(2);
  });

  it("is open to reception, and reading it is not audited (it holds no patient detail)", async () => {
    const before = (await ctx.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_event WHERE action = 'queue.view'")).rows[0]!.n;
    await display(desk).expect(200);
    await display(screen).expect(200);
    const after = (await ctx.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_event WHERE action = 'queue.view'")).rows[0]!.n;
    expect(after).toBe(before);
  });

  it("gives the display account nothing else, and refuses others and other facilities", async () => {
    await ctx.http().get("/api/v1/queue").set(as(screen, tenant.facilityId)).expect(403);
    await ctx.http().get(`/api/v1/queue/visits/${visits[0]!.id}`).set(as(screen, tenant.facilityId)).expect(403);
    await ctx.http().get("/api/v1/patients?q=Dela").set(as(screen, tenant.facilityId)).expect(403);
    await display((await login(ctx, "auditor@display.ph")).accessToken).expect(403);
    await display(screen, tenant.otherFacilityId).expect((r) => expect(r.status).toBe(403));
  });

  it("joins the facility's live queue updates", async () => {
    const url = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as AddressInfo).port}/realtime`;
    const socket = io(url, { auth: { token: screen, facilityId: tenant.facilityId }, transports: ["websocket"], reconnection: false });
    sockets.push(socket);
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for ready")), 5_000);
      socket.once("ready", (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      socket.once("unauthorized", (payload) => {
        clearTimeout(timer);
        reject(new Error(JSON.stringify(payload)));
      });
    });
    expect(ready).toEqual({ facilityId: tenant.facilityId, channels: ["queue"] });
  });
});
