import { as, createStaff, createTenant, createTestApp, juan, login, manilaDate, type Tenant, type TestContext } from "./harness";

interface Suggestion {
  id: string;
  ruleId: string;
  severity: string;
  strength: string;
  title: string;
  evidence: Array<{ label: string; value?: string }>;
  action?: { href: string };
}

/**
 * The heuristic assistant, phase 2 integrity and security (docs/domains/assistant.md): staff accounts whose access to
 * patient records stands out in the audit trail (administrators only), compliance areas to review, and invoices that may
 * have been issued twice. Off until turned on; nothing is blocked or changed; no patient is named.
 */
describe("heuristic assistant, integrity and security", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let cashier: string;
  let receptionistId: string;
  let nurseId: string;

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const turnOn = (ruleId: string) => api(admin).put(`/assistant/rules/${ruleId}/settings`, { enabled: true, expectedVersion: 0 }).expect(200);
  const items = async (token: string, surface: string) =>
    (await api(token).get(`/assistant/suggestions?surface=${surface}`).expect(200)).body as { items: Suggestion[]; withheld: number };

  /** Audit rows for an account: `count` distinct patients at `hoursAgo`, with an outcome. */
  const accesses = (userId: string, count: number, at: string, outcome = "success") =>
    ctx.pool.query(
      `INSERT INTO audit_event (organization_id, facility_id, actor_type, actor_user_id, action, resource_type, resource_id, patient_id, outcome, occurred_at)
       SELECT $1, $2, 'user', $3, 'patient.view', 'patient', g::text, CASE WHEN $5 = 'success' THEN gen_random_uuid() END, $5, ${at}
       FROM generate_series(1, $4) g`,
      [tenant.organizationId, tenant.facilityId, userId, count, outcome],
    );

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "assistant-integrity");
    await createStaff(ctx.pool, tenant, "admin@integrity.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "cashier@integrity.ph", ["cashier"]);
    receptionistId = await createStaff(ctx.pool, tenant, "reception@integrity.ph", ["receptionist"]);
    nurseId = await createStaff(ctx.pool, tenant, "nurse@integrity.ph", ["nurse"]);
    admin = (await login(ctx, "admin@integrity.ph")).accessToken;
    cashier = (await login(ctx, "cashier@integrity.ph")).accessToken;
  });
  afterAll(() => ctx.close());

  it("points administrators to accounts whose record access stands out, and no one else", async () => {
    // The receptionist usually opens about 10 patients a day; today 80. The nurse was refused 12 times.
    for (let day = 2; day <= 7; day++) await accesses(receptionistId, 10, `now() - interval '${day} days'`);
    await accesses(receptionistId, 80, "now() - interval '1 hour'");
    await accesses(nurseId, 12, "now() - interval '2 hours'", "denied");

    expect((await items(admin, "security")).items).toEqual([]);
    await turnOn("security.unusual-access");
    const found = (await items(admin, "security")).items;
    // (If the test runs outside 07:00–19:00 Manila time, today's 80 also count as outside working hours: order and severity vary.)
    expect(found.map((s) => s.title).sort()).toEqual([
      "nurse@integrity.ph: was refused 12 times",
      "reception@integrity.ph: opened 80 patients' records in 24 hours, against about 10 on a usual day",
    ]);
    const reception = found.find((s) => s.title.startsWith("reception@"))!;
    expect(reception).toMatchObject({ strength: "matched", action: { href: `/admin/audit?actor=${receptionistId}` } });
    // Counts only: no evidence value names a record.
    expect(found.flatMap((s) => s.evidence.map((e) => e.value ?? "")).filter((v) => /[0-9a-f]{8}-[0-9a-f]{4}-/.test(v))).toEqual([]);
    // A cashier may use the assistant but cannot read the audit trail: the rule is withheld, with no counts.
    const theirs = await items(cashier, "security");
    expect(theirs.items).toEqual([]);
    expect(theirs.withheld).toBe(1);
  });

  it("lists compliance areas to review in one suggestion, and follows the reviews", async () => {
    await turnOn("admin.compliance-gaps");
    const [before] = (await items(admin, "settings")).items;
    expect(before).toMatchObject({ ruleId: "admin.compliance-gaps", severity: "advice", action: { href: "/admin/compliance" } });
    expect(before!.title).toBe("8 compliance areas to review: 8 never reviewed");
    await api(admin)
      .post("/compliance/reviews", {
        area: "data_privacy",
        outcome: "changes_needed",
        reviewerName: "Ana Cruz",
        reviewerRole: "Data Protection Officer",
        reference: "Privacy review 2026-11",
        reviewedOn: manilaDate(0),
      })
      .expect(201);
    const [after] = (await items(admin, "settings")).items;
    expect(after!.severity).toBe("warning");
    expect(after!.title).toBe("8 compliance areas to review: 1 found changes needed, 7 never reviewed");
    expect(after!.id).not.toBe(before!.id);
  });

  it("finds two invoices for the same patient, total and services, by number and never by patient", async () => {
    const patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
    const service = (
      await api(admin)
        .post("/billing/services", { code: "consult", name: "Consultation fee", category: "consultation", unitPrice: 50_000, effectiveFrom: manilaDate(-30) })
        .expect(201)
    ).body.id;
    const invoice = async () => {
      await api(cashier).post("/billing/charges", { patientId, serviceId: service }).expect(201);
      const draft = (await api(cashier).post("/billing/invoices", { patientId }).expect(201)).body;
      return (await api(cashier).post(`/billing/invoices/${draft.id}/issue`, { version: draft.version }).expect(200)).body as {
        id: string;
        invoiceNumber: string;
      };
    };
    const first = await invoice();
    const second = await invoice();
    await turnOn("billing.possible-duplicate-invoice");
    const [s] = (await items(cashier, "billing")).items.filter((x) => x.ruleId === "billing.possible-duplicate-invoice");
    expect(s!.title).toBe(`Invoices ${first.invoiceNumber} and ${second.invoiceNumber} may be the same visit billed twice`);
    expect(s!.action!.href).toBe(`/billing/invoices/${second.id}`);
    expect(JSON.stringify(s)).not.toMatch(/Juan|Dela Cruz/i);
    // Nothing changed: both invoices are still issued.
    const { rows } = await ctx.pool.query("SELECT status FROM billing_invoice WHERE id = ANY($1::uuid[])", [[first.id, second.id]]);
    expect(rows.map((r) => r.status)).toEqual(["issued", "issued"]);
  });

  it("refuses working hours that end before they start, in the field's words", async () => {
    await api(admin)
      .post("/assistant/rules/security.unusual-access/replay", {
        days: 2,
        parameters: { windowHours: 24, minPatients: 50, multiple: 3, workStartHour: 19, workEndHour: 7, minOffHoursPatients: 5, minDenials: 10 },
      })
      .expect(422)
      .expect((r) => expect(r.body.error.message).toBe("Working hours end at: Working hours must end after they start."));
  });
});
