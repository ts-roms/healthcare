import type { AddressInfo } from "node:net";
import { io, type Socket } from "socket.io-client";
import { as, createStaff, createTenant, createTestApp, drainEvents, juan, login, type Tenant, type TestContext } from "./harness";

describe("realtime queue updates", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let desk: string;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0, "127.0.0.1");
    url = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as AddressInfo).port}/realtime`;
    tenant = await createTenant(ctx.pool, "realtime-org");
    await createStaff(ctx.pool, tenant, "admin@example.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@example.ph", [{ role: "receptionist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "auditor@example.ph", ["auditor"]);
    desk = (await login(ctx, "desk@example.ph")).accessToken;
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    await ctx.close();
  });

  function connect(auth: Record<string, unknown>): Socket {
    const socket = io(url, { auth, transports: ["websocket"], reconnection: false });
    sockets.push(socket);
    return socket;
  }

  function next<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 5_000);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  it("pushes queue changes to subscribers of the facility, without patient details", async () => {
    const socket = connect({ token: desk, facilityId: tenant.facilityId });
    await expect(next(socket, "ready")).resolves.toEqual({ facilityId: tenant.facilityId });

    const admin = (await login(ctx, "admin@example.ph")).accessToken;
    const visitType = await ctx
      .http()
      .post("/api/v1/clinic/visit-types")
      .set(as(admin))
      .send({ code: "consult", name: "Consultation", defaultDurationMinutes: 15 })
      .expect(201);
    const patient = await ctx.http().post("/api/v1/patients").set(as(desk, tenant.facilityId)).send(juan).expect(201);
    const update = next<Record<string, unknown>>(socket, "queue.updated");
    const visit = await ctx
      .http()
      .post("/api/v1/queue/walk-ins")
      .set(as(desk, tenant.facilityId))
      .send({ patientId: patient.body.id, visitTypeId: visitType.body.id })
      .expect(201);
    await drainEvents(ctx);

    const message = await update;
    expect(message).toMatchObject({ visitId: visit.body.id, status: "waiting", queueNumber: 1 });
    expect(JSON.stringify(message)).not.toMatch(/Dela Cruz|Juan/);
  });

  it("rejects connections without a valid token or without queue access at that facility", async () => {
    const anonymous = connect({ token: "not-a-token", facilityId: tenant.facilityId });
    await expect(next(anonymous, "unauthorized")).resolves.toMatchObject({ message: expect.any(String) });

    const auditor = connect({ token: (await login(ctx, "auditor@example.ph")).accessToken, facilityId: tenant.facilityId });
    await expect(next(auditor, "unauthorized")).resolves.toMatchObject({ message: "Not permitted" });

    // Facility-scoped receptionist: allowed at the main facility only.
    const elsewhere = connect({ token: desk, facilityId: tenant.otherFacilityId });
    await expect(next(elsewhere, "unauthorized")).resolves.toBeDefined();
  });
});
