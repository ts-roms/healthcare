import { Test } from "@nestjs/testing";
import { CoreModule, localDate } from "@healthcare/core";
import {
  CHANNEL_SENDERS,
  type ChannelSender,
  LoggingSender,
  NOTIFICATION_QUEUE,
  NotificationDispatcher,
  NotificationWorkerModule,
} from "@healthcare/notification";
import { as, auditRows, createStaff, createTenant, createTestApp, juan, login, type Tenant, type TestContext } from "./harness";

class FailingSender implements ChannelSender {
  readonly channel = "email" as const;
  async send(): Promise<never> {
    throw new Error("SMTP unavailable");
  }
}

describe("notifications", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let token: string;
  let patientId: string;
  let dispatcher: NotificationDispatcher;
  let closeWorker: () => Promise<void>;
  const sms = new LoggingSender("sms");

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "notify-org");
    await createStaff(ctx.pool, tenant, "desk@example.ph", ["receptionist"]);
    token = (await login(ctx, "desk@example.ph")).accessToken;
    const created = await ctx
      .http()
      .post("/api/v1/patients")
      .set(as(token, tenant.facilityId))
      .send({ ...juan, contacts: [...juan.contacts, { system: "email", value: "juan@example.ph" }] })
      .expect(201);
    patientId = created.body.id;

    const worker = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot(ctx.config),
        NotificationWorkerModule.forRoot({
          autoStart: false,
          queue: { provide: NOTIFICATION_QUEUE, useValue: ctx.queue },
          senders: { provide: CHANNEL_SENDERS, useValue: [sms, new FailingSender()] },
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

  const registered = { givenName: "Juan", organizationName: "Demo Health", patientNumber: "P00000001" };
  const send = (body: object) => ctx.http().post("/api/v1/notifications").set(as(token)).send(body);

  it("queues, delivers and tracks an SMS", async () => {
    const response = await send({
      recipient: { type: "patient", patientId },
      channel: "sms",
      templateKey: "patient.registered",
      variables: registered,
    }).expect(201);
    expect(response.body).toMatchObject({ status: "queued", destinationMasked: "********4567" });
    expect(response.body).not.toHaveProperty("destination");
    expect(ctx.queue.enqueued).toContain(response.body.id);

    await expect(dispatcher.dispatch(response.body.id)).resolves.toBe("sent");
    await expect(dispatcher.dispatch(response.body.id)).resolves.toBe("skipped");
    expect(sms.sent.at(-1)).toMatchObject({ destination: "+639171234567", message: { text: expect.stringContaining("P00000001") } });
    const row = await ctx.pool.query(`SELECT status, attempt_count, provider FROM notification WHERE id = $1`, [response.body.id]);
    expect(row.rows[0]).toEqual({ status: "sent", attempt_count: 1, provider: "log" });
  });

  it("retries failed deliveries and gives up after the maximum attempts", async () => {
    const response = await send({
      recipient: { type: "patient", patientId },
      channel: "email",
      templateKey: "patient.registered",
      variables: registered,
    }).expect(201);
    await ctx.pool.query(`UPDATE notification SET max_attempts = 2 WHERE id = $1`, [response.body.id]);
    await expect(dispatcher.dispatch(response.body.id)).resolves.toBe("retry");
    await expect(dispatcher.dispatch(response.body.id)).resolves.toBe("failed");
    const attempts = await ctx.pool.query(
      `SELECT attempt_number, outcome, error FROM notification_attempt WHERE notification_id = $1 ORDER BY attempt_number`,
      [response.body.id],
    );
    expect(attempts.rows).toEqual([
      { attempt_number: 1, outcome: "failed", error: "SMTP unavailable" },
      { attempt_number: 2, outcome: "failed", error: "SMTP unavailable" },
    ]);
    const row = await ctx.pool.query(`SELECT status, last_error FROM notification WHERE id = $1`, [response.body.id]);
    expect(row.rows[0]).toEqual({ status: "failed", last_error: "SMTP unavailable" });
  });

  it("suppresses messages the patient has not allowed, and records them", async () => {
    await ctx
      .http()
      .put(`/api/v1/patients/${patientId}/communication-preferences`)
      .set(as(token))
      .send({ preferences: [{ channel: "sms", category: "administrative", optedIn: false }] })
      .expect(200);
    const optedOut = await send({
      recipient: { type: "patient", patientId },
      channel: "sms",
      templateKey: "patient.registered",
      variables: registered,
    }).expect(201);
    expect(optedOut.body).toMatchObject({ status: "suppressed", suppressionReason: "opted_out" });
    expect(ctx.queue.enqueued).not.toContain(optedOut.body.id);
  });

  it("rejects free text outside the platform and invalid variables", async () => {
    const external = await send({
      recipient: { type: "patient", patientId },
      channel: "sms",
      templateKey: "staff.message",
      variables: { title: "Hi", body: "Your results show…" },
    }).expect(422);
    expect(external.body.error.code).toBe("channel_not_supported");
    const invalid = await send({
      recipient: { type: "patient", patientId },
      channel: "sms",
      templateKey: "patient.registered",
      variables: { givenName: "Juan" },
    }).expect(422);
    expect(invalid.body.error.code).toBe("invalid_template_variables");
  });

  it("deduplicates by idempotency key and delivers in-app messages to staff inboxes", async () => {
    const userId = (await ctx.pool.query(`SELECT id FROM app_user WHERE email = 'desk@example.ph'`)).rows[0].id;
    const body = {
      recipient: { type: "user", userId },
      channel: "in_app",
      templateKey: "staff.message",
      variables: { title: "Shift", body: "Clinic opens at 7 AM tomorrow." },
      idempotencyKey: "shift-notice-1",
    };
    const first = await send(body).expect(201);
    const second = await send(body).expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(first.body.status).toBe("delivered");

    const inbox = await ctx.http().get("/api/v1/me/notifications").set(as(token)).expect(200);
    expect(inbox.body).toEqual([expect.objectContaining({ id: first.body.id, subject: "Shift", readAt: null })]);
    await ctx.http().post(`/api/v1/me/notifications/${first.body.id}/read`).set(as(token)).expect(204);
  });

  it("shows the communication history of a patient to authorized staff only", async () => {
    await createStaff(ctx.pool, tenant, "cashier@example.ph", ["cashier"]);
    const cashier = await login(ctx, "cashier@example.ph");
    await ctx.http().get(`/api/v1/notifications?patientId=${patientId}`).set(as(cashier.accessToken)).expect(403);
    await createStaff(ctx.pool, tenant, "doctor@example.ph", ["physician"]);
    const doctor = await login(ctx, "doctor@example.ph");
    const history = await ctx.http().get(`/api/v1/notifications?patientId=${patientId}`).set(as(doctor.accessToken)).expect(200);
    expect(history.body.length).toBe(3);
    expect(history.body[0]).toMatchObject({ templateKey: "patient.registered", templateLabel: "Welcome after registration" });
    expect(history.body[0]).not.toHaveProperty("variables");
    // Receptionists may read it too (migration 0084).
    await ctx.http().get(`/api/v1/notifications?patientId=${patientId}`).set(as(token)).expect(200);
  });

  it("lists messages to patients in the communication log, with counts and a CSV, never their content", async () => {
    const today = localDate(new Date(), "Asia/Manila");
    const log = (q: string, t = token) => ctx.http().get(`/api/v1/communications?from=${today}&to=${today}${q}`).set(as(t));
    const cashier = await login(ctx, "cashier@example.ph");
    await log("", cashier.accessToken).expect(403);
    await ctx.http().get(`/api/v1/communications?from=${today}&to=2000-01-01`).set(as(token)).expect(400);
    await ctx.http().get(`/api/v1/communications?from=2026-01-01&to=2026-06-30`).set(as(token)).expect(400);

    const all = await log("").expect(200);
    // The three messages to the patient; the staff inbox message is not part of the log.
    expect(all.body).toMatchObject({ page: 1, hasMore: false });
    expect(all.body.items.map((i: { status: string }) => i.status).sort()).toEqual(["failed", "sent", "suppressed"]);
    const suppressed = all.body.items.find((i: { status: string }) => i.status === "suppressed");
    expect(suppressed).toMatchObject({
      patient: { id: patientId, patientNumber: expect.stringMatching(/^P\d{8}$/), displayName: expect.stringContaining("Juan") },
      channel: "sms",
      category: "administrative",
      templateLabel: "Welcome after registration",
      suppressionReason: "opted_out",
      requestedByName: expect.any(String),
    });
    expect(JSON.stringify(all.body)).not.toMatch(/Your patient number is|variables|juan@example\.ph|\+639171234567/);

    const notSent = await log("&status=not_sent").expect(200);
    expect(notSent.body.items.map((i: { status: string }) => i.status).sort()).toEqual(["failed", "suppressed"]);
    expect((await log("&channel=email").expect(200)).body.items).toHaveLength(1);
    expect((await log(`&patientId=${patientId}&templateKey=patient.registered`).expect(200)).body.items).toHaveLength(3);
    expect((await log("&pageSize=2").expect(200)).body).toMatchObject({ hasMore: true });

    const summary = await ctx.http().get(`/api/v1/communications/summary?from=${today}&to=${today}`).set(as(token)).expect(200);
    expect(summary.body).toMatchObject({
      total: 3,
      byStatus: { sent: 1, failed: 1, suppressed: 1, delivered: 0 },
      suppressedByReason: [{ reason: "opted_out", total: 1 }],
      byTemplate: [{ templateKey: "patient.registered", total: 3, notSent: 2 }],
    });
    expect(summary.body.byChannel).toEqual(
      expect.arrayContaining([
        { channel: "sms", total: 2, sent: 1, notSent: 1 },
        { channel: "email", total: 1, sent: 0, notSent: 1 },
      ]),
    );

    const csv = await ctx.http().get(`/api/v1/communications/export?from=${today}&to=${today}`).set(as(token)).expect(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.text).toContain("Welcome after registration");
    expect(csv.text).toContain("opted_out");
    expect(csv.text).not.toMatch(/Your patient number is|\+639171234567/);

    const audits = await auditRows(ctx.pool, "action LIKE 'notification.log.%'");
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["notification.log.view", "notification.log.export"]));
    expect(audits.find((a) => a.action === "notification.log.export")?.metadata).toMatchObject({ rows: 3, truncated: false });
  });
});
