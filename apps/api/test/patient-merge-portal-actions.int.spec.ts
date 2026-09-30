import type { CheckoutRequest, CheckoutSession, PaymentGateway, ProviderPaymentEvent } from "@healthcare/billing";
import { PAYMENT_GATEWAY } from "@healthcare/billing";
import { as, createClinician, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

const PATIENT_PASSWORD = "Maaraw-na-umaga-2026";
const PORTAL = "https://myhealth.example.ph";

class FakePaymentGateway implements PaymentGateway {
  readonly specification = { provider: "fake-pay", name: "Fake Pay", status: "configured" as const, note: "Test adapter" };

  createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    return Promise.resolve({ providerReference: `fp_${request.intentId}`, checkoutUrl: `https://pay.example/checkout/${request.intentId}` });
  }

  verifyNotification(): Promise<ProviderPaymentEvent | null> {
    return Promise.resolve(null);
  }
}

/**
 * After a merge ("link, don't move", docs/domains/patient.md) MyHealth lists what is filed under the retired record
 * with the survivor's; the patient can also act on it: pay its invoices online, read payments started before the
 * merge and decide its dental plans. Another patient still cannot.
 */
describe("MyHealth actions on records filed under a merged duplicate", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let records: string;
  let cashier: string;
  let dentist: string;
  let retiredId: string;
  let survivorId: string;
  let otherToken: string;
  let invoiceId: string;
  let planId: string;
  let planItemId: string;
  let intentBeforeMerge: string;

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const portal = (token: string) => ({
    get: (url: string) =>
      ctx
        .http()
        .get(`/api/v1/portal${url}`)
        .set({ authorization: `Bearer ${token}` }),
    post: (url: string, body: object) =>
      ctx
        .http()
        .post(`/api/v1/portal${url}`)
        .set({ authorization: `Bearer ${token}` })
        .send(body),
  });
  const register = async (body: object) => {
    const first = await api(admin).post("/patients", body);
    if (first.status === 201) return first.body as { id: string; patientNumber: string };
    const candidates = (first.body.error.details?.candidates ?? []) as Array<{ patient: { id: string } }>;
    return (
      await api(admin)
        .post("/patients", {
          ...body,
          duplicateOverride: { reviewedCandidateIds: candidates.map((c) => c.patient.id), reason: "Registered in a hurry at the front desk" },
        })
        .expect(201)
    ).body as { id: string; patientNumber: string };
  };
  const activate = async (patient: { id: string; patientNumber: string }, birthDate: string, email: string) => {
    await api(admin).post(`/patients/${patient.id}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const code = (await api(admin).post(`/patients/${patient.id}/portal-account/invitations`).expect(201)).body.activationCode;
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({ organizationCode: "merge-act", patientNumber: patient.patientNumber, birthDate, activationCode: code, email, password: PATIENT_PASSWORD })
      .expect(200);
  };
  const signIn = async (email: string) =>
    (await ctx.http().post("/api/v1/portal/auth/login").send({ organizationCode: "merge-act", email, password: PATIENT_PASSWORD }).expect(200)).body
      .accessToken as string;
  const pay = (token: string, amount: number, idempotencyKey: string) =>
    portal(token).post(`/billing/${invoiceId}/online-payments`, { amount, idempotencyKey, returnUrl: `${PORTAL}/billing` });
  const decide = (token: string) =>
    portal(token).post(`/dental/plans/${planId}/decision`, { acceptedItemIds: [planItemId], awaitingItemIds: [planItemId], acknowledged: true });

  beforeAll(async () => {
    ctx = await createTestApp(
      { paymentGateway: { provide: PAYMENT_GATEWAY, useValue: new FakePaymentGateway() } },
      { CORS_ORIGINS: `http://localhost:3000,${PORTAL}` },
    );
    tenant = await createTenant(ctx.pool, "merge-act");
    await createStaff(ctx.pool, tenant, "admin@merge-act.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "records@merge-act.ph", ["records_officer"]);
    await createStaff(ctx.pool, tenant, "cashier@merge-act.ph", ["cashier"]);
    await createClinician(ctx, tenant, "dentist@merge-act.ph", ["dentist"], "dentist");
    admin = (await login(ctx, "admin@merge-act.ph")).accessToken;
    records = (await login(ctx, "records@merge-act.ph")).accessToken;
    cashier = (await login(ctx, "cashier@merge-act.ph")).accessToken;
    dentist = (await login(ctx, "dentist@merge-act.ph")).accessToken;

    // The duplicate holds the MyHealth account, an issued invoice and a dental plan awaiting the patient's decision.
    const survivor = await register(juan);
    survivorId = survivor.id;
    const retired = await register({ familyName: "Dela Cruz", givenName: "Juan", middleName: "Santo", sex: "male", birthDate: juan.birthDate });
    retiredId = retired.id;
    await activate(retired, juan.birthDate, "juan@merge-act.ph");
    await api(admin).post(`/patients/${survivorId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const other = await register({ familyName: "Reyes", givenName: "Maria", sex: "female", birthDate: "1991-07-19" });
    await activate(other, "1991-07-19", "maria@merge-act.ph");
    otherToken = await signIn("maria@merge-act.ph");

    const service = (
      await api(admin)
        .post("/billing/services", { code: "consult", name: "Consultation fee", category: "consultation", unitPrice: 50_000, effectiveFrom: manilaDate(-30) })
        .expect(201)
    ).body.id;
    await api(cashier).post("/billing/charges", { patientId: retiredId, serviceId: service }).expect(201);
    const draft = await api(cashier).post("/billing/invoices", { patientId: retiredId }).expect(201);
    invoiceId = (await api(cashier).post(`/billing/invoices/${draft.body.id}/issue`, { version: draft.body.version }).expect(200)).body.id;

    const extraction = (
      await api(admin).post("/dental/procedure-types", { code: "extraction", name: "Extraction", site: "tooth", chartEffect: "missing" }).expect(201)
    ).body.id;
    const plan = (
      await api(dentist)
        .post("/dental/treatment-plans", { patientId: retiredId, title: "Wisdom tooth", items: [{ procedureTypeId: extraction, tooth: "48" }] })
        .expect(201)
    ).body;
    planId = plan.id;
    planItemId = plan.items[0].id;
    const settings = (await api(admin).get("/dental/settings/portal").expect(200)).body;
    await api(admin)
      .put("/dental/settings/portal", {
        portalDentalRecords: true,
        portalPlanDecisions: true,
        portalPlanAcknowledgement: "I discussed this plan with my dentist and understand its options, risks and fees.",
        version: settings.version,
      })
      .expect(200);

    // A payment started from the duplicate's account before the merge.
    intentBeforeMerge = (await pay(await signIn("juan@merge-act.ph"), 10_000, "before-merge-0001").expect(201)).body.id;

    const preview = (await api(records).get(`/patients/${retiredId}/merge-preview?into=${survivorId}`).expect(200)).body;
    expect(preview.canMerge).toBe(true);
    await api(records)
      .post(`/patients/${retiredId}/merge`, {
        survivorPatientId: survivorId,
        reason: "Same person registered twice",
        retiredVersion: preview.retired.version,
        survivorVersion: preview.survivor.version,
        acknowledgedDifferences: preview.differences.map((d: { code: string }) => d.code),
      })
      .expect(200);
  });

  afterAll(() => ctx.close());

  it("lets the survivor's account pay the duplicate's invoice online and read a payment started before the merge", async () => {
    const token = await signIn("juan@merge-act.ph");
    expect((await portal(token).get("/billing").expect(200)).body.map((i: { id: string }) => i.id)).toContain(invoiceId);
    const started = await pay(token, 20_000, "after-merge-0001").expect(201);
    expect(started.body).toMatchObject({ status: "pending", amount: 20_000 });
    expect((await ctx.pool.query("SELECT patient_id FROM billing_payment_intent WHERE id = $1", [started.body.id])).rows[0].patient_id).toBe(survivorId);
    expect((await portal(token).get(`/billing/online-payments/${intentBeforeMerge}`).expect(200)).body).toMatchObject({ id: intentBeforeMerge });

    await pay(otherToken, 1_000, "other-0001").expect(404);
    await portal(otherToken).get(`/billing/online-payments/${intentBeforeMerge}`).expect(404);
  });

  it("lets the survivor's account decide the duplicate's dental plan; another patient cannot", async () => {
    const token = await signIn("juan@merge-act.ph");
    await decide(otherToken).expect(404);
    const decided = await decide(token).expect(201);
    expect(decided.body).toMatchObject({ id: planId, status: "accepted", decidedIn: "myhealth" });
    expect((await ctx.pool.query("SELECT patient_id FROM dental_treatment_plan WHERE id = $1", [planId])).rows[0].patient_id).toBe(retiredId);
  });
});
