import { Test } from "@nestjs/testing";
import { CoreModule, DATABASE, type Database } from "@healthcare/core";
import {
  CHANNEL_SENDERS,
  type ExpoPushMessage,
  type ExpoPushTicket,
  type ExpoPushTransport,
  LoggingSender,
  NOTIFICATION_QUEUE,
  NotificationDispatcher,
  NotificationWorkerModule,
  PushSubscriptionService,
  WebPushSender,
} from "@healthcare/notification";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

const PASSWORD = "Pahintulot-ko-2026";
const ORG = "myhealth-mobile-push";
const token = (n: number) => `ExponentPushToken[device-token-${String(n).padStart(4, "0")}xx]`;

class FakeExpo implements ExpoPushTransport {
  readonly sent: ExpoPushMessage[] = [];
  answer: (m: ExpoPushMessage) => ExpoPushTicket = () => ({ status: "ok", id: "ticket" });
  fail = false;
  async send(messages: ExpoPushMessage[]) {
    if (this.fail) throw new Error("Expo is unreachable");
    this.sent.push(...messages);
    return messages.map(this.answer);
  }
}

/**
 * Push to the MyHealth mobile app through the Expo push service (docs/architecture/mobile-app.md): the app registers its
 * token with the same limits as browsers, the message carries no clinical detail, and a token Expo reports as gone is dropped.
 */
describe("MyHealth mobile push", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let dispatcher: NotificationDispatcher;
  let closeWorker: () => Promise<void>;
  let juanId: string;
  let juanToken: string;
  const expo = new FakeExpo();

  const portal = (bearer: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1/portal${url}`).set("Authorization", `Bearer ${bearer}`),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/portal${url}`).set("Authorization", `Bearer ${bearer}`).send(body),
  });
  const registerDevice = (n: number, extra: object = {}) => portal(juanToken).post("/push/mobile-devices", { token: token(n), platform: "ios", ...extra });
  const testRows = async () =>
    (
      await ctx.pool.query<{ id: string; status: string }>(
        "SELECT id, status FROM notification WHERE recipient_patient_id = $1 AND template_key = 'portal.push-test' ORDER BY created_at",
        [juanId],
      )
    ).rows;

  beforeAll(async () => {
    ctx = await createTestApp({}, { EXPO_PUSH_ENABLED: "true" });
    tenant = await createTenant(ctx.pool, ORG);
    await createStaff(ctx.pool, tenant, "admin@mpush.ph", ["org_admin"]);
    admin = (await login(ctx, "admin@mpush.ph")).accessToken;
    const staff = (path: string, body: object = {}) => ctx.http().post(`/api/v1${path}`).set(as(admin, tenant.facilityId)).send(body);
    juanId = (await staff("/patients", juan).expect(201)).body.id;
    await staff(`/patients/${juanId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staff(`/patients/${juanId}/portal-account/invitations`).expect(201)).body.activationCode;
    const { rows } = await ctx.pool.query<{ patient_number: string; birth_date: string }>(
      "SELECT patient_number, to_char(birth_date, 'YYYY-MM-DD') AS birth_date FROM patient WHERE id = $1",
      [juanId],
    );
    juanToken = (
      await ctx
        .http()
        .post("/api/v1/portal/auth/activate")
        .send({
          organizationCode: ORG,
          patientNumber: rows[0]!.patient_number,
          birthDate: rows[0]!.birth_date,
          activationCode: code,
          email: "juan@mpush.ph",
          password: PASSWORD,
        })
        .expect(200)
    ).body.accessToken;

    const db = ctx.app.get<Database>(DATABASE);
    const worker = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot(ctx.config),
        NotificationWorkerModule.forRoot({
          autoStart: false,
          queue: { provide: NOTIFICATION_QUEUE, useValue: ctx.queue },
          senders: {
            provide: CHANNEL_SENDERS,
            useValue: [new WebPushSender(new PushSubscriptionService(db), undefined, expo), new LoggingSender("sms"), new LoggingSender("email")],
          },
        }),
      ],
    }).compile();
    dispatcher = worker.get(NotificationDispatcher);
    closeWorker = () => worker.close();
  });
  afterAll(async () => {
    await closeWorker();
    await ctx.close();
  });

  it("is offered to the app, and needs the patient's own session", async () => {
    expect((await portal(juanToken).get("/push").expect(200)).body).toMatchObject({ configured: false, mobileConfigured: true, devices: [] });
    await ctx
      .http()
      .post("/api/v1/portal/push/mobile-devices")
      .send({ token: token(1), platform: "ios" })
      .expect(401);
    await ctx
      .http()
      .post("/api/v1/portal/push/mobile-devices")
      .set(as(admin, tenant.facilityId))
      .send({ token: token(1), platform: "ios" })
      .expect(401);
  });

  it("registers a token once, names the device plainly, and refuses anything that is not an Expo token", async () => {
    await registerDevice(1, { token: "https://push.example.test/x" }).expect(400);
    await registerDevice(1, { platform: "windows" }).expect(400);
    const created = (await registerDevice(1).expect(201)).body;
    expect(created).toMatchObject({ kind: "expo", label: "MyHealth app on iPhone", lastSuccessAt: null });
    const named = (await registerDevice(1, { deviceName: "Juan's phone" }).expect(201)).body;
    expect(named).toMatchObject({ id: created.id, label: "MyHealth app on Juan's phone" });
    const status = (
      await portal(juanToken)
        .get(`/push?token=${encodeURIComponent(token(1))}`)
        .expect(200)
    ).body;
    expect(status.thisDeviceId).toBe(created.id);
    expect(status.devices).toHaveLength(1);
    expect(await auditRows(ctx.pool, `action = 'portal.push-register' AND patient_id = $1`, [juanId])).toHaveLength(2);
    const row = (await ctx.pool.query("SELECT kind, p256dh, auth FROM push_subscription WHERE id = $1", [created.id])).rows[0];
    expect(row).toEqual({ kind: "expo", p256dh: null, auth: null });
  });

  it("allows at most five devices, removal frees a place, and the database refuses a malformed row", async () => {
    for (const n of [2, 3, 4, 5]) await registerDevice(n).expect(201);
    expect((await registerDevice(6).expect(422)).body.error.code).toBe("too_many_push_devices");
    const devices = (await portal(juanToken).get("/push").expect(200)).body.devices as Array<{ id: string }>;
    await portal(juanToken).post(`/push/subscriptions/${devices[4]!.id}/remove`).expect(204);
    await registerDevice(6).expect(201);
    await expect(
      ctx.pool.query("UPDATE push_subscription SET p256dh = 'x'.repeat(50) WHERE kind = 'expo'".replace("'x'.repeat(50)", `'${"x".repeat(50)}'`)),
    ).rejects.toThrow(/push_subscription_kind_shape/);
  });

  it("sends the test notice to the phone with a title, one line and where it opens, and nothing else", async () => {
    for (const d of (await portal(juanToken).get("/push").expect(200)).body.devices as Array<{ id: string }>) {
      if (d.id) await portal(juanToken).post(`/push/subscriptions/${d.id}/remove`).expect(204);
    }
    await registerDevice(1).expect(201);
    expect((await portal(juanToken).post("/push/test").expect(202)).body.status).toBe("queued");
    const [row] = (await testRows()).slice(-1);
    await expect(dispatcher.dispatch(row!.id)).resolves.toBe("sent");
    expect(expo.sent).toHaveLength(1);
    expect(expo.sent[0]).toMatchObject({ to: token(1), sound: "default", channelId: "default", data: { url: expect.stringMatching(/^\//) } });
    expect(Object.keys(expo.sent[0]!).sort()).toEqual(["body", "channelId", "data", "priority", "sound", "title", "to", "ttl"]);
    const { rows } = await ctx.pool.query("SELECT last_success_at FROM push_subscription WHERE endpoint = $1", [token(1)]);
    expect(rows[0].last_success_at).not.toBeNull();
  });

  it("drops a token Expo says is gone, and retries when Expo cannot be reached", async () => {
    expo.fail = true;
    await portal(juanToken).post("/push/test").expect(202);
    let [row] = (await testRows()).slice(-1);
    await expect(dispatcher.dispatch(row!.id)).resolves.toBe("retry");
    expect((await ctx.pool.query("SELECT failure_count FROM push_subscription WHERE endpoint = $1", [token(1)])).rows[0].failure_count).toBe(1);
    expo.fail = false;

    expo.answer = () => ({ status: "error", error: "DeviceNotRegistered", message: "gone" });
    await portal(juanToken).post("/push/test").expect(202);
    [row] = (await testRows()).slice(-1);
    await expect(dispatcher.dispatch(row!.id)).resolves.toBe("failed");
    const dropped = (await ctx.pool.query("SELECT revoked_reason FROM push_subscription WHERE endpoint = $1", [token(1)])).rows[0];
    expect(dropped.revoked_reason).toBe("gone");
    expect((await portal(juanToken).post("/push/test").expect(422)).body.error.code).toBe("no_push_device");
  });
});
