import { Test } from "@nestjs/testing";
import * as webpush from "web-push";
import { CoreModule, DATABASE, type Database } from "@healthcare/core";
import {
  CHANNEL_SENDERS,
  LoggingSender,
  NOTIFICATION_QUEUE,
  NotificationDispatcher,
  NotificationWorkerModule,
  PushSubscriptionService,
  WebPushSender,
  type WebPushTransport,
} from "@healthcare/notification";
import { as, auditRows, createStaff, createTenant, createTestApp, drainEvents, juan, login, type Tenant, type TestContext, underPlatform } from "./harness";

const PASSWORD = "Pahintulot-ko-2026";
const ORG = "myhealth-push";
const vapid = webpush.generateVAPIDKeys();
const endpoint = (n: number) => `https://push.example.test/send/device-${n}`;
const keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) };
const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

class FakeTransport implements WebPushTransport {
  readonly sent: Array<{ endpoint: string; payload: string }> = [];
  status = 201;
  async send(subscription: { endpoint: string }, payload: string) {
    this.sent.push({ endpoint: subscription.endpoint, payload });
    return { statusCode: this.status };
  }
}

/**
 * Push notifications through the browser (docs/domains/notification.md, "Push"): devices a patient allowed, push first for
 * content-free notices, gone devices dropped, preferences applying, and no content leaving the platform.
 */
describe("MyHealth push notifications", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let nurse: string;
  let dispatcher: NotificationDispatcher;
  let closeWorker: () => Promise<void>;
  const transport = new FakeTransport();
  const patients: Record<string, { id: string; token: string }> = {};

  const staff = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const portal = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1/portal${url}`).set("Authorization", `Bearer ${token}`),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/portal${url}`).set("Authorization", `Bearer ${token}`).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1/portal${url}`).set("Authorization", `Bearer ${token}`).send(body),
  });
  const register = (token: string, n: number, userAgent = ANDROID) =>
    ctx
      .http()
      .post("/api/v1/portal/push/subscriptions")
      .set("Authorization", `Bearer ${token}`)
      .set("User-Agent", userAgent)
      .send({ endpoint: endpoint(n), keys });

  async function patient(name: string, body: object, email: string) {
    const id = (await staff(admin).post("/patients", body).expect(201)).body.id as string;
    await staff(admin).post(`/patients/${id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staff(admin).post(`/patients/${id}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [id],
    );
    const token = (
      await ctx
        .http()
        .post("/api/v1/portal/auth/activate")
        .send({
          organizationCode: ORG,
          patientNumber: rows[0]!.patient_number,
          birthDate: rows[0]!.birth_date,
          activationCode: code,
          email,
          password: PASSWORD,
        })
        .expect(200)
    ).body.accessToken as string;
    patients[name] = { id, token };
  }
  const pushRows = async (patientId: string, templateKey: string) =>
    (
      await ctx.pool.query<{ id: string; channel: string; status: string; destination: string | null }>(
        "SELECT id, channel, status, destination FROM notification WHERE recipient_patient_id = $1 AND template_key = $2 ORDER BY created_at",
        [patientId, templateKey],
      )
    ).rows;

  beforeAll(async () => {
    ctx = await createTestApp({}, { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:privacy@push.test" });
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@push.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "nurse@push.ph", ["nurse"]);
    admin = (await login(ctx, "admin@push.ph")).accessToken;
    nurse = (await login(ctx, "nurse@push.ph")).accessToken;
    await patient("juan", juan, "juan@push.ph");
    await patient(
      "maria",
      {
        familyName: "Reyes",
        givenName: "Maria",
        sex: "female",
        birthDate: "1991-07-09",
        contacts: [{ system: "mobile", value: "0918 765 4321" }],
        addresses: juan.addresses,
        identifiers: [],
      },
      "maria@push.ph",
    );

    const db = ctx.app.get<Database>(DATABASE);
    const worker = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot(ctx.config),
        NotificationWorkerModule.forRoot({
          autoStart: false,
          queue: { provide: NOTIFICATION_QUEUE, useValue: ctx.queue },
          senders: {
            provide: CHANNEL_SENDERS,
            useValue: [new WebPushSender(new PushSubscriptionService(db), transport), new LoggingSender("sms"), new LoggingSender("email")],
          },
        }),
      ],
    }).compile();
    dispatcher = underPlatform(worker.get(NotificationDispatcher));
    closeWorker = () => worker.close();
  });
  afterAll(async () => {
    await closeWorker();
    await ctx.close();
  });

  it("is offered with the platform's public key, and lists no device to begin with", async () => {
    const status = (await portal(patients["juan"]!.token).get("/push").expect(200)).body;
    expect(status).toEqual({ configured: true, mobileConfigured: false, vapidPublicKey: vapid.publicKey, devices: [], thisDeviceId: null });
    await ctx.http().get("/api/v1/portal/push").expect(401);
    await ctx.http().get("/api/v1/portal/push").set(as(admin, tenant.facilityId)).expect(401);
  });

  it("registers a device once, describes it plainly, and never accepts a plain-http address", async () => {
    const juanToken = patients["juan"]!.token;
    await ctx
      .http()
      .post("/api/v1/portal/push/subscriptions")
      .set("Authorization", `Bearer ${juanToken}`)
      .send({ endpoint: "http://push.example.test/x", keys })
      .expect(400);
    await ctx
      .http()
      .post("/api/v1/portal/push/subscriptions")
      .set("Authorization", `Bearer ${juanToken}`)
      .send({ endpoint: endpoint(1), keys: { p256dh: "x", auth: "y" } })
      .expect(400);
    const created = (await register(juanToken, 1).expect(201)).body;
    expect(created).toMatchObject({ label: "Chrome on Android", lastSuccessAt: null });
    const again = (await register(juanToken, 1).expect(201)).body;
    expect(again.id).toBe(created.id);
    const status = (
      await portal(juanToken)
        .get(`/push?endpoint=${encodeURIComponent(endpoint(1))}`)
        .expect(200)
    ).body;
    expect(status.devices).toHaveLength(1);
    expect(status.thisDeviceId).toBe(created.id);
    expect(
      (
        await portal(juanToken)
          .get(`/push?endpoint=${encodeURIComponent(endpoint(9))}`)
          .expect(200)
      ).body.thisDeviceId,
    ).toBeNull();
    const audit = await auditRows(ctx.pool, "action = 'portal.push-register'");
    expect(audit.every((a) => a.actor_type === "patient")).toBe(true);
  });

  it("keeps five devices at most, lets a patient remove their own, and moves a shared browser to whoever signs in", async () => {
    const juanToken = patients["juan"]!.token;
    for (let n = 2; n <= 5; n++) await register(juanToken, n).expect(201);
    await register(juanToken, 6)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("too_many_push_devices"));
    const devices = (await portal(juanToken).get("/push").expect(200)).body.devices as Array<{ id: string }>;
    expect(devices).toHaveLength(5);
    await portal(patients["maria"]!.token).post(`/push/subscriptions/${devices[4]!.id}/remove`).expect(404);
    await portal(juanToken).post(`/push/subscriptions/${devices[4]!.id}/remove`).expect(204);
    await portal(juanToken).post(`/push/subscriptions/${devices[4]!.id}/remove`).expect(404);

    // Maria signs in on the browser Juan used for device 2: it now belongs to her.
    await register(patients["maria"]!.token, 2).expect(201);
    expect(((await portal(juanToken).get("/push").expect(200)).body.devices as unknown[]).length).toBe(3);
    expect(((await portal(patients["maria"]!.token).get("/push").expect(200)).body.devices as unknown[]).length).toBe(1);
  });

  it("shows push next to text and email in the notification settings, under the same choices", async () => {
    const juanToken = patients["juan"]!.token;
    const view = (await portal(juanToken).get("/communication-preferences").expect(200)).body as {
      destinations: Record<string, string | null>;
      preferences: Array<{ channel: string; category: string; enabled: boolean }>;
    };
    expect(view.destinations["push"]).toBe("3 devices");
    expect(view.preferences.filter((p) => p.channel === "push")).toHaveLength(3);
    await portal(juanToken)
      .put("/communication-preferences", { preferences: [{ channel: "in_app", category: "clinical", optedIn: false }] })
      .expect(400);
    expect((await portal(patients["maria"]!.token).get("/communication-preferences").expect(200)).body.destinations.push).toBe("1 device");
  });

  it("sends a test to the patient's devices, encrypted per device, with nothing about care in it", async () => {
    const juan = patients["juan"]!;
    const before = transport.sent.length;
    expect((await portal(juan.token).post("/push/test").expect(202)).body.status).toBe("queued");
    const [row] = (await pushRows(juan.id, "portal.push-test")).slice(-1);
    expect(row).toMatchObject({ channel: "push", status: "queued" });
    expect(row!.destination).toMatch(/^[0-9a-f-]{36}$/);
    await expect(dispatcher.dispatch(row!.id)).resolves.toBe("sent");
    const sent = transport.sent.slice(before);
    expect(sent).toHaveLength(3);
    const payload = JSON.parse(sent[0]!.payload) as { title: string; body: string; url: string };
    expect(payload).toMatchObject({ title: "Notifications are on", url: "/notification-settings" });
    expect(JSON.stringify(payload)).not.toMatch(/Juan|Dela Cruz|P0000/);
    const { rows } = await ctx.pool.query<{ last_success_at: Date | null }>(
      "SELECT last_success_at FROM push_subscription WHERE portal_account_id IN (SELECT id FROM patient_portal_account WHERE patient_id = $1) AND revoked_at IS NULL",
      [juan.id],
    );
    expect(rows.every((r) => r.last_success_at !== null)).toBe(true);
    await portal(patients["maria"]!.token).get("/push").expect(200);
    // No device, no test.
    await ctx.pool.query(
      "UPDATE push_subscription SET revoked_at = now(), revoked_reason = 'removed_by_patient' WHERE portal_account_id IN (SELECT id FROM patient_portal_account WHERE patient_id = $1)",
      [patients["maria"]!.id],
    );
    await portal(patients["maria"]!.token)
      .post("/push/test")
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("no_push_device"));
    await register(patients["maria"]!.token, 7).expect(201);
  });

  it("honours an opt-out of push, and drops a device the push service says is gone", async () => {
    const juan = patients["juan"]!;
    await portal(juan.token)
      .put("/communication-preferences", { preferences: [{ channel: "push", category: "administrative", optedIn: false }] })
      .expect(200);
    expect((await portal(juan.token).post("/push/test").expect(202)).body.status).toBe("suppressed");
    await portal(juan.token)
      .put("/communication-preferences", { preferences: [{ channel: "push", category: "administrative", optedIn: true }] })
      .expect(200);

    transport.status = 410;
    const queued = (await portal(juan.token).post("/push/test").expect(202)).body;
    expect(queued.status).toBe("queued");
    const [row] = (await pushRows(juan.id, "portal.push-test")).slice(-1);
    await expect(dispatcher.dispatch(row!.id)).resolves.toBe("failed");
    const { rows } = await ctx.pool.query<{ revoked_reason: string | null }>(
      "SELECT revoked_reason FROM push_subscription WHERE portal_account_id IN (SELECT id FROM patient_portal_account WHERE patient_id = $1)",
      [juan.id],
    );
    expect(rows.filter((r) => r.revoked_reason === "gone")).toHaveLength(3);
    transport.status = 201;
    expect(((await portal(juan.token).get("/push").expect(200)).body.devices as unknown[]).length).toBe(0);
  });

  it("goes first for a nudge: a device gets the push instead of an SMS, a patient without one keeps getting the SMS", async () => {
    const { juan, maria } = patients as Record<"juan" | "maria", { id: string; token: string }>;
    await register(juan.token, 21).expect(201);
    // Maria has turned notifications off on every device.
    await ctx.pool.query(
      "UPDATE push_subscription SET revoked_at = now(), revoked_reason = 'removed_by_patient' WHERE portal_account_id IN (SELECT id FROM patient_portal_account WHERE patient_id = $1)",
      [maria.id],
    );
    for (const p of [juan, maria]) {
      const started = (await portal(p.token).post("/message-threads", { topic: "general", subject: "Question", body: "Hello, a question." }).expect(201)).body;
      await staff(nurse).post(`/patient-messages/${started.id}/messages`, { body: "Here is the answer." }).expect(201);
    }
    await drainEvents(ctx);
    const juanRows = await pushRows(juan.id, "portal.message-received");
    expect(juanRows.map((r) => r.channel)).toEqual(["push"]);
    expect(juanRows[0]!.status).toBe("queued");
    const mariaRows = await pushRows(maria.id, "portal.message-received");
    expect(mariaRows.map((r) => r.channel)).toEqual(["sms"]);
    // The push text says a message is waiting, not what it says.
    const before = transport.sent.length;
    await dispatcher.dispatch(juanRows[0]!.id);
    const payload = JSON.parse(transport.sent[before]!.payload) as { title: string; body: string };
    expect(payload.title).toBe("You have a new message");
    expect(JSON.stringify(payload)).not.toContain("answer");
  });

  it("holds the database to https addresses and one reason per revoked device", async () => {
    await expect(ctx.pool.query("UPDATE push_subscription SET endpoint = 'http://x.example.test/a'")).rejects.toThrow(/push_subscription_kind_shape/);
    await expect(ctx.pool.query("UPDATE push_subscription SET revoked_at = now(), revoked_reason = NULL WHERE revoked_at IS NULL")).rejects.toThrow(
      /push_subscription_check/,
    );
  });
});
