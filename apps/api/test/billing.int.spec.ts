import {
  as,
  auditRows,
  createClinician,
  createStaff,
  createTenant,
  createTestApp,
  drainEvents,
  login,
  manilaDate,
  type Tenant,
  type TestContext,
  binary,
} from "./harness";
import { extractPdfText } from "@healthcare/pdf";

/**
 * Phase 7 billing journey: charges captured from a signed consultation and a
 * laboratory order → draft invoice → statutory discount with evidence → HMO
 * coverage → issue (immutable) → payments and refund (idempotent ledger) →
 * claim follow-up → void and reissue → daily report → MyHealth.
 */
describe("billing", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let cashier: string;
  let patientId: string;
  let visitTypeId: string;
  let fbsTestId: string;
  const ids: Record<string, string> = {};

  const req = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    del: (url: string) => ctx.http().delete(`/api/v1${url}`).set(as(token, tenant.facilityId)),
  });
  const year = new Date().getFullYear();

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "billing-org");
    await createStaff(ctx.pool, tenant, "admin@billing.ph", ["org_admin"]);
    await createClinician(ctx, tenant, "ramos@billing.ph", ["physician"]);
    await createStaff(ctx.pool, tenant, "cashier@billing.ph", ["cashier"]);
    admin = (await login(ctx, "admin@billing.ph")).accessToken;
    doctor = (await login(ctx, "ramos@billing.ph")).accessToken;
    cashier = (await login(ctx, "cashier@billing.ph")).accessToken;

    visitTypeId = (
      await req(admin).post("/clinic/visit-types", { code: "consult", name: "Consultation", defaultDurationMinutes: 15, requiresTriage: false }).expect(201)
    ).body.id;
    const chem = (await req(admin).post("/laboratory/departments", { code: "chem", name: "Clinical Chemistry" }).expect(201)).body.id;
    const serum = (await req(admin).post("/laboratory/specimen-types", { code: "serum", name: "Serum" }).expect(201)).body.id;
    fbsTestId = (
      await req(admin)
        .post("/laboratory/tests", {
          code: "fbs",
          name: "Fasting blood sugar",
          departmentId: chem,
          specimenTypeId: serum,
          resultType: "numeric",
          unit: "mmol/L",
        })
        .expect(201)
    ).body.id;
    patientId = (
      await req(admin)
        .post("/patients", {
          familyName: "Mendoza",
          givenName: "Lourdes",
          sex: "female",
          birthDate: "1950-03-15",
          contacts: [{ system: "mobile", value: "0917 222 0101" }],
        })
        .expect(201)
    ).body.id;
  });

  afterAll(() => ctx.close());

  it("keeps a catalog of services with versioned prices, payers and discount rules", async () => {
    await req(cashier)
      .post("/billing/services", { code: "consult", name: "Consultation fee", category: "consultation", unitPrice: 50_000, effectiveFrom: manilaDate(-30) })
      .expect(403);
    ids.consult = (
      await req(admin)
        .post("/billing/services", {
          code: "consult",
          name: "Consultation fee",
          category: "consultation",
          sourceKind: "visit_type",
          sourceCode: "consult",
          unitPrice: 50_000,
          effectiveFrom: manilaDate(-30),
        })
        .expect(201)
    ).body.id;
    ids.fbs = (
      await req(admin)
        .post("/billing/services", {
          code: "fbs",
          name: "FBS",
          category: "laboratory",
          sourceKind: "lab_test",
          sourceCode: "fbs",
          unitPrice: 25_000,
          effectiveFrom: manilaDate(-30),
        })
        .expect(201)
    ).body.id;
    ids.cert = (
      await req(admin)
        .post("/billing/services", { code: "med-cert", name: "Medical certificate", category: "other", unitPrice: 15_000, effectiveFrom: manilaDate(-30) })
        .expect(201)
    ).body.id;
    await req(admin)
      .post("/billing/services", {
        code: "consult-2",
        name: "Dup",
        category: "consultation",
        sourceKind: "visit_type",
        sourceCode: "consult",
        unitPrice: 1,
        effectiveFrom: manilaDate(0),
      })
      .expect(409);

    // A new price from next month; today's price is unchanged and the old one ends the day before.
    await req(admin)
      .post(`/billing/services/${ids.consult}/prices`, { unitPrice: 60_000, effectiveFrom: manilaDate(30) })
      .expect(201);
    await req(admin)
      .post(`/billing/services/${ids.consult}/prices`, { unitPrice: 55_000, effectiveFrom: manilaDate(10) })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("price_date_conflict"));
    const services = await req(cashier).get("/billing/services").expect(200);
    const consult = services.body.find((s: { code: string }) => s.code === "consult");
    expect(consult.currentPrice).toBe(50_000);
    expect(consult.prices.map((p: { unitPrice: number; effectiveUntil: string | null }) => [p.unitPrice, p.effectiveUntil])).toEqual([
      [60_000, null],
      [50_000, manilaDate(29)],
    ]);

    ids.hmo = (await req(admin).post("/billing/payers", { code: "maxicare", name: "Maxicare", payerType: "hmo" }).expect(201)).body.id;
    await req(admin)
      .post("/billing/discount-rules", {
        code: "senior",
        name: "Senior citizen",
        kind: "senior_citizen",
        statutory: true,
        rateBp: 2_000,
        effectiveFrom: manilaDate(-30),
      })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("evidence_required"));
    ids.senior = (
      await req(admin)
        .post("/billing/discount-rules", {
          code: "senior",
          name: "Senior citizen",
          kind: "senior_citizen",
          statutory: true,
          requiresEvidence: true,
          rateBp: 2_000,
          categories: ["consultation", "laboratory"],
          effectiveFrom: manilaDate(-30),
        })
        .expect(201)
    ).body.id;
    ids.employee = (
      await req(admin)
        .post("/billing/discount-rules", { code: "staff", name: "Employee", kind: "employee", rateBp: 1_000, effectiveFrom: manilaDate(-30) })
        .expect(201)
    ).body.id;
  });

  it("captures charges once from a signed consultation and a laboratory order", async () => {
    const visit = await req(admin).post("/queue/walk-ins", { patientId, visitTypeId }).expect(201);
    const encounter = await req(doctor).post("/encounters", { visitId: visit.body.id }).expect(201);
    ids.encounter = encounter.body.id;
    const order = await req(doctor)
      .post("/laboratory/orders", { patientId, encounterId: ids.encounter, testIds: [fbsTestId] })
      .expect(201);
    ids.order = order.body.id;
    await req(doctor).put(`/encounters/${ids.encounter}/note`, { assessment: "Controlled", plan: "Continue", basedOnRevision: 0 }).expect(200);
    const current = await req(doctor).get(`/encounters/${ids.encounter}`).expect(200);
    await req(doctor).post(`/encounters/${ids.encounter}/sign`, { version: current.body.version }).expect(200);
    await drainEvents(ctx);
    await drainEvents(ctx);

    const charges = await req(cashier).get(`/billing/charges?patientId=${patientId}`).expect(200);
    expect(
      charges.body
        .map((c: { serviceCode: string; amount: number; status: string; sourceType: string }) => [c.serviceCode, c.amount, c.status, c.sourceType])
        .sort(),
    ).toEqual([
      ["consult", 50_000, "pending", "encounter"],
      ["fbs", 25_000, "pending", "lab_order_item"],
    ]);
    const worklist = await req(cashier).get("/billing/worklist").expect(200);
    expect(worklist.body).toEqual([
      expect.objectContaining({ patientId, count: 2, amount: 75_000, patient: expect.objectContaining({ patientNumber: expect.any(String) }) }),
    ]);
    // Redelivered events do not charge twice.
    const again = await ctx.pool.query(`SELECT count(*)::int AS n FROM billing_charge WHERE patient_id = $1`, [patientId]);
    expect(again.rows[0].n).toBe(2);
  });

  it("adds manual charges at the listed price, or another price with a reason", async () => {
    await req(cashier)
      .post("/billing/charges", { patientId, serviceId: ids.cert, unitPrice: 10_000 })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("price_override_reason_required"));
    const cert = await req(cashier).post("/billing/charges", { patientId, serviceId: ids.cert }).expect(201);
    expect(cert.body).toMatchObject({ sourceType: "manual", unitPrice: 15_000, amount: 15_000, status: "pending" });
  });

  it("prepares a draft with a statutory discount (with evidence) and HMO coverage", async () => {
    const draft = await req(cashier).post("/billing/invoices", { patientId }).expect(201);
    ids.invoice = draft.body.id;
    expect(draft.body).toMatchObject({ status: "draft", invoiceNumber: null, grossTotal: 90_000, netTotal: 90_000, patientTotal: 90_000 });
    expect(draft.body.items).toHaveLength(3);
    await req(cashier)
      .post("/billing/invoices", { patientId })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("no_pending_charges"));

    let version = draft.body.version;
    await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/discounts`, { ruleId: ids.senior, version })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("evidence_required"));
    const discounted = await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/discounts`, { ruleId: ids.senior, evidenceIdNumber: "OSCA-2019-004512", version })
      .expect(201);
    // 20% of the consultation and the laboratory test only (not the certificate).
    expect(discounted.body).toMatchObject({ grossTotal: 90_000, discountTotal: 15_000, netTotal: 75_000 });
    expect(discounted.body.discounts).toEqual([expect.objectContaining({ ruleCode: "senior", amount: 15_000, evidenceIdMasked: "•••• 4512" })]);
    expect(JSON.stringify(discounted.body)).not.toMatch(/OSCA-2019/);
    version = discounted.body.version;
    await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/discounts`, { ruleId: ids.employee, version })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("discount_not_combinable"));

    await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/payers`, { payerId: ids.hmo, amount: 80_000, version })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("coverage_exceeds_total"));
    const covered = await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/payers`, { payerId: ids.hmo, amount: 30_000, reference: "LOA-778812", version })
      .expect(201);
    expect(covered.body).toMatchObject({ netTotal: 75_000, payerTotal: 30_000, patientTotal: 45_000 });
    ids.coverage = covered.body.payers[0].id;
    ids.version = String(covered.body.version);

    const audit = await auditRows(ctx.pool, "action = 'billing.invoice.discount'");
    expect(audit[0]?.metadata).toMatchObject({ ruleCode: "senior", statutory: true, evidence: true });
  });

  it("issues a numbered invoice that can no longer change", async () => {
    const issued = await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/issue`, { version: Number(ids.version) })
      .expect(200);
    expect(issued.body).toMatchObject({ status: "issued", invoiceNumber: `INV-${year}-000001`, patientTotal: 45_000, balance: 45_000 });
    await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/discounts`, { ruleId: ids.employee, version: issued.body.version })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("invoice_not_draft"));
    await expect(ctx.pool.query(`UPDATE billing_invoice SET net_total = 1, gross_total = 1 WHERE id = $1`, [ids.invoice])).rejects.toThrow(/immutable/);
    await expect(ctx.pool.query(`UPDATE billing_invoice_item SET unit_price = 1 WHERE invoice_id = $1`, [ids.invoice])).rejects.toThrow(/cannot change/);
    const charges = await ctx.pool.query(`SELECT DISTINCT status FROM billing_charge WHERE patient_id = $1`, [patientId]);
    expect(charges.rows).toEqual([{ status: "invoiced" }]);
  });

  it("records payments once per idempotency key and never more than the balance", async () => {
    await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/payments`, { amount: 50_000, method: "cash", idempotencyKey: "pay-0001-over" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("payment_exceeds_balance"));
    const cash = await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/payments`, { amount: 20_000, method: "cash", idempotencyKey: "pay-0001-cash" })
      .expect(201);
    expect(cash.body).toMatchObject({ kind: "payment", amount: 20_000, receiptNumber: `AR-${year}-000001` });
    ids.payment = cash.body.id;
    const replay = await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/payments`, { amount: 20_000, method: "cash", idempotencyKey: "pay-0001-cash" })
      .expect(201);
    expect(replay.body.id).toBe(ids.payment);
    await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/payments`, { amount: 5_000, method: "cash", idempotencyKey: "pay-0001-cash" })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("idempotency_key_reused"));
    await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/payments`, { amount: 25_000, method: "e_wallet", reference: "GC-99812", idempotencyKey: "pay-0002-ewallet" })
      .expect(201);
    const paid = await req(cashier).get(`/billing/invoices/${ids.invoice}`).expect(200);
    expect(paid.body).toMatchObject({ paidTotal: 45_000, balance: 0 });
    await expect(ctx.pool.query(`UPDATE billing_payment SET amount = 1 WHERE id = $1`, [ids.payment])).rejects.toThrow();
  });

  it("prints the invoice and a receipt, with the evidence ID masked", async () => {
    const pdf = async (url: string, token = cashier) =>
      extractPdfText((await ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)).buffer(true).parse(binary).expect(200)).body as Buffer);
    const invoice = await pdf(`/billing/invoices/${ids.invoice}/pdf`);
    expect(invoice).toContain(`INV-${year}-000001`);
    expect(invoice).toContain("MENDOZA, Lourdes");
    expect(invoice).toContain("Senior citizen");
    expect(invoice).toContain("PHP 450.00");
    expect(invoice).toContain("Maxicare");
    expect(invoice).toContain("This invoice is not an official receipt");
    expect(invoice).not.toContain("OSCA-2019");
    expect(invoice).not.toContain("DRAFT");
    const receipt = await pdf(`/billing/payments/${ids.payment}/receipt.pdf`);
    expect(receipt).toContain("Acknowledgement Receipt");
    expect(receipt).toContain(`AR-${year}-000001`);
    expect(receipt).toContain("Two hundred pesos only");
    expect(receipt).toContain("PHP 250.00"); // balance right after this payment (45,000 - 20,000 centavos)
    const audit = await auditRows(ctx.pool, "action IN ('billing.invoice.print', 'billing.receipt.print')");
    expect(audit.map((a) => a.action).sort()).toEqual(["billing.invoice.print", "billing.receipt.print"]);
  });

  it("refunds only with permission and a reason, and not more than was paid", async () => {
    await req(cashier)
      .post(`/billing/payments/${ids.payment}/refund`, { amount: 5_000, method: "cash", reason: "Overcharged", idempotencyKey: "ref-0001" })
      .expect(403);
    await req(admin)
      .post(`/billing/payments/${ids.payment}/refund`, { amount: 25_000, method: "cash", reason: "Overcharged", idempotencyKey: "ref-0002" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("refund_exceeds_payment"));
    const refund = await req(admin)
      .post(`/billing/payments/${ids.payment}/refund`, { amount: 5_000, method: "cash", reason: "Overcharged", idempotencyKey: "ref-0003" })
      .expect(201);
    expect(refund.body).toMatchObject({ kind: "refund", refundOfId: ids.payment, reason: "Overcharged" });
    const after = await req(cashier).get(`/billing/invoices/${ids.invoice}`).expect(200);
    expect(after.body).toMatchObject({ paidTotal: 40_000, balance: 5_000 });
    const audit = await auditRows(ctx.pool, "action = 'billing.refund.issue'");
    expect(audit[0]).toMatchObject({ reason: "Overcharged", patient_id: patientId });
  });

  it("follows up the HMO claim after issue without changing the invoice", async () => {
    await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/payers/${ids.coverage}/status`, { status: "settled", settledAmount: 40_000 })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("settled_exceeds_coverage"));
    const settled = await req(cashier)
      .post(`/billing/invoices/${ids.invoice}/payers/${ids.coverage}/status`, { status: "settled", settledAmount: 30_000 })
      .expect(200);
    expect(settled.body.payers[0]).toMatchObject({ status: "settled", settledAmount: 30_000, payerName: "Maxicare", reference: "LOA-778812" });
    expect(settled.body.patientTotal).toBe(45_000);
  });

  it("voids an unpaid invoice with a reason and reissues its charges as a new draft", async () => {
    await req(cashier).post("/billing/charges", { patientId, serviceId: ids.cert, quantity: 2 }).expect(201);
    const draft = await req(cashier).post("/billing/invoices", { patientId }).expect(201);
    const issued = await req(cashier).post(`/billing/invoices/${draft.body.id}/issue`, { version: draft.body.version }).expect(200);
    expect(issued.body.invoiceNumber).toBe(`INV-${year}-000002`);
    await req(cashier).post(`/billing/invoices/${draft.body.id}/void`, { reason: "Wrong quantity", version: issued.body.version }).expect(403);
    const voided = await req(admin).post(`/billing/invoices/${draft.body.id}/void`, { reason: "Wrong quantity", version: issued.body.version }).expect(200);
    expect(voided.body.voided).toMatchObject({ status: "void", voidReason: "Wrong quantity", replacedById: voided.body.replacement.id });
    expect(voided.body.replacement).toMatchObject({ status: "draft", grossTotal: 30_000, items: [expect.objectContaining({ quantity: 2 })] });

    // Fix the draft by removing the line; the charge goes back to pending and can be cancelled.
    const fixed = await req(cashier)
      .del(`/billing/invoices/${voided.body.replacement.id}/items/${voided.body.replacement.items[0].id}?version=${voided.body.replacement.version}`)
      .expect(200);
    expect(fixed.body).toMatchObject({ grossTotal: 0, items: [] });
    await req(cashier)
      .post(`/billing/invoices/${fixed.body.id}/issue`, { version: fixed.body.version })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("invoice_empty"));
    await req(cashier).post(`/billing/invoices/${fixed.body.id}/discard`, { version: fixed.body.version }).expect(204);
    const pending = await req(cashier).get(`/billing/charges?patientId=${patientId}&status=pending`).expect(200);
    expect(pending.body).toHaveLength(1);
    await req(cashier)
      .post(`/billing/charges/${pending.body[0].id}/cancel`, { reason: "Certificate not issued", version: pending.body[0].version })
      .expect(200);

    // Paid invoices must be refunded before a void.
    await req(admin)
      .post(`/billing/invoices/${ids.invoice}/void`, { reason: "Test", version: (await req(admin).get(`/billing/invoices/${ids.invoice}`)).body.version })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("invoice_has_payments"));
  });

  it("cancels the uninvoiced charges of a cancelled laboratory order", async () => {
    const order = await req(doctor)
      .post("/laboratory/orders", { patientId, source: "patient_request", testIds: [fbsTestId] })
      .expect(201);
    await drainEvents(ctx);
    await req(admin).post(`/laboratory/orders/${order.body.id}/cancel`, { reason: "Patient declined" }).expect(200);
    await drainEvents(ctx);
    const rows = await ctx.pool.query(`SELECT status, cancel_reason FROM billing_charge WHERE source_group_id = $1`, [order.body.id]);
    expect(rows.rows).toEqual([{ status: "cancelled", cancel_reason: "Laboratory order cancelled" }]);
  });

  it("reports the day: invoices, discounts, collections by method, refunds and receivables", async () => {
    await req(doctor)
      .get(`/billing/reports/daily?date=${manilaDate(0)}`)
      .expect(403);
    const report = await req(cashier)
      .get(`/billing/reports/daily?date=${manilaDate(0)}`)
      .expect(200);
    expect(report.body).toMatchObject({
      invoices: { issued: 1, voided: 1, grossTotal: 90_000, discountTotal: 15_000, netTotal: 75_000, payerTotal: 30_000, patientTotal: 45_000 },
      discounts: [{ code: "senior", name: "Senior citizen", count: 1, amount: 15_000 }],
      collectedTotal: 45_000,
      refundedTotal: 5_000,
      receivables: { patientBalance: 5_000, invoices: 1, payerPending: 0 },
    });
    expect(report.body.collections.map((c: { method: string; amount: number }) => [c.method, c.amount]).sort()).toEqual([
      ["cash", 20_000],
      ["e_wallet", 25_000],
    ]);
  });

  it("shows the patient their bills in MyHealth, without internal details", async () => {
    await req(admin).post(`/patients/${patientId}/consents`, { consentType: "portal_access", decision: "granted", capturedVia: "paper" }).expect(201);
    const created = await req(admin).get(`/patients/${patientId}`).expect(200);
    const code = (await req(admin).post(`/patients/${patientId}/portal-account/invitations`).expect(201)).body.activationCode;
    await ctx
      .http()
      .post("/api/v1/portal/auth/activate")
      .send({
        organizationCode: "billing-org",
        patientNumber: created.body.patientNumber,
        birthDate: "1950-03-15",
        activationCode: code,
        email: "lourdes@billing.ph",
        password: "Maaraw-na-umaga-2026",
      })
      .expect(200);
    const token = (
      await ctx
        .http()
        .post("/api/v1/portal/auth/login")
        .send({ organizationCode: "billing-org", email: "lourdes@billing.ph", password: "Maaraw-na-umaga-2026" })
        .expect(200)
    ).body.accessToken;
    const bills = await ctx
      .http()
      .get("/api/v1/portal/billing")
      .set({ authorization: `Bearer ${token}` })
      .expect(200);
    expect(bills.body.map((b: { invoiceNumber: string; status: string; balance: number }) => [b.invoiceNumber, b.status, b.balance])).toEqual([
      [`INV-${year}-000002`, "void", 0],
      [`INV-${year}-000001`, "issued", 5_000],
    ]);
    const copy = await ctx
      .http()
      .get(`/api/v1/portal/billing/${ids.invoice}/pdf`)
      .set({ authorization: `Bearer ${token}` })
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(extractPdfText(copy.body as Buffer)).toContain("Patient's copy from MyHealth");
    // Drafts are not the patient's to see; staff print them watermarked.
    const extra = await req(cashier).post("/billing/charges", { patientId, serviceId: ids.cert }).expect(201);
    const draftInvoice = await req(cashier)
      .post("/billing/invoices", { patientId, chargeIds: [extra.body.id] })
      .expect(201);
    await ctx
      .http()
      .get(`/api/v1/portal/billing/${draftInvoice.body.id}/pdf`)
      .set({ authorization: `Bearer ${token}` })
      .expect(404);
    const staffDraft = await ctx
      .http()
      .get(`/api/v1/billing/invoices/${draftInvoice.body.id}/pdf`)
      .set(as(cashier, tenant.facilityId))
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(extractPdfText(staffDraft.body as Buffer)).toContain("DRAFT");
    const first = bills.body[1];
    expect(first.discounts).toEqual([{ name: "Senior citizen", amount: 15_000 }]);
    expect(JSON.stringify(bills.body)).not.toMatch(/OSCA|recordedBy|createdBy|notes/);
    const audit = await auditRows(ctx.pool, "action = 'portal.billing-view'");
    expect(audit[0]).toMatchObject({ actor_type: "patient", patient_id: patientId });
  });
});
