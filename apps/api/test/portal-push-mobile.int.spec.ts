import { Test } from "@nestjs/testing";
import { CoreModule, DATABASE, type Database } from "@healthcare/core";
import {
  CHANNEL_SENDERS,
  EXPO_PUSH_TRANSPORT,
  type ExpoPushMessage,
  type ExpoPushReceipt,
  ExpoPushReceipts,
  type ExpoPushTicket,
  type ExpoPushTransport,
  LoggingSender,
  NOTIFICATION_QUEUE,
  NotificationDispatcher,
  NotificationWorkerModule,
  PushSubscriptionService,
  WebPushSender,
} from "@healthcare/notification";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext, underPlatform } from "./harness";

const PASSWORD = "Pahintulot-ko-2026";
const ORG = "myhealth-mobile-push";
const token = (n: number) => `ExponentPushToken[device-token-${String(n).padStart(4, "0")}xx]`;

class FakeExpo implements ExpoPushTransport {
  readonly sent: ExpoPushMessage[] = [];
  private n = 0;
  answer: (m: ExpoPushMessage) => ExpoPushTicket = () => ({ status: "ok", id: `ticket-${++this.n}` });
  fail = false;
  /** Receipts Expo would return, by ticket id; absent ids have no receipt yet. */
  receiptsById: Record<string, ExpoPushReceipt> = {};
  receiptsFail = false;
  readonly receiptRequests: string[][] = [];
  async send(messages: ExpoPushMessage[]) {
    if (this.fail) throw new Error("Expo is unreachable");
    this.sent.push(...messages);
    return messages.map(this.answer);
  }
  async receipts(ids: string[]) {
    this.receiptRequests.push(ids);
    if (this.receiptsFail) throw new Error("Expo is unreachable");
    return Object.fromEntries(ids.filter((id) => this.receiptsById[id]).map((id) => [id, this.receiptsById[id]!]));
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
  let receipts: ExpoPushReceipts;
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
          expoTransport: { provide: EXPO_PUSH_TRANSPORT, useValue: expo },
          senders: {
            provide: CHANNEL_SENDERS,
            useValue: [new WebPushSender(new PushSubscriptionService(db), undefined, expo), new LoggingSender("sms"), new LoggingSender("email")],
          },
        }),
      ],
    }).compile();
    dispatcher = underPlatform(worker.get(NotificationDispatcher));
    receipts = underPlatform(worker.get(ExpoPushReceipts));
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

  describe("receipts", () => {
    const MIN = 60_000;
    const later = (minutes: number) => new Date(Date.now() + minutes * MIN);
    const ticketRows = async () =>
      (
        await ctx.pool.query<{
          ticket_id: string;
          notification_id: string | null;
          receipt_status: string | null;
          receipt_error: string | null;
          check_count: number;
        }>("SELECT ticket_id, notification_id, receipt_status, receipt_error, check_count FROM push_ticket ORDER BY sent_at, ticket_id")
      ).rows;
    const deviceOf = async (n: number) =>
      (await ctx.pool.query("SELECT revoked_reason, failure_count FROM push_subscription WHERE endpoint = $1", [token(n)])).rows[0];
    /** Registers a phone, sends a test notice to it and returns the notification id and the ticket Expo gave. */
    async function sendTo(n: number): Promise<{ notificationId: string; ticketId: string }> {
      await registerDevice(n).expect(201);
      await portal(juanToken).post("/push/test").expect(202);
      const [row] = (await testRows()).slice(-1);
      await expect(dispatcher.dispatch(row!.id)).resolves.toBe("sent");
      const ticket = (await ticketRows()).find((t) => t.notification_id === row!.id);
      expect(ticket).toBeDefined();
      return { notificationId: row!.id, ticketId: ticket!.ticket_id };
    }
    const removeAll = async () => {
      for (const d of (await portal(juanToken).get("/push").expect(200)).body.devices as Array<{ id: string }>) {
        await portal(juanToken).post(`/push/subscriptions/${d.id}/remove`).expect(204);
      }
    };

    beforeEach(async () => {
      expo.answer = (() => {
        let k = 0;
        return () => ({ status: "ok", id: `ticket-${Date.now()}-${++k}` });
      })();
      expo.receiptsById = {};
      expo.receiptsFail = false;
      await ctx.pool.query("DELETE FROM push_ticket");
      await ctx.pool.query("UPDATE push_subscription SET revoked_at = NULL, revoked_reason = NULL, failure_count = 0 WHERE endpoint LIKE 'Expo%'");
      await removeAll();
    });

    it("keeps the ticket of an accepted message, linked to its notification, and waits 15 minutes before asking", async () => {
      const { notificationId, ticketId } = await sendTo(20);
      expect(await ticketRows()).toEqual([expect.objectContaining({ ticket_id: ticketId, notification_id: notificationId, receipt_status: null })]);
      expo.receiptRequests.length = 0;
      await receipts.run(later(5));
      expect(expo.receiptRequests).toEqual([]);
    });

    it("marks the notification delivered when Apple or Google took the message", async () => {
      const { notificationId, ticketId } = await sendTo(21);
      expo.receiptsById[ticketId] = { status: "ok" };
      const round = await receipts.run(later(16));
      expect(round).toMatchObject({ checked: 1, delivered: 1 });
      expect((await ticketRows())[0]).toMatchObject({ receipt_status: "ok", check_count: 1 });
      const { rows } = await ctx.pool.query("SELECT status, delivered_at FROM notification WHERE id = $1", [notificationId]);
      expect(rows[0].status).toBe("delivered");
      expect(rows[0].delivered_at).not.toBeNull();
      // Answered tickets are not asked about again.
      expo.receiptRequests.length = 0;
      await receipts.run(later(40));
      expect(expo.receiptRequests).toEqual([]);
    });

    it("drops the phone at once when the app is gone, without waiting for 5 failed sends", async () => {
      const { notificationId, ticketId } = await sendTo(22);
      expo.receiptsById[ticketId] = { status: "error", error: "DeviceNotRegistered", message: "gone" };
      expect(await receipts.run(later(16))).toMatchObject({ gone: 1 });
      expect(await deviceOf(22)).toMatchObject({ revoked_reason: "gone" });
      expect((await ticketRows())[0]).toMatchObject({ receipt_status: "error", receipt_error: "DeviceNotRegistered" });
      expect((await ctx.pool.query("SELECT status FROM notification WHERE id = $1", [notificationId])).rows[0].status).toBe("sent");
    });

    it("never blames the phone for the platform's own credentials, but counts other errors against it", async () => {
      const a = await sendTo(23);
      expo.receiptsById[a.ticketId] = { status: "error", error: "InvalidCredentials" };
      expect(await receipts.run(later(16))).toMatchObject({ configuration: 1 });
      expect(await deviceOf(23)).toMatchObject({ revoked_reason: null, failure_count: 0 });

      await ctx.pool.query("DELETE FROM push_ticket");
      const b = await sendTo(23);
      expo.receiptsById[b.ticketId] = { status: "error", error: "MessageRateExceeded" };
      expect(await receipts.run(later(16))).toMatchObject({ failed: 1 });
      expect(await deviceOf(23)).toMatchObject({ revoked_reason: null, failure_count: 1 });
    });

    it("asks again while no receipt is ready, keeps tickets when Expo is unreachable, and gives up after a day", async () => {
      const { ticketId } = await sendTo(24);
      expect(await receipts.run(later(16))).toMatchObject({ waiting: 1 });
      expo.receiptsFail = true;
      expect(await receipts.run(later(31))).toMatchObject({ checked: 0 });
      expect((await ticketRows())[0]).toMatchObject({ receipt_status: null, check_count: 1 });
      expo.receiptsFail = false;
      expect(await receipts.run(later(24 * 60 + 1))).toMatchObject({ expired: 1 });
      expect((await ticketRows())[0]).toMatchObject({ ticket_id: ticketId, receipt_status: "expired" });
      expect(await deviceOf(24)).toMatchObject({ revoked_reason: null, failure_count: 0 });
    });

    it("asks for at most 1,000 receipts per request, and removes answered tickets after 30 days", async () => {
      const { rows } = await ctx.pool.query<{ id: string; organization_id: string }>("SELECT id, organization_id FROM push_subscription WHERE endpoint = $1", [
        token(20),
      ]);
      await ctx.pool.query(
        `INSERT INTO push_ticket (organization_id, push_subscription_id, ticket_id, sent_at)
         SELECT $1, $2, 'bulk-' || g, now() - interval '1 hour' FROM generate_series(1, 1500) g`,
        [rows[0]!.organization_id, rows[0]!.id],
      );
      expo.receiptRequests.length = 0;
      await receipts.run(new Date());
      expect(expo.receiptRequests.map((r) => r.length)).toEqual([1000, 500]);
      await ctx.pool.query("UPDATE push_ticket SET receipt_status = 'expired', checked_at = now() - interval '31 days'");
      await receipts.run(new Date());
      expect(await ticketRows()).toEqual([]);
    });

    it("lets only one worker read receipts at a time", async () => {
      const { ticketId } = await sendTo(25);
      expo.receiptsById[ticketId] = { status: "ok" };
      const [first, second] = await Promise.all([receipts.run(later(16)), receipts.run(later(16))]);
      expect(first.checked + second.checked).toBe(1);
    });
  });
});
