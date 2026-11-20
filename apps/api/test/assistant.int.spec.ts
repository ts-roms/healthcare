import { as, auditRows, createStaff, createTenant, createTestApp, login, type Tenant, type TestContext } from "./harness";

/**
 * The heuristic assistant, phase 0 (migration 0152, docs/architecture/heuristic-assistant.md): rules are off until an
 * administrator turns them on; the inventory rule suggests an order from the ledger's own pace of issues; a dismissal
 * hides the suggestion from that person; settings are versioned; the assistant writes nothing but its own feedback.
 */
describe("heuristic assistant", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let officer: string;
  let nurse: string;
  const RULE = "inventory.days-of-cover";
  let key = 0;
  const nextKey = () => `assistant-key-${++key}`;

  const api = (token: string, facilityId: string | undefined = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });
  const suggestions = (token: string, facilityId?: string) => api(token, facilityId).get("/assistant/suggestions?surface=inventory");

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "assistant-org");
    await createStaff(ctx.pool, tenant, "admin@assistant.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "officer@assistant.ph", ["inventory_officer"]);
    // A medical technologist reads stock but holds no assistant.use.
    await createStaff(ctx.pool, tenant, "nurse@assistant.ph", ["medical_technologist"]);
    admin = (await login(ctx, "admin@assistant.ph")).accessToken;
    officer = (await login(ctx, "officer@assistant.ph")).accessToken;
    nurse = (await login(ctx, "nurse@assistant.ph")).accessToken;

    // 130 tablets received, 5 issues of 20 in the last days: 30 left, about 3.3 a day over 30 days.
    const item = (
      await api(officer).post("/inventory/items", { code: "para-500", name: "Paracetamol 500 mg", category: "medicine", stockUnit: "tablet" }).expect(201)
    ).body.id;
    const location = (await api(officer).post("/inventory/locations", { facilityId: tenant.facilityId, code: "pharmacy", name: "Pharmacy" }).expect(201)).body
      .id;
    await api(officer)
      .post("/inventory/receipts", { locationId: location, itemId: item, lotNumber: "L1", quantity: 130, idempotencyKey: nextKey() })
      .expect(201);
    for (let i = 0; i < 5; i++) {
      await api(officer)
        .post("/inventory/issues", { locationId: location, itemId: item, quantity: 20, issuedTo: "Ward A", idempotencyKey: nextKey() })
        .expect(201);
    }
  });
  afterAll(() => ctx.close());

  it("is limited to the roles that hold its permissions", async () => {
    await suggestions(nurse).expect(403);
    await api(officer).get("/assistant/rules").expect(403);
    await api(officer).put(`/assistant/rules/${RULE}/settings`, { enabled: true, expectedVersion: 0 }).expect(403);
    await api(officer).get("/assistant/insights").expect(403);
    await suggestions(officer, "").expect(400); // a facility is required
  });

  it("says nothing until a rule is turned on", async () => {
    const res = await suggestions(officer).expect(200);
    expect(res.body).toEqual({ items: [], dismissed: 0, withheld: [] });
    const rules = (await api(admin).get("/assistant/rules").expect(200)).body as Array<{ ruleId: string; setting: unknown; defaultParameters: object }>;
    expect(rules.find((r) => r.ruleId === RULE)).toMatchObject({
      setting: null,
      organizationSetting: null,
      defaultParameters: { windowDays: 30, leadTimeDays: 14 },
      // The settings screen names each parameter from the rule itself.
      parameterLabels: { leadTimeDays: { label: "Delivery time", unit: "days", min: 1, max: 120 } },
    });
  });

  it("keeps versioned settings: validated, audited and refused when stale", async () => {
    await api(admin)
      .put(`/assistant/rules/${RULE}/settings`, {
        enabled: true,
        parameters: { windowDays: 1, leadTimeDays: 14, targetCoverDays: 30, minIssues: 5 },
        expectedVersion: 0,
      })
      .expect(422)
      .expect((res) => {
        expect(res.body.error).toMatchObject({ code: "invalid_rule_parameters", message: "Pace measured over the last: enter a whole number from 7 to 180." });
      });
    await api(admin).put(`/assistant/rules/nope/settings`, { enabled: true, expectedVersion: 0 }).expect(404);
    const first = await api(admin).put(`/assistant/rules/${RULE}/settings`, { enabled: true, expectedVersion: 0 }).expect(200);
    expect(first.body).toMatchObject({
      ruleId: RULE,
      version: 1,
      enabled: true,
      parameters: { windowDays: 30, leadTimeDays: 14, targetCoverDays: 30, minIssues: 5 },
    });
    await api(admin).put(`/assistant/rules/${RULE}/settings`, { enabled: true, expectedVersion: 0 }).expect(409);
    const audits = await auditRows(ctx.pool, "action = 'assistant.rule-setting'");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ ruleId: RULE, enabled: true, version: 1 });
  });

  let suggestionId: string;

  it("suggests an order from the pace of issues, with its evidence, and audits only rule ids", async () => {
    const res = await suggestions(officer).expect(200);
    expect(res.body.items).toHaveLength(1);
    const s = res.body.items[0];
    suggestionId = s.id;
    expect(s).toMatchObject({
      ruleId: RULE,
      ruleVersion: 1,
      surface: "inventory",
      severity: "advice",
      basis: "statistic",
      strength: "matched",
      action: { href: "/inventory/purchase-orders" },
    });
    expect(s.title).toContain("Paracetamol 500 mg");
    expect(s.rationale).toContain("Ordering 70 tablet");
    expect(s.evidence.map((e: { label: string; value: string }) => e.value)).toEqual(expect.arrayContaining(["30 tablet", "100 tablet in 5 issues"]));

    const views = await auditRows(ctx.pool, "action = 'assistant.view'");
    expect(views.at(-1)!.metadata).toEqual({ surface: "inventory", rules: [RULE], shown: 1 });
    expect(JSON.stringify(views)).not.toContain("Paracetamol");
  });

  it("hides a dismissed suggestion from that person only, and leaves the ledger untouched", async () => {
    const before = await ctx.pool.query("SELECT count(*)::int AS n FROM inventory_movement");
    await api(officer)
      .post(`/assistant/suggestions/${encodeURIComponent(suggestionId)}/feedback`, { outcome: "dismissed", reason: "Ordered by phone" })
      .expect(201);
    const mine = await suggestions(officer).expect(200);
    expect(mine.body).toMatchObject({ items: [], dismissed: 1 });
    expect((await suggestions(admin).expect(200)).body.items).toHaveLength(1);
    const after = await ctx.pool.query("SELECT count(*)::int AS n FROM inventory_movement");
    expect(after.rows[0].n).toBe(before.rows[0].n);
    await api(officer)
      .post(`/assistant/suggestions/${encodeURIComponent("inventory.days-of-cover@1:item:x")}/feedback`, { outcome: "accepted" })
      .expect(201);
    await api(officer)
      .post(`/assistant/suggestions/${encodeURIComponent("unknown.rule@1:item:x")}/feedback`, { outcome: "accepted" })
      .expect(404);
    await api(officer)
      .post(`/assistant/suggestions/${encodeURIComponent(suggestionId)}/feedback`, { outcome: "maybe" })
      .expect(400);
  });

  it("records feedback append-only, announces it by id only and counts it in the insights", async () => {
    await expect(ctx.pool.query("UPDATE assistant_feedback SET outcome = 'accepted'")).rejects.toThrow();
    const { rows } = await ctx.pool.query("SELECT payload FROM domain_event WHERE event_type = 'AssistantSuggestionActedOn'");
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain("Paracetamol");
    const insights = (await api(admin).get("/assistant/insights").expect(200)).body as {
      rules: Array<{ ruleId: string; accepted: number; dismissed: number; answered: number }>;
    };
    expect(insights.rules.find((r) => r.ruleId === RULE)).toMatchObject({ accepted: 1, dismissed: 1, answered: 2 });
  });

  it("lets a facility turn the rule off for itself without changing the organization's setting", async () => {
    await api(admin).put(`/assistant/rules/${RULE}/settings`, { facilityId: tenant.facilityId, enabled: false, expectedVersion: 0 }).expect(200);
    expect((await suggestions(admin).expect(200)).body.items).toEqual([]);
    const scoped = (await api(admin).get(`/assistant/rules?facilityId=${tenant.facilityId}`).expect(200)).body as Array<{
      ruleId: string;
      setting: { enabled: boolean };
      organizationSetting: { enabled: boolean };
    }>;
    expect(scoped.find((r) => r.ruleId === RULE)).toMatchObject({ setting: { enabled: false }, organizationSetting: { enabled: true } });
    const org = (await api(admin).get("/assistant/rules").expect(200)).body as Array<{ ruleId: string; setting: { enabled: boolean } }>;
    expect(org.find((r) => r.ruleId === RULE)!.setting.enabled).toBe(true);
    await api(admin)
      .put(`/assistant/rules/${RULE}/settings`, { facilityId: "00000000-0000-4000-8000-000000000000", enabled: true, expectedVersion: 0 })
      .expect(404);
  });
});
