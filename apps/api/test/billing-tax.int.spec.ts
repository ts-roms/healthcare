import { extractPdfText } from "@healthcare/pdf";
import { as, auditRows, binary, createStaff, createTenant, createTestApp, login, manilaDate, type Tenant, type TestContext } from "./harness";

/**
 * BIR as configuration: the organization's tax profile (registered name, TIN,
 * VAT status and rate it enters itself) and VAT classes of services → a VAT
 * breakdown snapshot on issue, printed and immutable; number series limits;
 * and deposits usable across the organization's facilities (transfer pairs).
 */
describe("billing tax profile, series limits and shared deposits", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let cashier: string;
  let patientId: string;
  const ids: Record<string, string> = {};
  const year = new Date().getFullYear();

  const req = (token: string, facilityId = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, facilityId)).send(body),
    patch: (url: string, body: object = {}) => ctx.http().patch(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });
  const profile = {
    registeredName: "Demo Health Clinic Inc.",
    tin: "123-456-789-00000",
    businessAddress: "1 Rizal Avenue, Manila",
    vatStatus: "vat_registered",
    vatRateBp: 1_200,
    permitReference: "PERMIT-TEST-0001",
    documentNote: "Printed as configured by the organization.",
    depositsAcrossFacilities: false,
  };
  /** A draft invoice for a service, and a request that issues it. */
  async function issue(serviceId: string, quantity = 1) {
    const charge = await req(cashier).post("/billing/charges", { patientId, serviceId, quantity }).expect(201);
    const draft = await req(cashier)
      .post("/billing/invoices", { patientId, chargeIds: [charge.body.id] })
      .expect(201);
    return () => req(cashier).post(`/billing/invoices/${draft.body.id}/issue`, { version: draft.body.version });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "tax-org");
    await createStaff(ctx.pool, tenant, "admin@tax.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "cashier@tax.ph", ["cashier"]);
    admin = (await login(ctx, "admin@tax.ph")).accessToken;
    cashier = (await login(ctx, "cashier@tax.ph")).accessToken;
    const consult = await req(admin)
      .post("/billing/services", { code: "consult", name: "Consultation fee", category: "consultation", unitPrice: 112_000, effectiveFrom: manilaDate(-30) })
      .expect(201);
    ids.consult = consult.body.id;
    ids.consultVersion = String(consult.body.version);
    ids.cert = (
      await req(admin)
        .post("/billing/services", {
          code: "med-cert",
          name: "Medical certificate",
          category: "other",
          unitPrice: 15_000,
          effectiveFrom: manilaDate(-30),
          taxClass: "vat_exempt",
        })
        .expect(201)
    ).body.id;
    patientId = (
      await req(admin)
        .post("/patients", {
          familyName: "Garcia",
          givenName: "Pedro",
          sex: "male",
          birthDate: "1975-11-11",
          contacts: [{ system: "mobile", value: "0917 777 0606" }],
        })
        .expect(201)
    ).body.id;
  });

  afterAll(() => ctx.close());

  it("keeps the organization's tax profile as it enters it, not configured by default", async () => {
    expect((await req(cashier).get("/billing/tax-profile").expect(200)).body).toMatchObject({ vatStatus: "not_configured", vatRateBp: null, version: 0 });
    await req(cashier).put("/billing/tax-profile", profile).expect(403);
    await req(admin)
      .put("/billing/tax-profile", { ...profile, vatRateBp: null })
      .expect(400);
    await req(admin)
      .put("/billing/tax-profile", { ...profile, tin: "TIN 123" })
      .expect(400);
    const saved = await req(admin).put("/billing/tax-profile", profile).expect(200);
    expect(saved.body).toMatchObject({ ...profile, version: 1 });
    await req(admin)
      .put("/billing/tax-profile", { ...profile, version: 7 })
      .expect(409);
    const audit = await auditRows(ctx.pool, "action = 'billing.tax-profile.update'");
    expect(audit).toHaveLength(1);
  });

  it("needs every invoiced service classified for VAT when VAT-registered, then snapshots the breakdown", async () => {
    await (
      await issue(ids.consult)
    )()
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("tax_class_required"));
    // The refused draft stays a draft; classify and issue it.
    await req(admin)
      .patch(`/billing/services/${ids.consult}`, { taxClass: "vatable", version: Number(ids.consultVersion) })
      .expect(200);
    const drafts = await req(cashier).get(`/billing/invoices?patientId=${patientId}&status=draft`).expect(200);
    const issued = await req(cashier).post(`/billing/invoices/${drafts.body[0].id}/issue`, { version: drafts.body[0].version }).expect(200);
    expect(issued.body).toMatchObject({
      taxStatus: "vat_registered",
      vatRateBp: 1_200,
      sellerRegisteredName: "Demo Health Clinic Inc.",
      sellerTin: "123-456-789-00000",
      permitReference: "PERMIT-TEST-0001",
      netTotal: 112_000,
      vatableSales: 100_000,
      vatAmount: 12_000,
      vatExemptSales: 0,
      zeroRatedSales: 0,
    });
    expect(issued.body.items[0]).toMatchObject({ taxClass: "vatable", vatAmount: 12_000 });
    ids.vatInvoice = issued.body.id;
    const exempt = await (await issue(ids.cert, 2))().expect(200);
    expect(exempt.body).toMatchObject({ vatableSales: 0, vatAmount: 0, vatExemptSales: 30_000 });
    await expect(ctx.pool.query(`UPDATE billing_invoice SET vat_amount = 1 WHERE id = $1`, [ids.vatInvoice])).rejects.toThrow(/immutable/);
  });

  it("prints the seller's details and the VAT breakdown", async () => {
    const response = await ctx
      .http()
      .get(`/api/v1/billing/invoices/${ids.vatInvoice}/pdf`)
      .set(as(cashier, tenant.facilityId))
      .buffer(true)
      .parse(binary)
      .expect(200);
    const text = extractPdfText(response.body as Buffer);
    expect(text).toContain("Demo Health Clinic Inc.");
    expect(text).toContain("123-456-789-00000");
    expect(text).toContain("VAT breakdown");
    expect(text).toContain("VATable sales");
    expect(text).toContain("PHP 120.00");
    expect(text).toContain("Printed as configured by the organization.");
  });

  it("refuses numbers beyond the authorized series without taking one", async () => {
    await req(admin)
      .put("/billing/settings", { invoicePrefix: "INV", receiptPrefix: "AR", lastNumbers: { invoice: 1 } })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("series_limit_below_used"));
    const limited = await req(admin)
      .put("/billing/settings", { invoicePrefix: "INV", receiptPrefix: "AR", lastNumbers: { invoice: 2 } })
      .expect(200);
    expect(limited.body.series).toContainEqual({ kind: "invoice", prefix: "INV", nextValue: 3, lastValue: 2 });
    await (
      await issue(ids.cert)
    )()
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("number_series_exhausted"));
    const settings = await req(cashier).get("/billing/settings").expect(200);
    expect(settings.body.series).toContainEqual({ kind: "invoice", prefix: "INV", nextValue: 3, lastValue: 2 });
    await req(admin)
      .put("/billing/settings", { invoicePrefix: "INV", receiptPrefix: "AR", lastNumbers: { invoice: null } })
      .expect(200);
    const drafts = await req(cashier).get(`/billing/invoices?patientId=${patientId}&status=draft`).expect(200);
    const issued = await req(cashier).post(`/billing/invoices/${drafts.body[0].id}/issue`, { version: drafts.body[0].version }).expect(200);
    expect(issued.body.invoiceNumber).toBe(`INV-${year}-000003`);
  });

  it("uses a deposit made at another facility only when the organization allows it, moving the balance", async () => {
    const annex = req(cashier, tenant.otherFacilityId);
    await annex.post(`/billing/patients/${patientId}/deposits`, { amount: 50_000, method: "cash", idempotencyKey: "annex-dep-0001" }).expect(201);
    const invoice = (await req(cashier).get(`/billing/invoices/${ids.vatInvoice}`).expect(200)).body;
    expect(invoice.balance).toBe(112_000);
    await req(cashier)
      .post(`/billing/invoices/${ids.vatInvoice}/deposit-applications`, { amount: 30_000, idempotencyKey: "shared-app-0001" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("application_exceeds_account"));

    const current = (await req(admin).get("/billing/tax-profile").expect(200)).body;
    await req(admin)
      .put("/billing/tax-profile", { ...profile, depositsAcrossFacilities: true, version: current.version })
      .expect(200);
    const before = await req(cashier).get(`/billing/patients/${patientId}/account`).expect(200);
    expect(before.body).toMatchObject({
      balance: 0,
      usableAcrossFacilities: true,
      organizationBalance: 50_000,
      facilities: [expect.objectContaining({ facilityId: tenant.otherFacilityId, facilityName: "Annex Clinic", balance: 50_000 })],
    });
    await req(cashier).post(`/billing/invoices/${ids.vatInvoice}/deposit-applications`, { amount: 30_000, idempotencyKey: "shared-app-0002" }).expect(201);
    expect((await req(cashier).get(`/billing/invoices/${ids.vatInvoice}`).expect(200)).body.balance).toBe(82_000);
    const after = await req(cashier).get(`/billing/patients/${patientId}/account`).expect(200);
    expect(after.body.balance).toBe(0);
    expect(after.body.organizationBalance).toBe(20_000);
    expect(after.body.entries.map((e: { kind: string; amount: number }) => [e.kind, e.amount])).toEqual([
      ["transfer_in", 30_000],
      ["application", 30_000],
    ]);
    const annexAccount = await annex.get(`/billing/patients/${patientId}/account`).expect(200);
    expect(annexAccount.body.entries.map((e: { kind: string; amount: number }) => [e.kind, e.amount])).toEqual([
      ["deposit", 50_000],
      ["transfer_out", 30_000],
    ]);
    // A refund at this facility also draws on the other one.
    await req(admin)
      .post(`/billing/patients/${patientId}/account-refunds`, {
        amount: 20_000,
        method: "cash",
        reason: "Patient moving away",
        idempotencyKey: "shared-ref-0001",
      })
      .expect(201);
    expect((await req(cashier).get(`/billing/patients/${patientId}/account`).expect(200)).body.organizationBalance).toBe(0);
    const audit = await auditRows(ctx.pool, "action = 'billing.deposit.transfer'");
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ patient_id: patientId });
  });
});
