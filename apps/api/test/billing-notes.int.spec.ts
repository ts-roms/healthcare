import { extractPdfText } from "@healthcare/pdf";
import { as, auditRows, binary, createStaff, createTenant, createTestApp, login, manilaDate, type Tenant, type TestContext } from "./harness";

/**
 * Debit notes (add to an issued invoice: services or adjustments, own number
 * series, immutable) and credit notes that credit a debit note's lines or a
 * payer's unsettled coverage.
 */
describe("billing debit notes and payer credits", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let cashier: string;
  let patientId: string;
  const ids: Record<string, string> = {};
  const year = new Date().getFullYear();

  const req = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const pdf = async (url: string) =>
    extractPdfText((await ctx.http().get(`/api/v1${url}`).set(as(cashier, tenant.facilityId)).buffer(true).parse(binary).expect(200)).body as Buffer);
  const invoice = async () => (await req(cashier).get(`/billing/invoices/${ids.invoice}`).expect(200)).body;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "notes-org");
    await createStaff(ctx.pool, tenant, "admin@notes.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "cashier@notes.ph", ["cashier"]);
    admin = (await login(ctx, "admin@notes.ph")).accessToken;
    cashier = (await login(ctx, "cashier@notes.ph")).accessToken;
    ids.consult = (
      await req(admin)
        .post("/billing/services", { code: "consult", name: "Consultation fee", category: "consultation", unitPrice: 50_000, effectiveFrom: manilaDate(-30) })
        .expect(201)
    ).body.id;
    ids.cert = (
      await req(admin)
        .post("/billing/services", { code: "med-cert", name: "Medical certificate", category: "other", unitPrice: 15_000, effectiveFrom: manilaDate(-30) })
        .expect(201)
    ).body.id;
    ids.hmo = (await req(admin).post("/billing/payers", { code: "maxicare", name: "Maxicare", payerType: "hmo" }).expect(201)).body.id;
    patientId = (
      await req(admin)
        .post("/patients", {
          familyName: "Reyes",
          givenName: "Ana",
          sex: "female",
          birthDate: "1980-01-20",
          contacts: [{ system: "mobile", value: "0917 444 0303" }],
        })
        .expect(201)
    ).body.id;
    await req(cashier).post("/billing/charges", { patientId, serviceId: ids.consult }).expect(201);
    const draft = await req(cashier).post("/billing/invoices", { patientId }).expect(201);
    const covered = await req(cashier)
      .post(`/billing/invoices/${draft.body.id}/payers`, { payerId: ids.hmo, amount: 30_000, reference: "LOA-1", version: draft.body.version })
      .expect(201);
    ids.coverage = covered.body.payers[0].id;
    const issued = await req(cashier).post(`/billing/invoices/${draft.body.id}/issue`, { version: covered.body.version }).expect(200);
    ids.invoice = issued.body.id;
    ids.item = issued.body.items[0].id;
    expect(issued.body).toMatchObject({ patientTotal: 20_000, balance: 20_000 });
  });

  afterAll(() => ctx.close());

  it("issues debit notes for services and adjustments, with their own number series", async () => {
    const body = { reason: "Two certificates issued after the invoice", lines: [{ serviceId: ids.cert, quantity: 2 }], idempotencyKey: "dnote-0001" };
    await req(cashier).post(`/billing/invoices/${ids.invoice}/debit-notes`, body).expect(403);
    const note = await req(admin).post(`/billing/invoices/${ids.invoice}/debit-notes`, body).expect(201);
    expect(note.body).toMatchObject({
      debitNoteNumber: `DN-${year}-000001`,
      invoiceNumber: `INV-${year}-000001`,
      amount: 30_000,
      lines: [expect.objectContaining({ description: "Medical certificate", quantity: 2, unitPrice: 15_000, amount: 30_000 })],
    });
    ids.debitNote = note.body.id;
    ids.debitLine = note.body.lines[0].id;
    expect((await req(admin).post(`/billing/invoices/${ids.invoice}/debit-notes`, body).expect(201)).body.id).toBe(ids.debitNote);
    await req(admin)
      .post(`/billing/invoices/${ids.invoice}/debit-notes`, { reason: "Adjustment", lines: [{ description: "Supplies" }], idempotencyKey: "dnote-0002" })
      .expect(400);
    const adjustment = await req(admin)
      .post(`/billing/invoices/${ids.invoice}/debit-notes`, {
        reason: "Dressing supplies not charged",
        lines: [{ description: "Dressing supplies", unitPrice: 5_000 }],
        idempotencyKey: "dnote-0003",
      })
      .expect(201);
    expect(adjustment.body).toMatchObject({ debitNoteNumber: `DN-${year}-000002`, amount: 5_000 });
    expect(await invoice()).toMatchObject({ patientTotal: 20_000, debitedTotal: 35_000, balance: 55_000 });
    // Payments may now cover the added amount.
    await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/payments`, { amount: 55_001, method: "cash", idempotencyKey: "pay-notes-over" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("payment_exceeds_balance"));

    await expect(ctx.pool.query(`UPDATE billing_debit_note SET amount = 1 WHERE id = $1`, [ids.debitNote])).rejects.toThrow(/append-only/);
    const audit = await auditRows(ctx.pool, "action = 'billing.debit-note.issue'");
    expect(audit[0]).toMatchObject({ reason: "Two certificates issued after the invoice", patient_id: patientId });
    const current = await invoice();
    await req(admin)
      .post(`/billing/invoices/${ids.invoice}/void`, { reason: "Test", version: current.version })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("invoice_has_debit_notes"));
  });

  it("credits a debit note's line", async () => {
    const note = await req(admin)
      .post(`/billing/invoices/${ids.invoice}/credit-notes`, {
        reason: "One certificate not released",
        lines: [{ debitNoteLineId: ids.debitLine, amount: 15_000 }],
        idempotencyKey: "cnote-notes-1",
      })
      .expect(201);
    expect(note.body).toMatchObject({
      amount: 15_000,
      appliedAmount: 15_000,
      payerAmount: 0,
      lines: [expect.objectContaining({ debitNoteLineId: ids.debitLine })],
    });
    await req(admin)
      .post(`/billing/invoices/${ids.invoice}/credit-notes`, {
        reason: "Again",
        lines: [{ debitNoteLineId: ids.debitLine, amount: 15_001 }],
        idempotencyKey: "cnote-notes-2",
      })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("credit_exceeds_line"));
    expect(await invoice()).toMatchObject({ creditedTotal: 15_000, balance: 40_000 });
  });

  it("credits a payer's unsettled coverage, and the claim can settle only what is left", async () => {
    await req(admin)
      .post(`/billing/invoices/${ids.invoice}/credit-notes`, {
        reason: "Consultation not done",
        lines: [{ invoiceItemId: ids.item, amount: 50_000 }],
        payers: [{ invoicePayerId: ids.coverage, amount: 5_000 }],
        idempotencyKey: "cnote-notes-3",
      })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("credit_exceeds_patient_share"));
    const note = await req(admin)
      .post(`/billing/invoices/${ids.invoice}/credit-notes`, {
        reason: "Consultation not done",
        lines: [{ invoiceItemId: ids.item, amount: 50_000 }],
        payers: [{ invoicePayerId: ids.coverage, amount: 30_000 }],
        idempotencyKey: "cnote-notes-4",
      })
      .expect(201);
    expect(note.body).toMatchObject({
      amount: 50_000,
      payerAmount: 30_000,
      appliedAmount: 20_000,
      accountCredit: 0,
      payers: [expect.objectContaining({ invoicePayerId: ids.coverage, amount: 30_000, payerName: "Maxicare" })],
    });
    ids.payerCredit = note.body.id;
    const after = await invoice();
    expect(after).toMatchObject({ creditedTotal: 35_000, balance: 20_000 });
    expect(after.payers[0]).toMatchObject({ amount: 30_000, creditedAmount: 30_000 });
    await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/payers/${ids.coverage}/status`, { status: "settled", settledAmount: 1 })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("settled_exceeds_coverage"));
    await req(cashier).post(`/billing/invoices/${ids.invoice}/payers/${ids.coverage}/status`, { status: "denied", note: "Nothing left to claim" }).expect(200);
    await req(admin)
      .post(`/billing/invoices/${ids.invoice}/credit-notes`, {
        reason: "Supplies returned",
        lines: [{ debitNoteLineId: ids.debitLine, amount: 1_000 }],
        payers: [{ invoicePayerId: ids.coverage, amount: 1_000 }],
        idempotencyKey: "cnote-notes-5",
      })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("coverage_not_creditable"));
  });

  it("prints debit notes, payer credits and the invoice with both", async () => {
    const debit = await pdf(`/billing/debit-notes/${ids.debitNote}/pdf`);
    expect(debit).toContain("Debit Note");
    expect(debit).toContain(`DN-${year}-000001`);
    expect(debit).toContain("Two certificates issued after the invoice");
    expect(debit).toContain("Three hundred pesos only");
    const credit = await pdf(`/billing/credit-notes/${ids.payerCredit}/pdf`);
    expect(credit).toContain("Taken off Maxicare's coverage");
    const inv = await pdf(`/billing/invoices/${ids.invoice}/pdf`);
    expect(inv).toContain("Debit notes");
    expect(inv).toContain(`DN-${year}-000002`);
  });

  it("numbers debit notes with a configurable prefix and reports them", async () => {
    expect((await req(cashier).get("/billing/settings").expect(200)).body).toMatchObject({ debitNotePrefix: "DN" });
    const report = await req(cashier)
      .get(`/billing/reports/daily?date=${manilaDate(0)}`)
      .expect(200);
    expect(report.body.debitNotes).toEqual({ count: 2, amount: 35_000 });
    expect(report.body.creditNotes).toMatchObject({ count: 2, amount: 65_000, payerAmount: 30_000 });
  });
});
