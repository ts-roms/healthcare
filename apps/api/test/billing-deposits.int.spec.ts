import { extractPdfText } from "@healthcare/pdf";
import { as, auditRows, binary, createStaff, createTenant, createTestApp, login, manilaDate, type Tenant, type TestContext } from "./harness";

/**
 * Billing follow-ups: a deposit on the patient's account (idempotent, receipt)
 * → applied to an issued invoice (never beyond either balance) → refund of
 * unapplied deposit (permission and reason) → credit notes (own number
 * series, immutable, reduce the balance or become account credit) → void
 * returns applied deposit → daily report → MyHealth (read only).
 */
describe("billing deposits and credit notes", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let cashier: string;
  let patientId: string;
  let serviceId: string;
  const ids: Record<string, string> = {};

  const req = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const pdf = async (url: string, token = cashier) =>
    extractPdfText((await ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)).buffer(true).parse(binary).expect(200)).body as Buffer);
  const year = new Date().getFullYear();

  /** An issued invoice for `quantity` certificates (₱150.00 each). */
  async function issuedInvoice(quantity: number) {
    const charge = await req(cashier).post("/billing/charges", { patientId, serviceId, quantity }).expect(201);
    const draft = await req(cashier)
      .post("/billing/invoices", { patientId, chargeIds: [charge.body.id] })
      .expect(201);
    return (await req(cashier).post(`/billing/invoices/${draft.body.id}/issue`, { version: draft.body.version }).expect(200)).body;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "deposit-org");
    await createStaff(ctx.pool, tenant, "admin@deposit.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "cashier@deposit.ph", ["cashier"]);
    admin = (await login(ctx, "admin@deposit.ph")).accessToken;
    cashier = (await login(ctx, "cashier@deposit.ph")).accessToken;
    serviceId = (
      await req(admin)
        .post("/billing/services", { code: "med-cert", name: "Medical certificate", category: "other", unitPrice: 15_000, effectiveFrom: manilaDate(-30) })
        .expect(201)
    ).body.id;
    patientId = (
      await req(admin)
        .post("/patients", {
          familyName: "Dizon",
          givenName: "Ramon",
          sex: "male",
          birthDate: "1971-06-02",
          contacts: [{ system: "mobile", value: "0917 333 0202" }],
        })
        .expect(201)
    ).body.id;
  });

  afterAll(() => ctx.close());

  it("records a deposit once per idempotency key, with a receipt number", async () => {
    const deposit = await req(cashier)
      .post(`/billing/patients/${patientId}/deposits`, { amount: 100_000, method: "cash", idempotencyKey: "dep-0001-cash" })
      .expect(201);
    expect(deposit.body).toMatchObject({ kind: "deposit", amount: 100_000, method: "cash", receiptNumber: `AR-${year}-000001` });
    expect(deposit.body.idempotencyKey).toBeUndefined();
    ids.deposit = deposit.body.id;
    const replay = await req(cashier)
      .post(`/billing/patients/${patientId}/deposits`, { amount: 100_000, method: "cash", idempotencyKey: "dep-0001-cash" })
      .expect(201);
    expect(replay.body.id).toBe(ids.deposit);
    await req(cashier)
      .post(`/billing/patients/${patientId}/deposits`, { amount: 5_000, method: "cash", idempotencyKey: "dep-0001-cash" })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("idempotency_key_reused"));
    const account = await req(cashier).get(`/billing/patients/${patientId}/account`).expect(200);
    expect(account.body).toMatchObject({ balance: 100_000, entries: [expect.objectContaining({ kind: "deposit", amount: 100_000 })] });
    const audit = await auditRows(ctx.pool, "action = 'billing.deposit.record'");
    expect(audit[0]).toMatchObject({ patient_id: patientId });
  });

  it("applies deposit to an issued invoice, never beyond the invoice or the deposit balance", async () => {
    const invoice = await issuedInvoice(4);
    ids.invoice1 = invoice.id;
    expect(invoice).toMatchObject({ invoiceNumber: `INV-${year}-000001`, patientTotal: 60_000, balance: 60_000 });
    await req(cashier)
      .post(`/billing/invoices/${ids.invoice1}/deposit-applications`, { amount: 70_000, idempotencyKey: "app-0001-over" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("application_exceeds_balance"));
    const applied = await req(cashier)
      .post(`/billing/invoices/${ids.invoice1}/deposit-applications`, { amount: 40_000, idempotencyKey: "app-0001" })
      .expect(201);
    expect(applied.body).toMatchObject({ kind: "application", amount: 40_000, invoiceId: ids.invoice1 });
    const after = await req(cashier).get(`/billing/invoices/${ids.invoice1}`).expect(200);
    expect(after.body).toMatchObject({ paidTotal: 0, depositAppliedTotal: 40_000, balance: 20_000 });
    // Payments now stop at what is left after the deposit.
    await req(cashier)
      .post(`/billing/invoices/${ids.invoice1}/payments`, { amount: 25_000, method: "cash", idempotencyKey: "pay-0001-over" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("payment_exceeds_balance"));
    await req(cashier).post(`/billing/invoices/${ids.invoice1}/payments`, { amount: 20_000, method: "cash", idempotencyKey: "pay-0001" }).expect(201);
    const paid = await req(cashier).get(`/billing/invoices/${ids.invoice1}`).expect(200);
    expect(paid.body).toMatchObject({ paidTotal: 20_000, depositAppliedTotal: 40_000, balance: 0 });
    const unpaid = await req(cashier).get(`/billing/invoices?patientId=${patientId}&unpaid=true`).expect(200);
    expect(unpaid.body).toEqual([]);
    const account = await req(cashier).get(`/billing/patients/${patientId}/account`).expect(200);
    expect(account.body.balance).toBe(60_000);
    expect(account.body.entries[1]).toMatchObject({ kind: "application", invoiceNumber: `INV-${year}-000001` });
  });

  it("refunds unapplied deposit only with permission and a reason, within the balance", async () => {
    await req(cashier)
      .post(`/billing/patients/${patientId}/account-refunds`, { amount: 10_000, method: "cash", reason: "Patient request", idempotencyKey: "dref-0001" })
      .expect(403);
    await req(admin).post(`/billing/patients/${patientId}/account-refunds`, { amount: 10_000, method: "cash", idempotencyKey: "dref-0002" }).expect(400);
    await req(admin)
      .post(`/billing/patients/${patientId}/account-refunds`, { amount: 70_000, method: "cash", reason: "Patient request", idempotencyKey: "dref-0003" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("refund_exceeds_account"));
    const refund = await req(admin)
      .post(`/billing/patients/${patientId}/account-refunds`, { amount: 10_000, method: "cash", reason: "Patient request", idempotencyKey: "dref-0004" })
      .expect(201);
    expect(refund.body).toMatchObject({ kind: "refund", amount: 10_000, reason: "Patient request" });
    expect((await req(cashier).get(`/billing/patients/${patientId}/account`).expect(200)).body.balance).toBe(50_000);
    const audit = await auditRows(ctx.pool, "action = 'billing.deposit.refund'");
    expect(audit[0]).toMatchObject({ reason: "Patient request", patient_id: patientId });
  });

  it("keeps the account ledger append-only and never below zero", async () => {
    await expect(ctx.pool.query(`UPDATE billing_account_entry SET amount = 1 WHERE id = $1`, [ids.deposit])).rejects.toThrow(/append-only/);
    await expect(
      ctx.pool.query(
        `INSERT INTO billing_account_entry (organization_id, facility_id, patient_id, kind, amount, method, reason, idempotency_key, recorded_by)
         SELECT organization_id, facility_id, patient_id, 'refund', 50001, 'cash', 'Test', 'direct-0001', recorded_by FROM billing_account_entry WHERE id = $1`,
        [ids.deposit],
      ),
    ).rejects.toThrow(/below zero/);
  });

  it("prints the deposit receipt", async () => {
    const receipt = await pdf(`/billing/account-entries/${ids.deposit}/receipt.pdf`);
    expect(receipt).toContain("Acknowledgement Receipt");
    expect(receipt).toContain("Deposit (advance payment)");
    expect(receipt).toContain(`AR-${year}-000001`);
    expect(receipt).toContain("One thousand pesos only");
    expect(receipt).toContain("DIZON, Ramon");
    expect(receipt).toContain("This acknowledgement receipt is not an official receipt");
  });

  it("issues a credit note on a paid invoice as account credit, with its own number series", async () => {
    const invoice = (await req(cashier).get(`/billing/invoices/${ids.invoice1}`).expect(200)).body;
    const line = invoice.items[0];
    const body = { reason: "One certificate not issued", lines: [{ invoiceItemId: line.id, amount: 15_000 }], idempotencyKey: "cnote-0001" };
    await req(cashier).post(`/billing/invoices/${ids.invoice1}/credit-notes`, body).expect(403);
    await req(admin)
      .post(`/billing/invoices/${ids.invoice1}/credit-notes`, { ...body, lines: [{ invoiceItemId: line.id, amount: 60_001 }], idempotencyKey: "cnote-0000" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("credit_exceeds_line"));
    const note = await req(admin).post(`/billing/invoices/${ids.invoice1}/credit-notes`, body).expect(201);
    expect(note.body).toMatchObject({
      creditNoteNumber: `CN-${year}-000001`,
      invoiceNumber: `INV-${year}-000001`,
      amount: 15_000,
      appliedAmount: 0,
      accountCredit: 15_000,
      lines: [expect.objectContaining({ description: "Medical certificate", amount: 15_000 })],
    });
    ids.creditNote1 = note.body.id;
    const replay = await req(admin).post(`/billing/invoices/${ids.invoice1}/credit-notes`, body).expect(201);
    expect(replay.body.id).toBe(ids.creditNote1);

    const after = await req(cashier).get(`/billing/invoices/${ids.invoice1}`).expect(200);
    expect(after.body).toMatchObject({ status: "issued", patientTotal: 60_000, creditNoteTotal: 15_000, creditedTotal: 0, balance: 0 });
    expect(after.body.creditNotes).toEqual([expect.objectContaining({ creditNoteNumber: `CN-${year}-000001`, reason: "One certificate not issued" })]);
    const account = await req(cashier).get(`/billing/patients/${patientId}/account`).expect(200);
    expect(account.body.balance).toBe(65_000);
    expect(account.body.entries.at(-1)).toMatchObject({ kind: "credit", amount: 15_000, creditNoteNumber: `CN-${year}-000001` });

    await expect(ctx.pool.query(`UPDATE billing_credit_note SET amount = 1 WHERE id = $1`, [ids.creditNote1])).rejects.toThrow(/append-only/);
    await expect(ctx.pool.query(`DELETE FROM billing_credit_note_line WHERE credit_note_id = $1`, [ids.creditNote1])).rejects.toThrow(/append-only/);
    const audit = await auditRows(ctx.pool, "action = 'billing.credit-note.issue'");
    expect(audit[0]).toMatchObject({ reason: "One certificate not issued", patient_id: patientId });
    expect(audit[0]?.metadata).toMatchObject({ amount: 15_000, accountCredit: 15_000 });
  });

  it("reduces the balance of an unpaid invoice, within what is left of the patient's share", async () => {
    const invoice = await issuedInvoice(2);
    ids.invoice2 = invoice.id;
    expect(invoice).toMatchObject({ invoiceNumber: `INV-${year}-000002`, balance: 30_000 });
    const line = invoice.items[0];
    const note = await req(admin)
      .post(`/billing/invoices/${ids.invoice2}/credit-notes`, {
        reason: "Price adjustment",
        lines: [{ invoiceItemId: line.id, amount: 10_000 }],
        idempotencyKey: "cnote-0002",
      })
      .expect(201);
    expect(note.body).toMatchObject({ creditNoteNumber: `CN-${year}-000002`, appliedAmount: 10_000, accountCredit: 0 });
    await req(admin)
      .post(`/billing/invoices/${ids.invoice2}/credit-notes`, {
        reason: "Again",
        lines: [{ invoiceItemId: line.id, amount: 20_001 }],
        idempotencyKey: "cnote-0003",
      })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("credit_exceeds_line"));
    const after = await req(cashier).get(`/billing/invoices/${ids.invoice2}`).expect(200);
    expect(after.body).toMatchObject({ creditedTotal: 10_000, balance: 20_000 });
    // The rest from the account's credit and deposit.
    await req(cashier).post(`/billing/invoices/${ids.invoice2}/deposit-applications`, { amount: 20_000, idempotencyKey: "app-0002" }).expect(201);
    expect((await req(cashier).get(`/billing/invoices/${ids.invoice2}`).expect(200)).body.balance).toBe(0);
    expect((await req(cashier).get(`/billing/patients/${patientId}/account`).expect(200)).body.balance).toBe(45_000);
    // Credit notes are not issued on drafts.
    const charge = await req(cashier).post("/billing/charges", { patientId, serviceId }).expect(201);
    const draft = await req(cashier)
      .post("/billing/invoices", { patientId, chargeIds: [charge.body.id] })
      .expect(201);
    await req(admin)
      .post(`/billing/invoices/${draft.body.id}/credit-notes`, {
        reason: "Draft",
        lines: [{ invoiceItemId: draft.body.items[0].id, amount: 1 }],
        idempotencyKey: "cnote-0004",
      })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("invoice_not_issued"));
    await req(cashier).post(`/billing/invoices/${draft.body.id}/discard`, { version: draft.body.version }).expect(204);
    const pending = await req(cashier).get(`/billing/charges?patientId=${patientId}&status=pending`).expect(200);
    await req(cashier).post(`/billing/charges/${pending.body[0].id}/cancel`, { reason: "Not needed", version: pending.body[0].version }).expect(200);
  });

  it("returns applied deposit to the account when an invoice is voided; invoices with credit notes are not voided", async () => {
    const invoice = await issuedInvoice(1);
    await req(cashier).post(`/billing/invoices/${invoice.id}/deposit-applications`, { amount: 15_000, idempotencyKey: "app-0003" }).expect(201);
    expect((await req(cashier).get(`/billing/patients/${patientId}/account`).expect(200)).body.balance).toBe(30_000);
    const current = (await req(admin).get(`/billing/invoices/${invoice.id}`).expect(200)).body;
    const voided = await req(admin)
      .post(`/billing/invoices/${invoice.id}/void`, { reason: "Wrong patient", version: current.version, reissue: false })
      .expect(200);
    expect(voided.body.voided).toMatchObject({ status: "void", depositAppliedTotal: 0 });
    const account = await req(cashier).get(`/billing/patients/${patientId}/account`).expect(200);
    expect(account.body.balance).toBe(45_000);
    expect(account.body.entries.at(-1)).toMatchObject({ kind: "release", amount: 15_000, invoiceId: invoice.id });
    // Deposits are applied to issued invoices only.
    await req(cashier)
      .post(`/billing/invoices/${invoice.id}/deposit-applications`, { amount: 1_000, idempotencyKey: "app-0004" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("invoice_not_issued"));

    const second = (await req(admin).get(`/billing/invoices/${ids.invoice2}`).expect(200)).body;
    await req(admin)
      .post(`/billing/invoices/${ids.invoice2}/void`, { reason: "Test", version: second.version })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("invoice_has_credit_notes"));
  });

  it("prints the credit note and shows it on the invoice", async () => {
    const note = await pdf(`/billing/credit-notes/${ids.creditNote1}/pdf`);
    expect(note).toContain("Credit Note");
    expect(note).toContain(`CN-${year}-000001`);
    expect(note).toContain(`INV-${year}-000001`);
    expect(note).toContain("One certificate not issued");
    expect(note).toContain("Credited to the patient's account");
    expect(note).toContain("One hundred fifty pesos only");
    const invoice = await pdf(`/billing/invoices/${ids.invoice2}/pdf`);
    expect(invoice).toContain("Credit notes");
    expect(invoice).toContain("Deposit applied");
    expect(invoice).toContain(`CN-${year}-000002`);
  });

  it("numbers credit notes with a configurable prefix", async () => {
    const settings = await req(cashier).get("/billing/settings").expect(200);
    expect(settings.body).toMatchObject({ invoicePrefix: "INV", receiptPrefix: "AR", creditNotePrefix: "CN" });
    const updated = await req(admin).put("/billing/settings", { invoicePrefix: "INV", receiptPrefix: "AR", creditNotePrefix: "crn" }).expect(200);
    expect(updated.body.creditNotePrefix).toBe("CRN");
    // Older clients that send only the invoice and receipt prefixes leave it as it is.
    await req(admin).put("/billing/settings", { invoicePrefix: "INV", receiptPrefix: "AR" }).expect(200);
    expect((await req(cashier).get("/billing/settings").expect(200)).body.creditNotePrefix).toBe("CRN");
  });

  it("reports deposits and credit notes in the day", async () => {
    const report = await req(cashier)
      .get(`/billing/reports/daily?date=${manilaDate(0)}`)
      .expect(200);
    expect(report.body.deposits).toMatchObject({
      received: [{ method: "cash", count: 1, amount: 100_000 }],
      receivedTotal: 100_000,
      appliedTotal: 60_000,
      refunds: [{ method: "cash", count: 1, amount: 10_000 }],
      refundedTotal: 10_000,
      held: 45_000,
    });
    expect(report.body.creditNotes).toEqual({ count: 2, amount: 25_000, appliedAmount: 10_000, accountCredit: 15_000, payerAmount: 0 });
    expect(report.body.collectedTotal).toBe(20_000);
    expect(report.body.receivables).toMatchObject({ patientBalance: 0, invoices: 0 });
  });

  it("shows the patient their deposit and credit balance and credit notes in MyHealth (read only)", async () => {
    await req(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const created = await req(admin).get(`/patients/${patientId}`).expect(200);
    const code = (await req(admin).post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({
        organizationCode: "deposit-org",
        patientNumber: created.body.patientNumber,
        birthDate: "1971-06-02",
        activationCode: code,
        email: "ramon@deposit.ph",
        password: "Maaraw-na-umaga-2026",
      })
      .expect(200);
    const token = (
      await ctx
        .http()
        .post("/api/v1/portal/auth/login")
        .send({ organizationCode: "deposit-org", email: "ramon@deposit.ph", password: "Maaraw-na-umaga-2026" })
        .expect(200)
    ).body.accessToken;
    const portal = (url: string) =>
      ctx
        .http()
        .get(`/api/v1${url}`)
        .set({ authorization: `Bearer ${token}` });
    const accounts = await portal("/portal/billing/account").expect(200);
    expect(accounts.body).toEqual([expect.objectContaining({ facilityName: expect.any(String), balance: 45_000 })]);
    expect(JSON.stringify(accounts.body)).not.toMatch(/Patient request|recordedBy|idempotency/);
    const bills = await portal("/portal/billing").expect(200);
    const first = bills.body.find((b: { id: string }) => b.id === ids.invoice1);
    expect(first).toMatchObject({ depositAppliedTotal: 40_000, balance: 0 });
    expect(first.creditNotes).toEqual([expect.objectContaining({ creditNoteNumber: `CN-${year}-000001`, amount: 15_000, accountCredit: 15_000 })]);
    const copy = await portal(`/portal/billing/credit-notes/${ids.creditNote1}/pdf`).buffer(true).parse(binary).expect(200);
    expect(extractPdfText(copy.body as Buffer)).toContain("Patient's copy from MyHealth");
    const audit = await auditRows(ctx.pool, "action IN ('portal.billing-account-view', 'portal.credit-note-download')");
    expect(audit.map((a) => a.actor_type)).toEqual(["patient", "patient"]);
  });
});
