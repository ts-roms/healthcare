import { as, auditRows, createStaff, createTenant, createTestApp, login, manilaDate, type Tenant, type TestContext } from "./harness";

interface RuleInsight {
  ruleId: string;
  enabled: { organization: boolean; facilities: number };
  shown: number;
  accepted: number;
  dismissed: number;
  notUseful: number;
  answered: number;
  reviewDue: boolean;
  reasons: Array<{ outcome: string; reason: string; at: string }>;
  lastReview: { outcome: string; note: string; falsePositives: string | null; reviewedOn: string; ruleVersion: number } | null;
}

/**
 * Phase 4 of the assistant, governance (migration 0159, docs/runbooks/assistant-rule-review.md): how often each rule was
 * shown, followed and dismissed, the reasons staff gave, and the organization's reviews of a rule — keep, adjust, or
 * retire it, which turns it off wherever it is on. Counts and staff's own words only.
 */
describe("assistant governance", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let officer: string;
  const RULE = "inventory.days-of-cover";
  let key = 0;
  const nextKey = () => `governance-key-${++key}`;

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const insight = async (days = 30) =>
    ((await api(admin).get(`/assistant/insights?days=${days}`).expect(200)).body.rules as RuleInsight[]).find((r) => r.ruleId === RULE)!;
  const suggestions = async () => (await api(officer).get("/assistant/suggestions?surface=inventory").expect(200)).body.items as Array<{ id: string }>;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "assistant-governance");
    await createStaff(ctx.pool, tenant, "admin@governance.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "officer@governance.ph", ["inventory_officer"]);
    admin = (await login(ctx, "admin@governance.ph")).accessToken;
    officer = (await login(ctx, "officer@governance.ph")).accessToken;

    // 130 tablets received, 5 issues of 20: the stock rule has something to say once it is on.
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

  it("counts how often a rule's suggestions were shown and followed, and keeps the reasons staff give", async () => {
    await api(admin).put(`/assistant/rules/${RULE}/settings`, { enabled: true, expectedVersion: 0 }).expect(200);
    const [s] = await suggestions();
    await suggestions();
    // Following the link (counted as followed) hides nothing; "not useful" with a reason hides it from that person.
    await api(officer)
      .post(`/assistant/suggestions/${encodeURIComponent(s!.id)}/feedback`, { outcome: "accepted" })
      .expect(201);
    expect(await suggestions()).toHaveLength(1);
    await api(officer)
      .post(`/assistant/suggestions/${encodeURIComponent(s!.id)}/feedback`, { outcome: "not_useful", reason: "A standing order covers this item every week" })
      .expect(201);
    expect(await suggestions()).toEqual([]);

    const row = await insight();
    expect(row).toMatchObject({
      enabled: { organization: true, facilities: 0 },
      shown: 3,
      accepted: 1,
      notUseful: 1,
      answered: 2,
      // On, never reviewed.
      reviewDue: true,
      lastReview: null,
    });
    expect(row.reasons).toEqual([{ outcome: "not_useful", reason: "A standing order covers this item every week", at: expect.any(String) }]);
    const { rows } = await ctx.pool.query("SELECT rule_id, shown FROM assistant_rule_shown WHERE organization_id = $1", [tenant.organizationId]);
    expect(rows).toEqual([{ rule_id: RULE, shown: 3 }]);
    // Insights and reviews are the administrator's.
    await api(officer).get("/assistant/insights").expect(403);
    await api(officer)
      .post(`/assistant/rules/${RULE}/reviews`, { outcome: "keep", note: "Fine", reviewedOn: manilaDate(0) })
      .expect(403);
  });

  it("records reviews, and retires a rule wherever it is on", async () => {
    await api(admin)
      .post(`/assistant/rules/${RULE}/reviews`, { outcome: "keep", note: "Too early", reviewedOn: manilaDate(1) })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("review_date_in_future"));
    await api(admin)
      .post("/assistant/rules/nope/reviews", { outcome: "keep", note: "Fine", reviewedOn: manilaDate(0) })
      .expect(404);
    await api(admin)
      .post(`/assistant/rules/${RULE}/reviews`, { outcome: "keep", note: "Useful for most items", reviewedOn: manilaDate(0) })
      .expect(201);
    expect(await insight()).toMatchObject({ reviewDue: false, lastReview: { outcome: "keep", note: "Useful for most items", reviewedOn: manilaDate(0) } });

    // On for the organization and, with its own setting, for the facility: retiring turns both off.
    await api(admin).put(`/assistant/rules/${RULE}/settings`, { facilityId: tenant.facilityId, enabled: true, expectedVersion: 0 }).expect(200);
    const retired = await api(admin)
      .post(`/assistant/rules/${RULE}/reviews`, {
        outcome: "retire",
        note: "Standing orders make it wrong for most of our stock",
        falsePositives: "Items on a weekly standing order",
        reviewedOn: manilaDate(0),
      })
      .expect(201);
    expect(retired.body).toMatchObject({ outcome: "retire", turnedOff: 2 });
    const settings = async (query = "") =>
      (
        (await api(admin).get(`/assistant/rules${query}`).expect(200)).body as Array<{
          ruleId: string;
          setting: { enabled: boolean } | null;
          lastReview: unknown;
        }>
      ).find((r) => r.ruleId === RULE)!;
    const org = await settings();
    expect(org.setting).toMatchObject({ enabled: false });
    expect(org.lastReview).toMatchObject({ outcome: "retire", falsePositives: "Items on a weekly standing order" });
    expect((await settings(`?facilityId=${tenant.facilityId}`)).setting).toMatchObject({ enabled: false });
    // Off everywhere: nothing is suggested and nothing is due.
    expect(await suggestions()).toEqual([]);
    expect(await insight()).toMatchObject({ enabled: { organization: false, facilities: 0 }, reviewDue: false, lastReview: { outcome: "retire" } });

    const history = (await api(admin).get(`/assistant/rules/${RULE}/reviews`).expect(200)).body;
    expect(history.map((r: { outcome: string; recordedBy: string }) => [r.outcome, r.recordedBy])).toEqual([
      ["retire", "admin@governance.ph"],
      ["keep", "admin@governance.ph"],
    ]);
    // Audited with the outcome, never the note; the reviews cannot be changed.
    const audit = await auditRows(ctx.pool, "action = 'assistant.rule-review'");
    expect(audit.map((a) => a.metadata)).toEqual([
      expect.objectContaining({ ruleId: RULE, outcome: "keep", turnedOff: 0 }),
      expect.objectContaining({ ruleId: RULE, outcome: "retire", turnedOff: 2 }),
    ]);
    expect(JSON.stringify(audit)).not.toMatch(/Standing orders|weekly standing order/);
    await expect(ctx.pool.query("UPDATE assistant_rule_review SET note = 'changed' WHERE organization_id = $1", [tenant.organizationId])).rejects.toThrow();
  });
});
