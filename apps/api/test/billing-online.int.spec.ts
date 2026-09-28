import { createHmac } from "node:crypto";
import type { CheckoutRequest, CheckoutSession, PaymentGateway, ProviderPaymentEvent } from "@healthcare/billing";
import { PAYMENT_GATEWAY } from "@healthcare/billing";
import { as, auditRows, createStaff, createTenant, createTestApp, login, manilaDate, type Tenant, type TestContext } from "./harness";

const SECRET = "fake-provider-secret";
const PORTAL = "https://myhealth.example.ph";

/** A stand-in payment provider: hosted checkout addresses and HMAC-signed notifications. */
class FakePaymentGateway implements PaymentGateway {
  readonly specification = { provider: "fake-pay", name: "Fake Pay", status: "configured" as const, note: "Test adapter" };
  readonly checkouts: CheckoutRequest[] = [];

  createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    this.checkouts.push(request);
    return Promise.resolve({ providerReference: `fp_${request.intentId}`, checkoutUrl: `https://pay.example/checkout/${request.intentId}` });
  }

  verifyNotification(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): Promise<ProviderPaymentEvent | null> {
    const expected = createHmac("sha256", SECRET).update(rawBody).digest("hex");
    return Promise.resolve(headers["x-fake-signature"] === expected ? (JSON.parse(rawBody.toString("utf8")) as ProviderPaymentEvent) : null);
  }
}

/**
 * Online payment from MyHealth through the payment provider port: start
 * (idempotent, within the balance, returning to a platform origin) → the
 * provider's signed notification completes it once → payment in the ledger,
 * or a deposit for what exceeds a balance paid meanwhile.
 */
describe("billing online payment", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let cashier: string;
  let patientToken: string;
  let invoiceId: string;
  let patientId: string;
  const gateway = new FakePaymentGateway();

  const req = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const portal = {
    get: (url: string) =>
      ctx
        .http()
        .get(`/api/v1${url}`)
        .set({ authorization: `Bearer ${patientToken}` }),
    post: (url: string, body: object) =>
      ctx
        .http()
        .post(`/api/v1${url}`)
        .set({ authorization: `Bearer ${patientToken}` })
        .send(body),
  };
  const notify = (event: ProviderPaymentEvent, signature?: string) => {
    const body = JSON.stringify(event);
    return ctx
      .http()
      .post("/api/v1/billing/online-payments/notifications")
      .set({ "content-type": "application/json", "x-fake-signature": signature ?? createHmac("sha256", SECRET).update(body).digest("hex") })
      .send(body);
  };
  const start = (amount: number, idempotencyKey: string, returnUrl = `${PORTAL}/billing`) =>
    portal.post(`/portal/billing/${invoiceId}/online-payments`, { amount, idempotencyKey, returnUrl });

  beforeAll(async () => {
    ctx = await createTestApp({ paymentGateway: { provide: PAYMENT_GATEWAY, useValue: gateway } }, { CORS_ORIGINS: `http://localhost:3000,${PORTAL}` });
    tenant = await createTenant(ctx.pool, "online-org");
    await createStaff(ctx.pool, tenant, "admin@online.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "cashier@online.ph", ["cashier"]);
    admin = (await login(ctx, "admin@online.ph")).accessToken;
    cashier = (await login(ctx, "cashier@online.ph")).accessToken;
    const service = (
      await req(admin)
        .post("/billing/services", { code: "consult", name: "Consultation fee", category: "consultation", unitPrice: 50_000, effectiveFrom: manilaDate(-30) })
        .expect(201)
    ).body.id;
    const patient = (
      await req(admin)
        .post("/patients", {
          familyName: "Cruz",
          givenName: "Maria",
          sex: "female",
          birthDate: "1990-05-05",
          contacts: [{ system: "mobile", value: "0917 666 0505" }],
        })
        .expect(201)
    ).body;
    patientId = patient.id;
    await req(cashier).post("/billing/charges", { patientId, serviceId: service }).expect(201);
    const draft = await req(cashier).post("/billing/invoices", { patientId }).expect(201);
    invoiceId = (await req(cashier).post(`/billing/invoices/${draft.body.id}/issue`, { version: draft.body.version }).expect(200)).body.id;

    await req(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await req(admin).post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({
        organizationCode: "online-org",
        patientNumber: patient.patientNumber,
        birthDate: "1990-05-05",
        activationCode: code,
        email: "maria@online.ph",
        password: "Maaraw-na-umaga-2026",
      })
      .expect(200);
    patientToken = (
      await ctx
        .http()
        .post("/api/v1/portal/auth/login")
        .send({ organizationCode: "online-org", email: "maria@online.ph", password: "Maaraw-na-umaga-2026" })
        .expect(200)
    ).body.accessToken;
  });

  afterAll(() => ctx.close());

  it("starts a payment within the balance, returning only to a platform origin, once per key", async () => {
    expect((await portal.get("/portal/billing/online-payment").expect(200)).body).toMatchObject({ available: true, name: "Fake Pay" });
    await start(20_000, "online-0001", "https://evil.example/steal")
      .expect(400)
      .expect((r) => expect(r.body.error.code).toBe("return_url_invalid"));
    await start(50_001, "online-0002")
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("payment_exceeds_balance"));
    const started = await start(20_000, "online-0003").expect(201);
    expect(started.body).toMatchObject({ status: "pending", amount: 20_000, provider: "fake-pay", providerReference: `fp_${started.body.id}` });
    expect(started.body.checkoutUrl).toBe(`https://pay.example/checkout/${started.body.id}`);
    expect(gateway.checkouts.at(-1)).toMatchObject({ amount: 20_000, currency: "PHP", description: `Invoice INV-${new Date().getFullYear()}-000001` });
    expect((await start(20_000, "online-0003").expect(201)).body.id).toBe(started.body.id);
    const audit = await auditRows(ctx.pool, "action = 'portal.online-payment.start'");
    expect(audit[0]).toMatchObject({ actor_type: "patient", patient_id: patientId });
  });

  it("records the payment once from the provider's verified notification", async () => {
    const [intent] = (await ctx.pool.query(`SELECT id, provider_reference FROM billing_payment_intent WHERE invoice_id = $1`, [invoiceId])).rows;
    const event: ProviderPaymentEvent = {
      providerReference: intent.provider_reference,
      outcome: "succeeded",
      method: "e_wallet",
      externalReference: "GC-7788",
    };
    await notify(event, "forged")
      .expect(400)
      .expect((r) => expect(r.body.error.code).toBe("notification_not_verified"));
    await notify(event).expect(200);
    await notify(event).expect(200);
    const invoice = await req(cashier).get(`/billing/invoices/${invoiceId}`).expect(200);
    expect(invoice.body).toMatchObject({ paidTotal: 20_000, balance: 30_000 });
    expect(invoice.body.payments).toEqual([
      expect.objectContaining({ amount: 20_000, method: "e_wallet", reference: "GC-7788", recordedBy: null, paymentIntentId: intent.id }),
    ]);
    expect(invoice.body.onlinePayments).toEqual([expect.objectContaining({ status: "succeeded", paidAmount: 20_000 })]);
    expect((await portal.get(`/portal/billing/online-payments/${intent.id}`).expect(200)).body).toMatchObject({ status: "succeeded" });
  });

  it("closes a failed payment without recording anything", async () => {
    const started = await start(5_000, "online-0004").expect(201);
    await notify({ providerReference: started.body.providerReference, outcome: "failed", failureCode: "card_declined" }).expect(200);
    expect((await portal.get(`/portal/billing/online-payments/${started.body.id}`).expect(200)).body).toMatchObject({
      status: "failed",
      failureCode: "card_declined",
    });
    expect((await req(cashier).get(`/billing/invoices/${invoiceId}`).expect(200)).body.balance).toBe(30_000);
  });

  it("keeps what exceeds a balance paid meanwhile at the counter as a deposit", async () => {
    const started = await start(30_000, "online-0005").expect(201);
    await req(cashier).post(`/billing/invoices/${invoiceId}/payments`, { amount: 30_000, method: "cash", idempotencyKey: "counter-0001" }).expect(201);
    await notify({ providerReference: started.body.providerReference, outcome: "succeeded", method: "card" }).expect(200);
    const invoice = await req(cashier).get(`/billing/invoices/${invoiceId}`).expect(200);
    expect(invoice.body).toMatchObject({ paidTotal: 50_000, balance: 0 });
    const account = await req(cashier).get(`/billing/patients/${patientId}/account`).expect(200);
    expect(account.body).toMatchObject({ balance: 30_000, entries: [expect.objectContaining({ kind: "deposit", method: "card", recordedBy: null })] });
    // Nothing is left to pay online.
    await start(1, "online-0006")
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("payment_exceeds_balance"));
  });
});
