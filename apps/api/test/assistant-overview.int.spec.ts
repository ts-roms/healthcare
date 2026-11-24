import { randomBytes } from "node:crypto";
import { AssistantRules } from "../src/app/assistant/assistant-rules";
import { as, auditRows, createStaff, createTenant, createTestApp, login, type Tenant, TEST_REDIS_URL, type TestContext } from "./harness";

/**
 * The Assistant section's overview (docs/domains/assistant.md, ADR-0019): what the rules that are on say now across
 * several screens in one request. One request is one audit row and one update of the shown counts; a rule is named only
 * to people who may read what it reads; rules that need a record on screen are listed with their state and never run;
 * one failing rule does not blank the others; and nothing of another organization shows.
 */
interface Surface {
  surface: string;
  rules: Array<{ ruleId: string; ruleVersion: number; title: string; description: string; on: boolean; needs: string }>;
  items: Array<{ id: string; ruleId: string; severity: string; title: string }>;
  more: number;
  dismissed: number;
  withheld: number;
  failed: boolean;
}

describe("assistant overview", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let other: Tenant;
  let admin: string;
  let officer: string;
  let assistantless: string;
  let stranger: string;
  const COVER = "inventory.days-of-cover";
  const COMPLIANCE = "admin.compliance-gaps";
  const ACCESS = "security.unusual-access";
  const CHECKLIST = "clinic.encounter-checklist";
  let key = 0;
  const nextKey = () => `overview-key-${++key}`;

  const api = (token: string, facilityId: string | undefined = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });
  const overview = async (token: string, query: string, facilityId?: string): Promise<Surface[]> =>
    (await api(token, facilityId).get(`/assistant/overview?${query}`).expect(200)).body.surfaces as Surface[];
  const turnOn = (ruleId: string) => api(admin).put(`/assistant/rules/${ruleId}/settings`, { enabled: true, expectedVersion: 0 }).expect(200);
  const views = () => auditRows(ctx.pool, "action = 'assistant.view'");
  const shownCounts = async () =>
    Object.fromEntries(
      (
        await ctx.pool.query<{ rule_id: string; shown: number }>(`SELECT rule_id, sum(shown)::int AS shown FROM assistant_rule_shown GROUP BY rule_id`)
      ).rows.map((r) => [r.rule_id, r.shown]),
    );

  /** `received` in, then five equal issues of `issued` in all. */
  async function stock(code: string, name: string, locationId: string, received: number, issued: number): Promise<void> {
    const item = (await api(officer).post("/inventory/items", { code, name, category: "medicine", stockUnit: "tablet" }).expect(201)).body.id;
    await api(officer).post("/inventory/receipts", { locationId, itemId: item, lotNumber: "L1", quantity: received, idempotencyKey: nextKey() }).expect(201);
    for (let i = 0; i < 5; i++) {
      await api(officer)
        .post("/inventory/issues", { locationId, itemId: item, quantity: issued / 5, issuedTo: "Ward A", idempotencyKey: nextKey() })
        .expect(201);
    }
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "overview-org");
    other = await createTenant(ctx.pool, "overview-other");
    await createStaff(ctx.pool, tenant, "admin@overview.ph", ["org_admin"]);
    await createStaff(ctx.pool, tenant, "officer@overview.ph", ["inventory_officer"]);
    // A dental assistant reads stock but holds no assistant.use.
    await createStaff(ctx.pool, tenant, "assistantless@overview.ph", ["dental_assistant"]);
    await createStaff(ctx.pool, other, "admin@overview-other.ph", ["org_admin"]);
    admin = (await login(ctx, "admin@overview.ph")).accessToken;
    officer = (await login(ctx, "officer@overview.ph")).accessToken;
    assistantless = (await login(ctx, "assistantless@overview.ph")).accessToken;
    stranger = (await login(ctx, "admin@overview-other.ph")).accessToken;

    const location = (await api(officer).post("/inventory/locations", { facilityId: tenant.facilityId, code: "pharmacy", name: "Pharmacy" }).expect(201)).body
      .id;
    // 30 of 130 left at about 3.3 a day: 9 days of cover, under the 14-day delivery time (advice).
    await stock("para-500", "Paracetamol 500 mg", location, 130, 100);
    // Nothing left of 100 (a warning).
    await stock("amox-500", "Amoxicillin 500 mg", location, 100, 100);
  });
  afterAll(() => ctx.close());

  it("needs assistant.use and a facility, and refuses a screen it does not know", async () => {
    await api(assistantless).get("/assistant/overview?surfaces=inventory").expect(403);
    await api(officer, "").get("/assistant/overview?surfaces=inventory").expect(400);
    await api(officer).get("/assistant/overview?surfaces=inventory,nowhere").expect(400);
    // Another organization's facility is not the caller's to read.
    await api(stranger, tenant.facilityId).get("/assistant/overview?surfaces=inventory").expect(403);
  });

  it("lists the rules a person may read as off until one is turned on, and says nothing", async () => {
    const [inventory] = await overview(officer, "surfaces=inventory");
    expect(inventory).toMatchObject({ surface: "inventory", items: [], more: 0, dismissed: 0, withheld: 0, failed: false });
    expect(inventory!.rules.map((r) => [r.ruleId, r.on, r.needs])).toEqual([
      [COVER, false, "nothing"],
      ["inventory.usage-spike", false, "nothing"],
      ["inventory.expiry-exposure", false, "nothing"],
    ]);
    expect(inventory!.rules[0]).toMatchObject({ ruleVersion: 1, title: "Stock may run out before a delivery arrives" });
    expect(inventory!.rules[0]!.description).toContain("usable stock");
    // Thresholds stay with administrators: a rule is named with its state, never its settings.
    expect(JSON.stringify(inventory)).not.toContain("leadTimeDays");
  });

  it("answers several screens in one request, warnings first, with one audit row and each rule counted once", async () => {
    await turnOn(COVER);
    await turnOn(COMPLIANCE);
    const auditsBefore = (await views()).length;

    const [inventory, settings] = await overview(admin, "surfaces=inventory,settings");
    expect(inventory!.rules.find((r) => r.ruleId === COVER)).toMatchObject({ on: true, needs: "nothing" });
    expect(inventory!.items.map((s) => [s.ruleId, s.severity])).toEqual([
      [COVER, "warning"],
      [COVER, "advice"],
    ]);
    expect(inventory!.items[0]!.title).toContain("Amoxicillin 500 mg");
    expect(inventory!.items[1]!.title).toContain("Paracetamol 500 mg");
    expect(settings).toMatchObject({ surface: "settings", failed: false, withheld: 0 });
    expect(settings!.items.map((s) => s.ruleId)).toEqual([COMPLIANCE]);

    const audits = await views();
    expect(audits).toHaveLength(auditsBefore + 1);
    expect(audits.at(-1)!.metadata).toEqual({ via: "overview", surfaces: ["inventory", "settings"], rules: [COVER, COMPLIANCE], shown: 3 });
    // Rule ids and counts only: never a finding.
    expect(JSON.stringify(audits)).not.toContain("Amoxicillin");
    expect(await shownCounts()).toEqual({ [COVER]: 2, [COMPLIANCE]: 1 });
  });

  it("answers at most the limit per screen and counts the rest", async () => {
    const [inventory] = await overview(admin, "surfaces=inventory&limit=1");
    expect(inventory!.items).toHaveLength(1);
    expect(inventory!.items[0]!.severity).toBe("warning");
    expect(inventory!.more).toBe(1);
    // Only what was answered counts as shown.
    expect((await shownCounts())[COVER]).toBe(3);
    await api(admin).get("/assistant/overview?surfaces=inventory&limit=0").expect(400);
  });

  it("names a rule only to people who may read what it reads", async () => {
    await turnOn(ACCESS);
    // The inventory officer reads neither the audit trail nor the compliance register.
    const body = (await api(officer).get("/assistant/overview?surfaces=settings,security").expect(200)).body as { surfaces: Surface[] };
    expect(body.surfaces).toEqual([
      { surface: "settings", rules: [], items: [], more: 0, dismissed: 0, withheld: 1, failed: false },
      { surface: "security", rules: [], items: [], more: 0, dismissed: 0, withheld: 1, failed: false },
    ]);
    const text = JSON.stringify(body);
    for (const hidden of [ACCESS, COMPLIANCE, "record access", "Compliance"]) expect(text).not.toContain(hidden);
    // The screen's own route says how many too, and no longer which.
    const screen = (await api(officer).get("/assistant/suggestions?surface=security").expect(200)).body;
    expect(screen).toEqual({ items: [], dismissed: 0, withheld: 1 });
  });

  it("lists a rule that needs a record on screen with its state, and never runs it", async () => {
    await turnOn(CHECKLIST);
    const run = jest.spyOn(ctx.app.get(AssistantRules).find(CHECKLIST)!, "run");
    const auditsBefore = (await views()).length;
    const [encounter] = await overview(admin, "surfaces=encounter");
    expect(run).not.toHaveBeenCalled();
    run.mockRestore();
    expect(encounter!.items).toEqual([]);
    expect(encounter!.rules.find((r) => r.ruleId === CHECKLIST)).toMatchObject({ on: true, needs: "encounter" });
    expect(encounter!.rules.every((r) => r.needs === "encounter")).toBe(true);
    const audits = await views();
    expect(audits).toHaveLength(auditsBefore + 1);
    expect(audits.at(-1)!.metadata).toEqual({ via: "overview", surfaces: ["encounter"], rules: [], shown: 0 });
  });

  it("declares what every rule needs: seventeen read the facility, eleven a record on screen", () => {
    const needs = Object.fromEntries(ctx.app.get(AssistantRules).bindings.map((b) => [b.definition.id, b.needs]));
    expect(Object.keys(needs)).toHaveLength(28);
    expect(
      Object.entries(needs)
        .filter(([, need]) => need !== "nothing")
        .sort(([a], [b]) => a.localeCompare(b)),
    ).toEqual([
      ["clinic.code-suggestions", "encounter"],
      ["clinic.encounter-checklist", "encounter"],
      ["dental.chart-consistency", "patient"],
      ["dental.plan-decisions", "patient"],
      ["dispensing.course-expiry", "prescription"],
      ["laboratory.monitoring-gap", "encounter"],
      ["laboratory.order-sets", "encounter"],
      ["prescription.check-prompts", "draft"],
      ["prescription.dose-limit", "draft"],
      ["prescription.duplicate-therapy", "draft"],
      ["telemedicine.in-person-care", "encounter"],
    ]);
  });

  it("hides what a person dismissed here on its own screen too, and the other way round", async () => {
    const [before] = await overview(officer, "surfaces=inventory");
    const [warning, advice] = before!.items;
    await api(officer)
      .post(`/assistant/suggestions/${encodeURIComponent(warning!.id)}/feedback`, { outcome: "dismissed" })
      .expect(201);
    const [after] = await overview(officer, "surfaces=inventory");
    expect(after!.items.map((s) => s.id)).toEqual([advice!.id]);
    expect(after!.dismissed).toBe(1);
    // The same finding is hidden on the inventory screen for that person, and still shown to others.
    const screen = (await api(officer).get("/assistant/suggestions?surface=inventory").expect(200)).body;
    expect(screen.items.map((s: { id: string }) => s.id)).toEqual([advice!.id]);
    expect(screen.dismissed).toBe(1);
    expect((await overview(admin, "surfaces=inventory"))[0]!.items).toHaveLength(2);
  });

  it("still answers the other screens when one rule fails", async () => {
    const run = jest.spyOn(ctx.app.get(AssistantRules).find(COVER)!, "run").mockRejectedValueOnce(new Error("ledger unreachable"));
    const [inventory, settings] = await overview(admin, "surfaces=inventory,settings");
    run.mockRestore();
    expect(inventory).toMatchObject({ items: [], failed: true });
    expect(settings!.failed).toBe(false);
    expect(settings!.items.map((s) => s.ruleId)).toEqual([COMPLIANCE]);
    // The screen's own route still reports the failure as its own.
    const again = jest.spyOn(ctx.app.get(AssistantRules).find(COVER)!, "run").mockRejectedValueOnce(new Error("ledger unreachable"));
    await api(admin).get("/assistant/suggestions?surface=inventory").expect(500);
    again.mockRestore();
  });

  it("shows another organization nothing of this one's rules or stock", async () => {
    const theirs = await overview(stranger, "surfaces=inventory,settings,security,encounter", other.facilityId);
    expect(theirs.flatMap((s) => s.items)).toEqual([]);
    expect(theirs.flatMap((s) => s.rules).every((r) => !r.on)).toBe(true);
    expect(theirs.every((s) => s.withheld === 0 && !s.failed)).toBe(true);
  });
});

describe("assistant overview rate limit", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let one: string;
  let two: string;

  const overview = (token: string) => ctx.http().get("/api/v1/assistant/overview?surfaces=inventory").set(as(token, tenant.facilityId));

  beforeAll(async () => {
    ctx = await createTestApp({
      disableRateLimit: false,
      rateLimitStorage: { redisUrl: TEST_REDIS_URL, keyPrefix: `overview-throttle-${randomBytes(4).toString("hex")}:` },
    });
    tenant = await createTenant(ctx.pool, "overview-limits-org");
    for (const name of ["one", "two"]) await createStaff(ctx.pool, tenant, `${name}@ol.ph`, ["inventory_officer"]);
    one = (await login(ctx, "one@ol.ph")).accessToken;
    two = (await login(ctx, "two@ol.ph")).accessToken;
  });
  afterAll(() => ctx.close());

  it("counts each person's own requests: one person at their limit does not stop a colleague on the same address", async () => {
    // Thirty overviews a minute per person; every request here comes from the same address.
    for (let i = 0; i < 30; i += 1) await overview(one).expect(200);
    const refused = await overview(one).expect(429);
    expect(refused.body.error.code).toBe("rate_limited");
    await overview(two).expect(200);
  });
});
