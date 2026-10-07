import { Test } from "@nestjs/testing";
import * as webpush from "web-push";
import { CoreModule, DATABASE, type Database, systemActor } from "@healthcare/core";
import {
  CHANNEL_SENDERS,
  LoggingSender,
  NOTIFICATION_QUEUE,
  NotificationDispatcher,
  NotificationService,
  NotificationWorkerModule,
  PushSubscriptionService,
  WebPushSender,
  type WebPushTransport,
} from "@healthcare/notification";
import { as, auditRows, createStaff, createTenant, createTestApp, login, type Tenant, type TestContext } from "./harness";

const ORG = "staff-push";
const vapid = webpush.generateVAPIDKeys();
const endpoint = (n: number) => `https://push.example.test/staff/device-${n}`;
const keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) };
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0";
const REQUEST_ID = "4e5a2a3c-6f1f-4d2a-9b3e-1c2d3e4f5a6b";

class FakeTransport implements WebPushTransport {
  readonly sent: Array<{ endpoint: string; payload: string }> = [];
  async send(subscription: { endpoint: string }, payload: string) {
    this.sent.push({ endpoint: subscription.endpoint, payload });
    return { statusCode: 201 };
  }
}

/**
 * Push notifications for staff (docs/domains/notification.md, "Push"; migration 0101): a member's browsers, the mirror
 * of in-app notices with content-free wording, the test push, and what a suspended member and a free-text notice never get.
 */
describe("staff push notifications", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let nurse: string;
  let nurseId: string;
  let adminId: string;
  let admin: string;
  let dispatcher: NotificationDispatcher;
  let notifications: NotificationService;
  let closeWorker: () => Promise<void>;
  const transport = new FakeTransport();

  const me = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1/me/push${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1/me/push${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1/me/push${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const register = (token: string, n: number, userAgent = WINDOWS) =>
    ctx
      .http()
      .post("/api/v1/me/push/subscriptions")
      .set(as(token, tenant.facilityId))
      .set("User-Agent", userAgent)
      .send({ endpoint: endpoint(n), keys });
  const rows = async (userId: string, templateKey: string) =>
    (
      await ctx.pool.query<{ id: string; channel: string; status: string; destination: string | null; suppression_reason: string | null }>(
        "SELECT id, channel, status, destination, suppression_reason FROM notification WHERE recipient_user_id = $1 AND template_key = $2 ORDER BY created_at, channel",
        [userId, templateKey],
      )
    ).rows;

  beforeAll(async () => {
    ctx = await createTestApp({}, { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:privacy@push.test" });
    tenant = await createTenant(ctx.pool, ORG);
    adminId = await createStaff(ctx.pool, tenant, "admin@staff-push.ph", ["org_admin"]);
    nurseId = await createStaff(ctx.pool, tenant, "nurse@staff-push.ph", ["nurse"]);
    admin = (await login(ctx, "admin@staff-push.ph")).accessToken;
    nurse = (await login(ctx, "nurse@staff-push.ph")).accessToken;
    notifications = ctx.app.get(NotificationService);
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
    dispatcher = worker.get(NotificationDispatcher);
    closeWorker = () => worker.close();
  });
  afterAll(async () => {
    await closeWorker();
    await ctx.close();
  });

  it("is offered to every signed-in member with the platform's key, and lists no browser to begin with", async () => {
    const status = (await me(nurse).get("").expect(200)).body;
    expect(status).toMatchObject({ configured: true, vapidPublicKey: vapid.publicKey, devices: [], thisDeviceId: null });
    expect(status.preferences).toHaveLength(7);
    await ctx.http().get("/api/v1/me/push").expect(401);
    await me(nurse)
      .post("/test")
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("no_push_device"));
  });

  it("registers a browser for the member, keeps five at most, and lets them remove one", async () => {
    await me(nurse).post("/subscriptions", { endpoint: "http://push.example.test/x", keys }).expect(400);
    const created = (await register(nurse, 1).expect(201)).body;
    expect(created).toMatchObject({ label: "Edge on Windows", kind: "web", lastSuccessAt: null });
    expect((await register(nurse, 1).expect(201)).body.id).toBe(created.id);
    const status = (
      await me(nurse)
        .get(`?endpoint=${encodeURIComponent(endpoint(1))}`)
        .expect(200)
    ).body;
    expect(status.devices).toHaveLength(1);
    expect(status.thisDeviceId).toBe(created.id);
    const stored = await ctx.pool.query<{ user_id: string; portal_account_id: string | null }>(
      "SELECT user_id, portal_account_id FROM push_subscription WHERE id = $1",
      [created.id],
    );
    expect(stored.rows[0]).toEqual({ user_id: nurseId, portal_account_id: null });
    // Another member's browser is not the nurse's.
    expect((await me(admin).get("").expect(200)).body.devices).toEqual([]);
    await me(admin).post(`/subscriptions/${created.id}/remove`).expect(404);

    for (let n = 2; n <= 5; n++) await register(nurse, n).expect(201);
    await register(nurse, 6)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("too_many_push_devices"));
    await me(nurse).post(`/subscriptions/${created.id}/remove`).expect(204);
    expect((await me(nurse).get("").expect(200)).body.devices).toHaveLength(4);
    expect((await ctx.pool.query("SELECT revoked_reason FROM push_subscription WHERE id = $1", [created.id])).rows[0]).toEqual({
      revoked_reason: "removed_by_user",
    });
    expect((await auditRows(ctx.pool, "action IN ('auth.push-register', 'auth.push-remove')")).map((e) => e.action)).toEqual([
      "auth.push-register",
      "auth.push-register",
      "auth.push-register",
      "auth.push-register",
      "auth.push-register",
      "auth.push-register",
      "auth.push-remove",
    ]);
  });

  it("sends a test to the member's browsers with nothing but a title, a line and a page", async () => {
    const before = transport.sent.length;
    expect((await me(nurse).post("/test").expect(202)).body.status).toBe("queued");
    const [row] = (await rows(nurseId, "staff.push-test")).slice(-1);
    expect(row).toMatchObject({ channel: "push", status: "queued", destination: nurseId });
    await expect(dispatcher.dispatch(row!.id)).resolves.toBe("sent");
    const sent = transport.sent.slice(before);
    expect(sent).toHaveLength(4);
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({ title: "Notifications are on", url: "/notifications" });
  });

  it("mirrors an in-app notice to the member's browsers with content-free wording, and never one without a browser", async () => {
    const actor = systemActor(tenant.organizationId, tenant.facilityId, "test");
    const inApp = await notifications.send(actor, {
      recipient: { type: "user", userId: nurseId },
      channel: "in_app",
      templateKey: "records.request-new",
      variables: { requestId: REQUEST_ID, requestNumber: "RR00000042" },
      idempotencyKey: "records-request:RR00000042",
    });
    expect(inApp.status).toBe("delivered");
    const mirrored = await rows(nurseId, "records.request-new");
    expect(mirrored.map((r) => [r.channel, r.status])).toEqual([
      ["in_app", "delivered"],
      ["push", "queued"],
    ]);
    // Sending the same notice again (at-least-once handlers) adds nothing.
    await notifications.send(actor, {
      recipient: { type: "user", userId: nurseId },
      channel: "in_app",
      templateKey: "records.request-new",
      variables: { requestId: REQUEST_ID, requestNumber: "RR00000042" },
      idempotencyKey: "records-request:RR00000042",
    });
    expect(await rows(nurseId, "records.request-new")).toHaveLength(2);
    const before = transport.sent.length;
    await expect(dispatcher.dispatch(mirrored[1]!.id)).resolves.toBe("sent");
    const payload = JSON.parse(transport.sent[before]!.payload) as { title: string; body: string; url: string };
    expect(payload).toEqual({
      title: "New records request",
      body: "A patient asked for copies of their records. Open the request to answer it.",
      url: `/records/requests/${REQUEST_ID}`,
    });
    expect(JSON.stringify(payload)).not.toContain("RR00000042");

    // A critical-result notice pushes neither the patient number nor the order number.
    await notifications.send(actor, {
      recipient: { type: "user", userId: nurseId },
      channel: "in_app",
      templateKey: "lab.result-notice",
      variables: { kind: "critical", orderNumber: "LO00000007", patientNumber: "P00000009" },
    });
    const [, critical] = await rows(nurseId, "lab.result-notice");
    await expect(dispatcher.dispatch(critical!.id)).resolves.toBe("sent");
    const criticalPayload = transport.sent.at(-1)!.payload;
    expect(criticalPayload).not.toMatch(/LO0000|P0000/);
    expect(JSON.parse(criticalPayload)).toMatchObject({ title: "Critical laboratory result", url: "/laboratory/critical" });

    // Free text written by staff stays in the app.
    await notifications.send(actor, {
      recipient: { type: "user", userId: nurseId },
      channel: "in_app",
      templateKey: "staff.message",
      variables: { title: "Hi", body: "Secret" },
    });
    expect((await rows(nurseId, "staff.message")).map((r) => r.channel)).toEqual(["in_app"]);

    // The administrator has no browser: the in-app notice alone, no suppressed push row.
    await notifications.send(actor, {
      recipient: { type: "user", userId: adminId },
      channel: "in_app",
      templateKey: "records.request-new",
      variables: { requestId: REQUEST_ID, requestNumber: "RR00000042" },
    });
    expect((await rows(adminId, "records.request-new")).map((r) => r.channel)).toEqual(["in_app"]);
  });

  it("sends nothing to a suspended member, and the member's browsers stay for their return", async () => {
    await ctx.pool.query("UPDATE organization_membership SET status = 'suspended' WHERE user_id = $1 AND organization_id = $2", [
      nurseId,
      tenant.organizationId,
    ]);
    const actor = systemActor(tenant.organizationId, tenant.facilityId, "test");
    await notifications.send(actor, {
      recipient: { type: "user", userId: nurseId },
      channel: "in_app",
      templateKey: "portal.message-overdue",
      variables: { threadId: REQUEST_ID },
    });
    const overdue = await rows(nurseId, "portal.message-overdue");
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({ channel: "in_app", status: "suppressed", suppression_reason: "user_not_member" });
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM push_subscription WHERE user_id = $1 AND revoked_at IS NULL", [nurseId])).rows[0]).toEqual({
      n: 4,
    });
    await ctx.pool.query("UPDATE organization_membership SET status = 'active' WHERE user_id = $1 AND organization_id = $2", [nurseId, tenant.organizationId]);
  });

  it("lets a member turn a kind of notice off in their browsers: the in-app notice still arrives, no push row is written, and on again pushes", async () => {
    const status = (await me(nurse).get("").expect(200)).body as { preferences: Array<{ kind: string; label: string; enabled: boolean }> };
    expect(status.preferences.map((p) => p.kind)).toEqual([
      "records_requests",
      "patient_messages",
      "referrals",
      "laboratory_results",
      "laboratory_quality",
      "documents",
      "management_reports",
    ]);
    expect(status.preferences.every((p) => p.enabled)).toBe(true);
    await me(nurse)
      .put("/preferences", { preferences: [{ kind: "not-a-kind", enabled: false }] })
      .expect(400);
    const set = (
      await me(nurse)
        .put("/preferences", { preferences: [{ kind: "laboratory_quality", enabled: false }] })
        .expect(200)
    ).body;
    expect(set.preferences.find((p: { kind: string }) => p.kind === "laboratory_quality")).toMatchObject({ enabled: false });
    expect(set.preferences.find((p: { kind: string }) => p.kind === "laboratory_results")).toMatchObject({ enabled: true });
    expect(await auditRows(ctx.pool, "action = 'auth.push-preferences'")).toHaveLength(1);

    const actor = systemActor(tenant.organizationId, tenant.facilityId, "test");
    const quality = () =>
      notifications.send(actor, {
        recipient: { type: "user", userId: nurseId },
        channel: "in_app",
        templateKey: "lab.quality-notice",
        variables: { kind: "nonconformance", nonconformanceId: REQUEST_ID, number: "NC00000001", category: "equipment", severity: "major" },
      });
    await quality();
    expect((await rows(nurseId, "lab.quality-notice")).map((r) => r.channel)).toEqual(["in_app"]);
    // Other kinds are unaffected, and so is the test push.
    await notifications.send(actor, {
      recipient: { type: "user", userId: nurseId },
      channel: "in_app",
      templateKey: "clinic.referral-notice",
      variables: { kind: "new", referralId: REQUEST_ID, referralNumber: "RF00000001" },
    });
    expect((await rows(nurseId, "clinic.referral-notice")).map((r) => r.channel)).toEqual(["in_app", "push"]);
    expect((await me(nurse).post("/test").expect(202)).body.status).toBe("queued");

    await me(nurse)
      .put("/preferences", { preferences: [{ kind: "laboratory_quality", enabled: true }] })
      .expect(200);
    await quality();
    expect((await rows(nurseId, "lab.quality-notice")).map((r) => r.channel)).toEqual(["in_app", "in_app", "push"]);
  });

  it("holds every row to exactly one owner", async () => {
    await expect(
      ctx.pool.query("INSERT INTO push_subscription (organization_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)", [
        tenant.organizationId,
        endpoint(50),
        keys.p256dh,
        keys.auth,
      ]),
    ).rejects.toThrow(/push_subscription_one_owner/);
  });
});
