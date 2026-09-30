import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { as, createStaff, createTenant, createTestApp, manilaDate, login, type Tenant, type TestContext } from "./harness";

const PORTAL = "https://myhealth.example.ph";
const SECRET_KEY = "sk_test_platformTest123";
const WEBHOOK_SECRET = "whsk_platform_test_secret";

/**
 * Online payment through the PayMongo adapter, selected by configuration (docs/domains/billing.md, "Online payment —
 * PayMongo"). PayMongo is replaced by a local HTTP server standing in for `POST /v1/checkout_sessions`; the webhook is
 * signed as PayMongo documents it. This tests the platform's side only — not PayMongo itself.
 */
describe("billing online payment through PayMongo", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let cashier: string;
  let patientToken: string;
  let invoiceId: string;
  let mock: Server;
  const received: Array<{ method?: string; url?: string; authorization?: string; body: unknown }> = [];

  const portal = (url: string, body: object) =>
    ctx
      .http()
      .post(`/api/v1${url}`)
      .set({ authorization: `Bearer ${patientToken}` })
      .send(body);
  const webhook = (event: object, options: { secret?: string; t?: number } = {}) => {
    const body = JSON.stringify(event);
    const t = options.t ?? Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", options.secret ?? WEBHOOK_SECRET)
      .update(`${t}.${body}`)
      .digest("hex");
    return ctx
      .http()
      .post("/api/v1/billing/online-payments/notifications")
      .set({ "content-type": "application/json", "paymongo-signature": `t=${t},te=${sig},li=` })
      .send(body);
  };
  const paid = (sessionId: string) => ({
    data: { id: "evt_test_1", type: "event", attributes: { type: "checkout_session.payment.paid", livemode: false, data: { id: sessionId } } },
  });

  beforeAll(async () => {
    mock = createServer((req: IncomingMessage, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
      req.on("end", () => {
        received.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: JSON.parse(raw || "{}") });
        const id = `cs_test_${received.length}`;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { id, type: "checkout_session", attributes: { checkout_url: `https://checkout.paymongo.com/${id}` } } }));
      });
    });
    await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
    const port = (mock.address() as AddressInfo).port;

    ctx = await createTestApp(
      {},
      {
        CORS_ORIGINS: `http://localhost:3000,${PORTAL}`,
        PAYMONGO_SECRET_KEY: SECRET_KEY,
        PAYMONGO_WEBHOOK_SECRET: WEBHOOK_SECRET,
        PAYMONGO_PAYMENT_METHODS: "card,gcash,paymaya",
        PAYMONGO_API_BASE: `http://127.0.0.1:${port}/v1`,
      },
    );
    tenant = await createTenant(ctx.pool, "paymongo-org");
    await createStaff(ctx.pool, tenant, "admin@paymongo.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "cashier@paymongo.ph", ["cashier"]);
    const admin = (await login(ctx, "admin@paymongo.ph")).accessToken;
    cashier = (await login(ctx, "cashier@paymongo.ph")).accessToken;
    const staff = (token: string, url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body);
    const service = (
      await staff(admin, "/billing/services", {
        code: "consult",
        name: "Consultation fee",
        category: "consultation",
        unitPrice: 50_000,
        effectiveFrom: manilaDate(-30),
      }).expect(201)
    ).body.id;
    const patient = (
      await staff(admin, "/patients", {
        familyName: "Reyes",
        givenName: "Ana",
        sex: "female",
        birthDate: "1988-03-03",
        contacts: [{ system: "mobile", value: "0917 555 0303" }],
      }).expect(201)
    ).body;
    await staff(cashier, "/billing/charges", { patientId: patient.id, serviceId: service }).expect(201);
    const draft = await staff(cashier, "/billing/invoices", { patientId: patient.id }).expect(201);
    invoiceId = (await staff(cashier, `/billing/invoices/${draft.body.id}/issue`, { version: draft.body.version }).expect(200)).body.id;
    await staff(admin, `/patients/${patient.id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await staff(admin, `/patients/${patient.id}/portal-account/invitations`).expect(201)).body.activationCode;
    patientToken = (
      await ctx
        .http()
        .post("/api/v1/portal/auth/activate")
        .send({
          organizationCode: "paymongo-org",
          patientNumber: patient.patientNumber,
          birthDate: "1988-03-03",
          activationCode: code,
          email: "ana@paymongo.ph",
          password: "Bayad-online-2026",
        })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await ctx.close();
    await new Promise((resolve) => mock.close(resolve));
  });

  it("is offered to patients once configured", async () => {
    const offered = await ctx
      .http()
      .get("/api/v1/portal/billing/online-payment")
      .set({ authorization: `Bearer ${patientToken}` })
      .expect(200);
    expect(offered.body).toMatchObject({ available: true, name: "PayMongo" });
  });

  it("creates a PayMongo checkout session for the amount, with the secret key, and sends the patient there", async () => {
    const started = await portal(`/portal/billing/${invoiceId}/online-payments`, {
      amount: 30_000,
      idempotencyKey: "paymongo-0001",
      returnUrl: `${PORTAL}/billing`,
    }).expect(201);
    expect(started.body).toMatchObject({
      status: "pending",
      provider: "paymongo",
      providerReference: "cs_test_1",
      checkoutUrl: "https://checkout.paymongo.com/cs_test_1",
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      method: "POST",
      url: "/v1/checkout_sessions",
      authorization: `Basic ${Buffer.from(`${SECRET_KEY}:`).toString("base64")}`,
    });
    expect(received[0]!.body).toMatchObject({
      data: {
        attributes: {
          line_items: [expect.objectContaining({ quantity: 1, amount: 30_000, currency: "PHP" })],
          payment_method_types: ["card", "gcash", "paymaya"],
          success_url: `${PORTAL}/billing`,
          reference_number: started.body.id,
        },
      },
    });
  });

  it("records the payment once from a signed checkout_session.payment.paid webhook, and refuses forged or stale ones", async () => {
    await webhook(paid("cs_test_1"), { secret: "not-the-secret" })
      .expect(400)
      .expect((r) => expect(r.body.error.code).toBe("notification_not_verified"));
    await webhook(paid("cs_test_1"), { t: Math.floor(Date.now() / 1000) - 3600 }).expect(400);
    await webhook(paid("cs_test_1")).expect(200);
    await webhook(paid("cs_test_1")).expect(200);
    const invoice = await ctx.http().get(`/api/v1/billing/invoices/${invoiceId}`).set(as(cashier, tenant.facilityId)).expect(200);
    expect(invoice.body).toMatchObject({ paidTotal: 30_000, balance: 20_000 });
    expect(invoice.body.payments).toEqual([expect.objectContaining({ amount: 30_000, recordedBy: null })]);
    expect(invoice.body.onlinePayments).toEqual([expect.objectContaining({ status: "succeeded", provider: "paymongo" })]);
  });

  it("does not act on other events", async () => {
    await webhook({ data: { id: "evt_2", attributes: { type: "payment.paid", data: { id: "pay_1" } } } }).expect(400);
  });
});
