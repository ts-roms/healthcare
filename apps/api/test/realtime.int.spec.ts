import type { AddressInfo } from "node:net";
import { io, type Socket } from "socket.io-client";
import { randomBytes, randomUUID } from "node:crypto";
import {
  as,
  createClinician,
  createStaff,
  createTenant,
  createTestApp,
  drainEvents,
  juan,
  login,
  type Tenant,
  TEST_REDIS_URL,
  type TestContext,
} from "./harness";

describe("realtime queue and laboratory updates", () => {
  let ctx: TestContext;
  let second: TestContext;
  let tenant: Tenant;
  let desk: string;
  let url: string;
  let secondUrl: string;
  const sockets: Socket[] = [];
  const realtime = { redisUrl: TEST_REDIS_URL, keyPrefix: `realtime-test-${randomBytes(4).toString("hex")}` };
  const realtimeUrl = (app: TestContext) => `http://127.0.0.1:${(app.app.getHttpServer().address() as AddressInfo).port}/realtime`;

  beforeAll(async () => {
    // Two instances over one database and one Redis, as two replicas would be (each createTestApp resets the schema,
    // so the data is set up once both exist).
    // One signing secret for both, as replicas share it: a token issued by one is accepted by the other.
    const shared = { JWT_ACCESS_SECRET: randomBytes(32).toString("hex") };
    ctx = await createTestApp({ realtime }, shared);
    second = await createTestApp({ realtime }, shared);
    await ctx.app.listen(0, "127.0.0.1");
    await second.app.listen(0, "127.0.0.1");
    url = realtimeUrl(ctx);
    secondUrl = realtimeUrl(second);
    tenant = await createTenant(ctx.pool, "realtime-org");
    await createStaff(ctx.pool, tenant, "admin@example.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "desk@example.ph", [{ role: "receptionist", facilityId: tenant.facilityId }]);
    await createStaff(ctx.pool, tenant, "auditor@example.ph", ["auditor"]);
    desk = (await login(ctx, "desk@example.ph")).accessToken;
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    await second.close();
    await ctx.close();
  });

  function connect(auth: Record<string, unknown>, at = url): Socket {
    const socket = io(at, { auth, transports: ["websocket"], reconnection: false });
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
    await expect(next(socket, "ready")).resolves.toEqual({ facilityId: tenant.facilityId, channels: ["queue", "messages", "notices"] });

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

  it("pushes a new conversation message to staff who read conversations: ids and the sender, never the text", async () => {
    const socket = connect({ token: desk, facilityId: tenant.facilityId });
    await expect(next(socket, "ready")).resolves.toMatchObject({ channels: expect.arrayContaining(["messages"]) });
    const threadId = randomUUID();
    const update = next<Record<string, unknown>>(socket, "messages.updated");
    // The event the messaging service records when a message is sent (ids and who sent it); anything else in a
    // payload is never forwarded.
    await ctx.pool.query(
      `INSERT INTO domain_event (organization_id, facility_id, event_type, aggregate_type, aggregate_id, payload)
       VALUES ($1, $2, 'PatientMessageSent', 'patient_message_thread', $3, $4)`,
      [
        tenant.organizationId,
        tenant.facilityId,
        threadId,
        JSON.stringify({ threadId, messageId: randomUUID(), sender: "patient", body: "A private sentence." }),
      ],
    );
    await drainEvents(ctx);

    const message = await update;
    expect(message).toMatchObject({ threadId, sender: "patient" });
    expect(JSON.stringify(message)).not.toMatch(/private sentence/);
  });

  it("tells a staff member, and only that member, that they have a new notice: no ids of anything else", async () => {
    const deskSocket = connect({ token: desk, facilityId: tenant.facilityId });
    await next(deskSocket, "ready");
    const auditorToken = (await login(ctx, "auditor@example.ph")).accessToken;
    const other = connect({ token: auditorToken, facilityId: tenant.facilityId });
    await next(other, "ready");
    const heard: unknown[] = [];
    other.on("notices.updated", (message) => heard.push(message));

    const { rows } = await ctx.pool.query<{ id: string }>("SELECT id FROM app_user WHERE email = 'desk@example.ph'");
    const update = next<Record<string, unknown>>(deskSocket, "notices.updated");
    // The event the notification service records with a staff in-app notice.
    await ctx.pool.query(
      `INSERT INTO domain_event (organization_id, facility_id, event_type, aggregate_type, aggregate_id, payload)
       VALUES ($1, $2, 'StaffNoticeCreated', 'notification', $3, $4)`,
      [tenant.organizationId, tenant.facilityId, randomUUID(), JSON.stringify({ userId: rows[0]!.id })],
    );
    await drainEvents(ctx);

    expect(Object.keys(await update)).toEqual(["occurredAt"]);
    expect(heard).toEqual([]);
  });

  it("tells a patient, and only that patient, that the clinic replied: the thread id and nothing else", async () => {
    const admin = (await login(ctx, "admin@example.ph")).accessToken;
    const staff = (path: string, body: object = {}) => ctx.http().post(`/api/v1${path}`).set(as(admin, tenant.facilityId)).send(body);
    const patient = async (familyName: string, email: string) => {
      const id = (await staff("/patients", { familyName, givenName: "Pasyente", sex: "female", birthDate: "1982-04-09" }).expect(201)).body.id as string;
      await staff(`/patients/${id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
      const code = (await staff(`/patients/${id}/portal-account/invitations`).expect(201)).body.activationCode as string;
      const row = (await ctx.pool.query<{ patient_number: string }>("SELECT patient_number FROM patient WHERE id = $1", [id])).rows[0]!;
      const token = (
        await ctx
          .http()
          .post("/api/v1/portal/auth/activate")
          .send({
            organizationCode: "realtime-org",
            patientNumber: row.patient_number,
            birthDate: "1982-04-09",
            activationCode: code,
            email,
            password: "Pahintulot-ko-2026",
          })
          .expect(200)
      ).body.accessToken as string;
      return { id, token };
    };
    const maria = await patient("Matatag", "matatag@example.ph");
    const jose = await patient("Marahan", "marahan@example.ph");
    const ticketFor = (token: string) => ctx.http().post("/api/v1/portal/realtime-tickets").set("Authorization", `Bearer ${token}`);

    const mine = connect({ patientTicket: (await ticketFor(maria.token).expect(201)).body.ticket });
    await expect(next(mine, "ready")).resolves.toEqual({ channels: ["messages"] });
    const theirs = connect({ patientTicket: (await ticketFor(jose.token).expect(201)).body.ticket });
    await next(theirs, "ready");
    const heard: unknown[] = [];
    theirs.on("messages.updated", (message) => heard.push(message));

    const threadId = randomUUID();
    const update = next<Record<string, unknown>>(mine, "messages.updated");
    // The event the messaging service records when the clinic replies; a patient's own message does not echo back to them.
    const record = (sender: string, patientId: string) =>
      ctx.pool.query(
        `INSERT INTO domain_event (organization_id, facility_id, patient_id, event_type, aggregate_type, aggregate_id, payload)
         VALUES ($1, $2, $3, 'PatientMessageSent', 'patient_message_thread', $4, $5)`,
        [
          tenant.organizationId,
          tenant.facilityId,
          patientId,
          threadId,
          JSON.stringify({ threadId, messageId: randomUUID(), sender, body: "A private sentence." }),
        ],
      );
    await record("staff", maria.id);
    await drainEvents(ctx);

    const message = await update;
    expect(Object.keys(message).sort()).toEqual(["occurredAt", "threadId"]);
    expect(message).toMatchObject({ threadId });
    expect(heard).toEqual([]);

    // Not a staff token, a staff ticket or a patient's access token in place of a ticket.
    const staffToken = connect({ patientTicket: admin });
    await expect(next(staffToken, "unauthorized")).resolves.toMatchObject({ message: expect.any(String) });
    const accessToken = connect({ patientTicket: maria.token });
    await expect(next(accessToken, "unauthorized")).resolves.toMatchObject({ message: expect.any(String) });
  });

  it("rejects connections without a valid token or without queue access at that facility", async () => {
    const anonymous = connect({ token: "not-a-token", facilityId: tenant.facilityId });
    await expect(next(anonymous, "unauthorized")).resolves.toMatchObject({ message: expect.any(String) });

    // A member with no queue, laboratory or conversation access still hears their own notices, and nothing else.
    const auditor = connect({ token: (await login(ctx, "auditor@example.ph")).accessToken, facilityId: tenant.facilityId });
    await expect(next(auditor, "ready")).resolves.toEqual({ facilityId: tenant.facilityId, channels: ["notices"] });

    // Facility-scoped receptionist: allowed at the main facility only.
    const elsewhere = connect({ token: desk, facilityId: tenant.otherFacilityId });
    await expect(next(elsewhere, "unauthorized")).resolves.toBeDefined();
  });

  it("pushes laboratory changes to laboratory staff only, with ids and statuses and nothing about the patient or the test", async () => {
    await createStaff(ctx.pool, tenant, "medtech@example.ph", [{ role: "medical_technologist", facilityId: tenant.facilityId }]);
    const medtech = (await login(ctx, "medtech@example.ph")).accessToken;
    const lab = connect({ token: medtech, facilityId: tenant.facilityId });
    await expect(next(lab, "ready")).resolves.toEqual({ facilityId: tenant.facilityId, channels: ["laboratory", "notices"] });
    const queueOnly = connect({ token: desk, facilityId: tenant.facilityId });
    await next(queueOnly, "ready");
    const leaked: unknown[] = [];
    queueOnly.on("lab.updated", (message) => leaked.push(message));

    const admin = (await login(ctx, "admin@example.ph")).accessToken;
    const { practitionerId, userId } = await createClinician(ctx, tenant, "labdoc@example.ph", ["physician"]);
    const doctor = (await login(ctx, "labdoc@example.ph")).accessToken;
    // The patient registered by the queue test.
    const patient = { body: (await ctx.pool.query(`SELECT id FROM patient WHERE organization_id = $1 LIMIT 1`, [tenant.organizationId])).rows[0] };
    const encounterId = (
      await ctx.pool.query(
        `INSERT INTO encounter (organization_id, facility_id, patient_id, practitioner_id, started_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenant.organizationId, tenant.facilityId, patient.body.id, practitionerId, userId],
      )
    ).rows[0].id;
    const post = (path: string, body: object) => ctx.http().post(`/api/v1/laboratory${path}`).set(as(admin)).send(body).expect(201);
    const chem = (await post("/departments", { code: "chem", name: "Chemistry" })).body.id;
    const serum = (await post("/specimen-types", { code: "serum", name: "Serum" })).body.id;
    const test = (
      await post("/tests", { code: "fbs", name: "Fasting blood sugar", departmentId: chem, specimenTypeId: serum, resultType: "numeric", unit: "mmol/L" })
    ).body.id;
    await drainEvents(ctx);

    const created = next<Record<string, unknown>>(lab, "lab.updated");
    const order = await ctx
      .http()
      .post("/api/v1/laboratory/orders")
      .set(as(doctor, tenant.facilityId))
      .send({ patientId: patient.body.id, encounterId, testIds: [test] })
      .expect(201);
    await drainEvents(ctx);
    const message = await created;
    expect(message).toEqual({
      event: "LaboratoryOrderCreated",
      kind: "order",
      id: order.body.id,
      orderId: order.body.id,
      status: "active",
      critical: false,
      occurredAt: expect.any(String),
    });

    const collected = next<Record<string, unknown>>(lab, "lab.updated");
    const item = order.body.items[0];
    await ctx
      .http()
      .post(`/api/v1/laboratory/orders/${order.body.id}/specimens`)
      .set(as(medtech, tenant.facilityId))
      .send({ specimenTypeId: item.specimenTypeId, itemIds: [item.id] })
      .expect(201);
    await drainEvents(ctx);
    expect(await collected).toMatchObject({ event: "SpecimenCollected", kind: "specimen", orderId: order.body.id, status: "collected" });

    const all = JSON.stringify([message, await collected]);
    expect(all).not.toMatch(/Juan|Dela Cruz|Fasting|FBS|accession|orderNumber/i);
    expect(all).not.toContain(order.body.orderNumber);
    expect(leaked).toEqual([]);
  });

  describe("tickets for browsers", () => {
    function ticketFor(token: string, facilityId?: string) {
      return ctx.http().post("/api/v1/auth/realtime-tickets").set(as(token, facilityId));
    }

    it("issues a short-lived ticket bound to the facility, which opens the socket", async () => {
      const issued = await ticketFor(desk, tenant.facilityId).expect(201);
      expect(issued.body).toEqual({ ticket: expect.any(String), expiresInSeconds: 60 });

      const socket = connect({ ticket: issued.body.ticket });
      await expect(next(socket, "ready")).resolves.toEqual({ facilityId: tenant.facilityId, channels: ["queue", "messages", "notices"] });
    });

    it("needs a facility, and a ticket is never accepted as an access token", async () => {
      await ticketFor(desk).expect(400);
      const issued = await ticketFor(desk, tenant.facilityId).expect(201);
      await ctx.http().get("/api/v1/queue").set(as(issued.body.ticket, tenant.facilityId)).expect(401);
      // Nor is an access token accepted as a ticket.
      const socket = connect({ ticket: desk });
      await expect(next(socket, "unauthorized")).resolves.toBeDefined();
    });

    it("refuses a ticket whose session has ended, and gives a holder without queue access only their own notices", async () => {
      const session = await login(ctx, "desk@example.ph");
      const issued = await ticketFor(session.accessToken, tenant.facilityId).expect(201);
      await ctx.http().post("/api/v1/auth/logout").set(as(session.accessToken)).expect(204);
      const ended = connect({ ticket: issued.body.ticket });
      await expect(next(ended, "unauthorized")).resolves.toBeDefined();

      const auditor = (await login(ctx, "auditor@example.ph")).accessToken;
      const auditorTicket = await ticketFor(auditor, tenant.facilityId).expect(201);
      const socket = connect({ ticket: auditorTicket.body.ticket });
      // No queue access, but a permission here: the socket carries this member's own notices and nothing else.
      await expect(next(socket, "ready")).resolves.toEqual({ facilityId: tenant.facilityId, channels: ["notices"] });
    });
  });

  it("reaches a browser connected to another instance (rooms shared through Redis)", async () => {
    const elsewhere = connect({ token: desk, facilityId: tenant.facilityId }, secondUrl);
    await expect(next(elsewhere, "ready")).resolves.toEqual({ facilityId: tenant.facilityId, channels: ["queue", "messages", "notices"] });
    const admin = (await login(ctx, "admin@example.ph")).accessToken;
    const visitType = await ctx
      .http()
      .post("/api/v1/clinic/visit-types")
      .set(as(admin))
      .send({ code: "replica", name: "Replica check", defaultDurationMinutes: 15 })
      .expect(201);
    const patient = await ctx
      .http()
      .post("/api/v1/patients")
      .set(as(desk, tenant.facilityId))
      .send({ familyName: "Reyes", givenName: "Maria", sex: "female", birthDate: "1990-07-15", contacts: [{ system: "mobile", value: "0918 765 4321" }] })
      .expect(201);
    const update = next<Record<string, unknown>>(elsewhere, "queue.updated");
    const visit = await ctx
      .http()
      .post("/api/v1/queue/walk-ins")
      .set(as(desk, tenant.facilityId))
      .send({ patientId: patient.body.id, visitTypeId: visitType.body.id })
      .expect(201);
    // The event is processed by the first instance only; the socket listens on the second.
    await drainEvents(ctx);
    await expect(update).resolves.toMatchObject({ visitId: visit.body.id, status: "waiting" });
  });

  it("still delivers to its own sockets while Redis is unreachable", async () => {
    // A fresh instance (the schema is reset) with the adapter pointed at a closed port.
    const offline = await createTestApp({ realtime: { redisUrl: "redis://127.0.0.1:1", keyPrefix: realtime.keyPrefix } });
    try {
      await offline.app.listen(0, "127.0.0.1");
      const again = await createTenant(offline.pool, "realtime-org");
      await createStaff(offline.pool, again, "admin@example.ph", ["org_admin"]);
      await createStaff(offline.pool, again, "desk@example.ph", [{ role: "receptionist", facilityId: again.facilityId }]);
      const token = (await login(offline, "desk@example.ph")).accessToken;
      const admin = (await login(offline, "admin@example.ph")).accessToken;
      const local = connect({ token, facilityId: again.facilityId }, realtimeUrl(offline));
      await expect(next(local, "ready")).resolves.toMatchObject({ channels: ["queue", "messages", "notices"] });
      const visitType = await offline
        .http()
        .post("/api/v1/clinic/visit-types")
        .set(as(admin))
        .send({ code: "offline", name: "Offline check", defaultDurationMinutes: 15 })
        .expect(201);
      const patient = await offline.http().post("/api/v1/patients").set(as(token, again.facilityId)).send(juan).expect(201);
      const update = next<Record<string, unknown>>(local, "queue.updated");
      await offline
        .http()
        .post("/api/v1/queue/walk-ins")
        .set(as(token, again.facilityId))
        .send({ patientId: patient.body.id, visitTypeId: visitType.body.id })
        .expect(201);
      await drainEvents(offline);
      await expect(update).resolves.toMatchObject({ status: "waiting" });
    } finally {
      await offline.close();
    }
  });
});
