import type { ClaimSubmissionOutcome, PhilHealthClaimPackage, PhilHealthClaimsGateway } from "@healthcare/interoperability";
import { PHILHEALTH_CLAIMS_GATEWAY } from "@healthcare/interoperability";
import {
  as,
  auditRows,
  createClinician,
  createStaff,
  createTenant,
  createTestApp,
  drainEvents,
  juan,
  login,
  manilaDate,
  type Tenant,
  type TestContext,
} from "./harness";

/** A test double standing in for a real eClaims adapter (none exists: the specification is an integration dependency). */
class FakeGateway implements PhilHealthClaimsGateway {
  readonly specification = { system: "philhealth-eclaims", name: "Test double", status: "implemented" as const, specificationVersion: "test", note: "test" };
  readonly received: Array<{ claim: PhilHealthClaimPackage; key: string }> = [];
  next: ClaimSubmissionOutcome[] = [];

  submitClaim(claim: PhilHealthClaimPackage, key: string): Promise<ClaimSubmissionOutcome> {
    this.received.push({ claim, key });
    return Promise.resolve(this.next.shift() ?? { outcome: "accepted", externalReference: `TX-${this.received.length}` });
  }
}

interface Setup {
  tenant: Tenant;
  admin: string;
  cashier: string;
  doctor: string;
  patientId: string;
  invoiceId: string;
  coverageId: string;
  req: (token: string) => {
    get: (url: string) => import("supertest").Test;
    post: (url: string, body?: object) => import("supertest").Test;
    put: (url: string, body?: object) => import("supertest").Test;
  };
}

/** A signed consultation with an ICD-10 diagnosis, invoiced with PhilHealth coverage and issued. */
async function issuedInvoiceWithPhilHealth(ctx: TestContext, code: string): Promise<Setup> {
  const tenant = await createTenant(ctx.pool, code);
  await createStaff(ctx.pool, tenant, `admin@${code}.ph`, ["org_admin"]);
  await createClinician(ctx, tenant, `cruz@${code}.ph`, ["physician"]);
  await createStaff(ctx.pool, tenant, `cashier@${code}.ph`, ["cashier"]);
  const admin = (await login(ctx, `admin@${code}.ph`)).accessToken;
  const doctor = (await login(ctx, `cruz@${code}.ph`)).accessToken;
  const cashier = (await login(ctx, `cashier@${code}.ph`)).accessToken;
  const req = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });

  const visitTypeId = (
    await req(admin).post("/clinic/visit-types", { code: "consult", name: "Consultation", defaultDurationMinutes: 15, requiresTriage: false }).expect(201)
  ).body.id;
  await req(admin).post("/clinic/coding-systems", { key: "icd-10", name: "ICD-10", version: "2019" }).expect(201);
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
    .expect(201);
  const philhealth = (await req(admin).post("/billing/payers", { code: "philhealth", name: "PhilHealth", payerType: "philhealth" }).expect(201)).body.id;
  const patientId = (await req(admin).post("/patients", juan).expect(201)).body.id;

  const visit = await req(admin).post("/queue/walk-ins", { patientId, visitTypeId }).expect(201);
  const encounterId = (await req(doctor).post("/encounters", { visitId: visit.body.id }).expect(201)).body.id;
  await req(doctor)
    .post(`/encounters/${encounterId}/diagnoses`, { codeSystemKey: "icd-10", code: "E11.9", display: "Type 2 diabetes mellitus", rank: "primary" })
    .expect(201);
  await req(doctor).put(`/encounters/${encounterId}/note`, { assessment: "Controlled", plan: "Continue", basedOnRevision: 0 }).expect(200);
  const current = await req(doctor).get(`/encounters/${encounterId}`).expect(200);
  await req(doctor).post(`/encounters/${encounterId}/sign`, { version: current.body.version }).expect(200);
  await drainEvents(ctx);

  const draft = await req(cashier).post("/billing/invoices", { patientId }).expect(201);
  const covered = await req(cashier)
    .post(`/billing/invoices/${draft.body.id}/payers`, { payerId: philhealth, amount: 30_000, version: draft.body.version })
    .expect(201);
  await req(cashier).post(`/billing/invoices/${draft.body.id}/issue`, { version: covered.body.version }).expect(200);
  return { tenant, admin, cashier, doctor, patientId, invoiceId: draft.body.id, coverageId: covered.body.payers[0].id, req };
}

/**
 * PhilHealth eClaims adapter stubs (docs/interoperability/philhealth-eclaims.md):
 * claims are prepared and checked from the platform's own data; nothing is
 * transmitted while the official specification is an integration dependency.
 */
describe("PhilHealth claims — unconfigured (default)", () => {
  let ctx: TestContext;
  let s: Setup;

  beforeAll(async () => {
    ctx = await createTestApp();
    s = await issuedInvoiceWithPhilHealth(ctx, "ph-default");
  });
  afterAll(() => ctx.close());

  it("reports the integration as a dependency", async () => {
    const res = await s.req(s.cashier).get("/philhealth/integration").expect(200);
    expect(res.body).toMatchObject({ system: "philhealth-eclaims", status: "dependency", specificationVersion: null });
    await s.req(s.doctor).get("/philhealth/integration").expect(403);
  });

  it("names what the platform is missing before a claim can be prepared", async () => {
    const res = await s.req(s.cashier).get(`/philhealth/claims/invoices/${s.invoiceId}`).expect(200);
    expect(res.body).toMatchObject({ ready: false, claim: null, submissions: [] });
    expect(res.body.checks.filter((c: { ok: boolean }) => !c.ok).map((c: { code: string }) => c.code)).toEqual(["accreditation_missing"]);
  });

  it("records the facility's accreditation number (settings permission, versioned, audited)", async () => {
    const url = `/philhealth/facilities/${s.tenant.facilityId}/accreditation`;
    await s.req(s.cashier).put(url, { accreditationNumber: "H91000123" }).expect(403);
    const created = await s
      .req(s.admin)
      .put(url, { accreditationNumber: "H91000123", validFrom: manilaDate(-365) })
      .expect(200);
    expect(created.body).toMatchObject({ accreditationNumber: "H91000123", version: 1 });
    await s.req(s.admin).put(url, { accreditationNumber: "H91000124" }).expect(409);
    const updated = await s
      .req(s.admin)
      .put(url, { accreditationNumber: "H91000124", validFrom: manilaDate(-365), version: 1 })
      .expect(200);
    expect(updated.body.version).toBe(2);
    expect((await s.req(s.admin).get(url).expect(200)).body).toMatchObject({ accreditation: { accreditationNumber: "H91000124", version: 2 } });
    expect((await s.req(s.admin).get(`/philhealth/facilities/${s.tenant.otherFacilityId}/accreditation`).expect(200)).body).toEqual({ accreditation: null });
    // Another organization's facility is not reachable.
    const other = await createTenant(ctx.pool, "ph-other");
    await s.req(s.admin).put(`/philhealth/facilities/${other.facilityId}/accreditation`, { accreditationNumber: "X1" }).expect(422);
    const audit = await auditRows(ctx.pool, "action = 'philhealth.accreditation.record'");
    expect(audit).toHaveLength(2);
  });

  it("prepares the claim with the PIN masked, and refuses to submit while the integration is a dependency", async () => {
    const res = await s.req(s.cashier).get(`/philhealth/claims/invoices/${s.invoiceId}`).expect(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.claim).toMatchObject({
      model: "platform-claim-1",
      facility: { accreditationNumber: "H91000124" },
      patient: { patientNumber: "P00000001", philhealthPin: "•••• 9012" },
      coverage: { invoicePayerId: s.coverageId, amountClaimed: 30_000 },
      diagnoses: [{ codeSystem: "icd-10", code: "E11.9", primary: true }],
    });
    expect(JSON.stringify(res.body)).not.toContain("345678901");

    const refused = await s.req(s.cashier).post(`/philhealth/claims/invoices/${s.invoiceId}/submissions`, { idempotencyKey: "claim-attempt-1" }).expect(422);
    expect(refused.body.error.code).toBe("integration_not_configured");
    const exchanges = await ctx.pool.query("SELECT count(*)::int AS n FROM integration_exchange");
    expect(exchanges.rows[0].n).toBe(0);
    // Billing's own claim follow-up is untouched: staff still record the reference by hand.
    const invoice = await s.req(s.cashier).get(`/billing/invoices/${s.invoiceId}`).expect(200);
    expect(invoice.body.payers[0]).toMatchObject({ status: "pending" });
    const audit = await auditRows(ctx.pool, "action = 'philhealth.claim.preview'");
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });
});

describe("PhilHealth claims — through an adapter (test double)", () => {
  let ctx: TestContext;
  let s: Setup;
  const gateway = new FakeGateway();
  const submit = (key: string) => s.req(s.cashier).post(`/philhealth/claims/invoices/${s.invoiceId}/submissions`, { idempotencyKey: key });

  beforeAll(async () => {
    ctx = await createTestApp({ philhealthGateway: { provide: PHILHEALTH_CLAIMS_GATEWAY, useValue: gateway } });
    s = await issuedInvoiceWithPhilHealth(ctx, "ph-adapter");
    await s.req(s.admin).put(`/philhealth/facilities/${s.tenant.facilityId}/accreditation`, { accreditationNumber: "H91000200" }).expect(200);
  });
  afterAll(() => ctx.close());

  it("queues a submission once per idempotency key, retries transient failures, and records the acknowledgement on the invoice", async () => {
    gateway.next = [{ outcome: "failed", retryable: true, error: "timeout" }];
    const queued = await submit("claim-attempt-1").expect(202);
    expect(queued.body).toMatchObject({ status: "queued", attempts: 0 });
    // Same key: same exchange. Another key while one is in flight: refused.
    expect((await submit("claim-attempt-1").expect(202)).body.id).toBe(queued.body.id);
    expect((await submit("claim-attempt-2").expect(409)).body.error.code).toBe("claim_already_submitted");

    await drainEvents(ctx); // first attempt fails transiently; the outbox keeps the event
    let [row] = (await ctx.pool.query("SELECT status, attempts, last_error, payload_digest FROM integration_exchange")).rows;
    expect(row).toMatchObject({ status: "queued", attempts: 1, last_error: "timeout" });
    await drainEvents(ctx); // retried: accepted
    [row] = (await ctx.pool.query("SELECT status, attempts, external_reference, payload_digest FROM integration_exchange")).rows;
    expect(row).toMatchObject({ status: "accepted", external_reference: "TX-2" });
    expect(row.payload_digest).toMatch(/^[0-9a-f]{64}$/);
    // The adapter got the full package (unmasked) and the same idempotency key both times.
    expect(gateway.received.map((r) => r.key)).toEqual(["claim-attempt-1", "claim-attempt-1"]);
    expect(gateway.received[1]!.claim.patient.philhealthPin).toBe("12-345678901-2");

    await drainEvents(ctx);
    const invoice = await s.req(s.cashier).get(`/billing/invoices/${s.invoiceId}`).expect(200);
    expect(invoice.body.payers[0]).toMatchObject({ status: "submitted", reference: "TX-2" });
    expect((await submit("claim-attempt-3").expect(409)).body.error.code).toBe("claim_already_submitted");

    const preview = await s.req(s.cashier).get(`/philhealth/claims/invoices/${s.invoiceId}`).expect(200);
    expect(preview.body.submissions).toEqual([expect.objectContaining({ status: "accepted", externalReference: "TX-2", attempts: 2 })]);
    const audit = await auditRows(ctx.pool, "action IN ('philhealth.claim.submit-request', 'philhealth.claim.exchange', 'billing.claim.status')");
    expect(audit.map((a) => [a.action, a.actor_type])).toEqual([
      ["philhealth.claim.submit-request", "user"],
      ["philhealth.claim.exchange", "system"],
      ["billing.claim.status", "system"],
    ]);
    // No PHI in the exchange log.
    const log = await ctx.pool.query("SELECT row_to_json(e)::text AS json FROM integration_exchange e");
    expect(log.rows[0].json).not.toMatch(/345678901|Dela Cruz|E11\.9/);
  });

  it("refuses a claim whose data changed after the request, and records rejections", async () => {
    // A second invoice for the same patient: a new consultation.
    const other = await issuedInvoiceWithPhilHealth(ctx, "ph-adapter-2");
    await other.req(other.admin).put(`/philhealth/facilities/${other.tenant.facilityId}/accreditation`, { accreditationNumber: "H91000300" }).expect(200);
    const post = (key: string) => other.req(other.cashier).post(`/philhealth/claims/invoices/${other.invoiceId}/submissions`, { idempotencyKey: key });

    await post("changed-claim-1").expect(202);
    await ctx.pool.query("UPDATE patient SET family_name = 'Dela Cruz-Santos' WHERE id = $1", [other.patientId]);
    const before = gateway.received.length;
    await drainEvents(ctx);
    expect(gateway.received.length).toBe(before); // nothing sent
    const changed = await ctx.pool.query("SELECT status, last_error FROM integration_exchange WHERE idempotency_key = 'changed-claim-1'");
    expect(changed.rows[0]).toMatchObject({ status: "failed", last_error: expect.stringMatching(/changed/) });

    gateway.next = [{ outcome: "rejected", reasons: [{ code: "R-TEST", message: "Rejected by the test double" }] }];
    await post("changed-claim-2").expect(202);
    await drainEvents(ctx);
    const rejected = await ctx.pool.query("SELECT status, outcome_detail FROM integration_exchange WHERE idempotency_key = 'changed-claim-2'");
    expect(rejected.rows[0]).toMatchObject({ status: "rejected", outcome_detail: { reasons: [{ code: "R-TEST", message: "Rejected by the test double" }] } });
    const invoice = await other.req(other.cashier).get(`/billing/invoices/${other.invoiceId}`).expect(200);
    expect(invoice.body.payers[0].status).toBe("pending");
  });
});
