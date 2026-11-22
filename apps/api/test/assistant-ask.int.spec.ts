import { randomBytes } from "node:crypto";
import { localDate } from "@healthcare/core";
import { ASK_QUESTIONS } from "../src/app/assistant/ask/ask-catalogue";
import { as, auditRows, createStaff, createTenant, createTestApp, login, type Tenant, TEST_REDIS_URL, type TestContext } from "./harness";

/**
 * The assistant's Ask (docs/domains/assistant.md, "Ask"; ADR-0019): a typed question is read against a closed catalogue
 * by a route that reads no figures and keeps nothing; a catalogue question is answered by the public method of the route
 * that shows its figures, never past that route's permissions; every answer is audited without any text; a person's
 * questions keep the question, period and scope only, for that person alone.
 */
const ROLES = [
  "org_admin",
  "inventory_officer",
  "cashier",
  "receptionist",
  "nurse",
  "physician",
  "dentist",
  "medical_technologist",
  "pathologist",
  "pharmacist",
] as const;

/** A name typed into a question that must never be kept anywhere. */
const TYPED = "How many no-shows did Juanita Placeholder have last week?";

describe("assistant Ask", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let other: Tenant;
  const tokens: Record<string, string> = {};
  let stranger: string;
  let noAsk: string;
  let key = 0;
  const nextKey = () => `ask-key-${++key}`;

  const api = (token: string, facilityId: string | undefined = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });
  const admin = () => tokens["org_admin"]!;
  const answer = async (token: string, body: object) => (await api(token).post("/assistant/ask/answer", body).expect(200)).body;

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "ask-org");
    other = await createTenant(ctx.pool, "ask-other");
    for (const role of ROLES) {
      await createStaff(ctx.pool, tenant, `${role}@ask.ph`, [role]);
      tokens[role] = (await login(ctx, `${role}@ask.ph`)).accessToken;
    }
    // A dental assistant holds no assistant.ask.
    await createStaff(ctx.pool, tenant, "dental-assistant@ask.ph", ["dental_assistant"]);
    noAsk = (await login(ctx, "dental-assistant@ask.ph")).accessToken;
    await createStaff(ctx.pool, other, "admin@ask-other.ph", ["org_admin"]);
    stranger = (await login(ctx, "admin@ask-other.ph")).accessToken;

    // One item low on stock: 5 left, reorder level 20.
    const officer = tokens["inventory_officer"]!;
    const location = (await api(officer).post("/inventory/locations", { facilityId: tenant.facilityId, code: "store", name: "Main store" }).expect(201)).body
      .id;
    const item = (await api(officer).post("/inventory/items", { code: "gauze", name: "Gauze pad", category: "medical_supply", stockUnit: "pack" }).expect(201))
      .body.id;
    await api(officer).post("/inventory/receipts", { locationId: location, itemId: item, lotNumber: "L1", quantity: 5, idempotencyKey: nextKey() }).expect(201);
    await api(officer).put(`/inventory/locations/${location}/items/${item}/reorder-level`, { reorderLevel: 20 }).expect(200);
  });
  afterAll(() => ctx.close());

  it("needs assistant.ask and a facility", async () => {
    await api(noAsk).get("/assistant/ask/questions").expect(403);
    await api(noAsk).post("/assistant/ask/interpret", { text: "no-shows last week" }).expect(403);
    await api(noAsk).post("/assistant/ask/answer", { questionId: "inventory.low" }).expect(403);
    await api(admin(), "").get("/assistant/ask/questions").expect(400);
  });

  it("lists the questions, marked as the caller's to see or not", async () => {
    type Listed = { id: string; allowed: boolean; examples: Array<{ text: string; period?: string; compare?: string }> };
    const mine = (await api(tokens["receptionist"]!).get("/assistant/ask/questions").expect(200)).body as Listed[];
    expect(mine.map((q) => q.id)).toEqual(ASK_QUESTIONS.map((q) => q.id));
    const allowed = mine.filter((q) => q.allowed).map((q) => q.id);
    expect(allowed).toEqual(expect.arrayContaining(["clinic.appointments", "clinic.waiting-now"]));
    expect(allowed).not.toContain("billing.revenue");
    // Each example comes read, so a chip opens its answer without sending words.
    expect(mine.find((q) => q.id === "clinic.no-shows")?.examples).toEqual(
      expect.arrayContaining([
        { text: "No-shows last week", period: "last-week" },
        { text: "No-shows this month vs last month", period: "this-month", compare: "previous" },
      ]),
    );
  });

  it("reads a typed question without reading figures or keeping anything", async () => {
    const auditsBefore = (await auditRows(ctx.pool)).length;
    const read = (await api(admin()).post("/assistant/ask/interpret", { text: TYPED }).expect(200)).body;
    expect(read).toEqual({ kind: "question", questionId: "clinic.no-shows", title: "No-shows", period: "last-week", scope: "facility", notes: [] });
    expect(
      (await api(admin()).post("/assistant/ask/interpret", { text: "revenue this month vs last month for all facilities" }).expect(200)).body,
    ).toMatchObject({
      questionId: "billing.revenue",
      period: "this-month",
      compare: "previous",
      scope: "organization",
    });
    // "All facilities" applies only to questions answered from the management dashboard.
    expect((await api(admin()).post("/assistant/ask/interpret", { text: "what is running low", allFacilities: true }).expect(200)).body).toMatchObject({
      questionId: "inventory.low",
      scope: "facility",
    });
    expect((await api(admin()).post("/assistant/ask/interpret", { text: "what is Juanita Placeholder's blood pressure" }).expect(200)).body).toEqual({
      kind: "unrecognised",
    });
    expect((await auditRows(ctx.pool)).length).toBe(auditsBefore);
    const kept = await ctx.pool.query(`SELECT count(*)::int AS n FROM assistant_asked_question`);
    expect(kept.rows[0].n).toBe(0);
  });

  it("answers a dashboard question with its dates, figures and definition, audited without any text", async () => {
    const body = await answer(admin(), { questionId: "clinic.no-shows", period: "last-week" });
    expect(body).toMatchObject({
      question: { id: "clinic.no-shows", version: 1, title: "No-shows" },
      status: "answered",
      period: { key: "last-week", label: "Last week" },
      comparison: null,
      scope: { kind: "facility", name: "Main Clinic" },
      link: { href: "/management" },
    });
    expect(body.sentence).toContain("No appointments were booked at Main Clinic");
    expect(body.rows.map((r: { label: string }) => r.label)).toEqual(["No-show rate", "No-shows", "Appointments booked"]);
    expect(body.definition).toContain("No-shows ÷ appointments booked");

    // The dashboard writes its own audit, as when its screen is opened; Ask adds its own, never with text.
    const views = await auditRows(ctx.pool, "action = 'management.dashboard.view'");
    expect(views.at(-1)!.metadata).toMatchObject({ from: body.period.from, to: body.period.to });
    const asks = await auditRows(ctx.pool, "action = 'assistant.ask'");
    expect(asks.at(-1)).toMatchObject({
      outcome: "success",
      metadata: {
        questionId: "clinic.no-shows",
        version: 1,
        period: "last-week",
        from: body.period.from,
        to: body.period.to,
        compare: null,
        scope: "facility",
        result: "answered",
      },
    });
  });

  it("compares like for like and says how each figure changed", async () => {
    const viewsBefore = (await auditRows(ctx.pool, "action = 'management.dashboard.view'")).length;
    const body = await answer(admin(), { questionId: "billing.revenue", period: "this-month", compare: "previous" });
    expect(body.status).toBe("answered");
    expect(body.comparison).toMatchObject({ mode: "previous", label: "the period before" });
    expect(body.comparison.from.slice(8)).toBe("01");
    expect(body.rows[0]).toMatchObject({ label: "Invoiced (net)", value: "₱0.00", previous: "₱0.00", change: { text: "no change", direction: "flat" } });
    // Both periods read through the dashboard: two views.
    expect((await auditRows(ctx.pool, "action = 'management.dashboard.view'")).length).toBe(viewsBefore + 2);
  });

  it("answers the screens' own figures: low stock names the item, never a patient", async () => {
    const body = await answer(tokens["inventory_officer"]!, { questionId: "inventory.low" });
    expect(body).toMatchObject({
      status: "answered",
      sentence: "1 item is low or out at Main Clinic.",
      rows: [{ label: "Gauze pad (Main store)", value: "5 pack usable, reorder level 20" }],
    });
    expect(body.period).toBeNull();
    const waiting = await answer(tokens["receptionist"]!, { questionId: "clinic.waiting-now", period: "last-week" });
    expect(waiting).toMatchObject({ status: "answered", sentence: "Nobody is waiting at Main Clinic now." });
    expect(waiting.notes).toContain("This question is about the present, so the period you named was left out.");
  });

  it("withholds what the caller's role cannot open, without calling it a refusal", async () => {
    const viewsBefore = (await auditRows(ctx.pool, "action = 'management.dashboard.view'")).length;
    const body = await answer(tokens["receptionist"]!, { questionId: "billing.revenue", period: "this-month" });
    expect(body).toMatchObject({ status: "withheld", rows: [], link: null, entry: null });
    expect(body.sentence).toContain("your role cannot open");
    // Not read, so no dashboard view; recorded as withheld, never as a denial (the record-access rule counts denials).
    expect((await auditRows(ctx.pool, "action = 'management.dashboard.view'")).length).toBe(viewsBefore);
    expect((await auditRows(ctx.pool, "action = 'assistant.ask'")).at(-1)).toMatchObject({ outcome: "success", metadata: { result: "withheld" } });
  });

  it("answers exactly when the role may open the source route, for every question and role", async () => {
    const today = localDate(new Date(), "Asia/Manila");
    const sections: Record<string, string> = { "billing.revenue": "billing", "inventory.stock-used": "inventory", "pharmacy.dispensed": "dispensing" };
    const mismatches: string[] = [];
    for (const role of ROLES) {
      for (const q of ASK_QUESTIONS) {
        const path = q.source.replace(/^GET /, "");
        const source = await api(tokens[role]!).get(`${path}${path === "/billing/reports/daily" ? `?date=${today}` : ""}`);
        expect([200, 403]).toContain(source.status);
        const section = sections[q.id];
        const expected = source.status === 200 && !(section && (source.body.withheld as string[]).includes(section)) ? "answered" : "withheld";
        const got = (await answer(tokens[role]!, { questionId: q.id })).status;
        if (got !== expected) mismatches.push(`${role} ${q.id}: route ${source.status}, Ask ${got}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("says when a period cannot be read or has not started", async () => {
    await api(admin()).post("/assistant/ask/answer", { questionId: "clinic.no-shows", period: "2026-13" }).expect(422);
    await api(admin()).post("/assistant/ask/answer", { questionId: "clinic.no-shows", period: "next-week" }).expect(400);
    await api(admin()).post("/assistant/ask/answer", { questionId: "no.such-question" }).expect(404);
    const future = await answer(admin(), { questionId: "clinic.no-shows", period: "2099-01" });
    expect(future).toMatchObject({ status: "unavailable", sentence: "That period has not started yet." });
  });

  it("keeps the person's questions without the words typed, counts repeats and keeps them apart from everyone else", async () => {
    const officer = tokens["inventory_officer"]!;
    // Earlier tests asked as the officer too: start from nothing.
    await api(officer).post("/assistant/ask/history/clear").expect(200);
    const first = await answer(officer, { questionId: "inventory.low" });
    const again = await answer(officer, { questionId: "inventory.low" });
    await answer(officer, { questionId: "inventory.expiring" });
    const history = (await api(officer).get("/assistant/ask/history").expect(200)).body;
    expect(history.saved).toEqual([]);
    expect(history.recent.map((r: { questionId: string }) => r.questionId)).toEqual(["inventory.expiring", "inventory.low"]);
    expect(history.recent[1]).toMatchObject({ label: "Low stock", timesAsked: 2, period: null, scope: "facility" });
    // Each answer names the entry it was kept under, so the screen can save it.
    expect(first.entry).toEqual({ id: history.recent[1].id });
    expect(again.entry).toEqual(first.entry);
    // The period as asked, so "last week" reads its own last week when asked again.
    const admins = (await api(admin()).get("/assistant/ask/history").expect(200)).body as { recent: Array<{ questionId: string; period: string | null }> };
    expect(admins.recent.find((r) => r.questionId === "clinic.no-shows" && r.period === "last-week")).toMatchObject({ label: "No-shows, Last week" });

    // Saved, unsaved and removed by their owner only; another person or organization gets 404.
    const low = history.recent[1].id as string;
    await api(admin()).post(`/assistant/ask/history/${low}/save`).expect(404);
    await api(stranger, other.facilityId).post(`/assistant/ask/history/${low}/remove`).expect(404);
    await api(officer).post(`/assistant/ask/history/${low}/save`).expect(200);
    expect((await api(officer).get("/assistant/ask/history").expect(200)).body.saved.map((r: { id: string }) => r.id)).toEqual([low]);
    await api(officer).post("/assistant/ask/history/clear").expect(200);
    const after = (await api(officer).get("/assistant/ask/history").expect(200)).body;
    expect(after.recent).toEqual([]);
    expect(after.saved.map((r: { id: string }) => r.id)).toEqual([low]);
    await api(officer).post(`/assistant/ask/history/${low}/unsave`).expect(200);
    await api(officer).post(`/assistant/ask/history/${low}/remove`).expect(200);
    expect((await api(officer).get("/assistant/ask/history").expect(200)).body).toEqual({ saved: [], recent: [] });

    // Nothing typed is kept anywhere: not in the questions, not in the audit trail.
    for (const table of ["assistant_asked_question", "audit_event"]) {
      const found = await ctx.pool.query(`SELECT count(*)::int AS n FROM ${table} t WHERE row_to_json(t)::text ILIKE '%Placeholder%'`);
      expect(found.rows[0].n).toBe(0);
    }
  });

  it("keeps at most twenty saved questions", async () => {
    for (let i = 1; i <= 21; i += 1) {
      await answer(admin(), { questionId: "clinic.appointments", period: `2026-01-${String(i).padStart(2, "0")}` });
    }
    const ids = ((await api(admin()).get("/assistant/ask/history").expect(200)).body.recent as Array<{ id: string }>).map((r) => r.id);
    expect(ids.length).toBeGreaterThanOrEqual(21);
    for (const id of ids.slice(0, 20)) await api(admin()).post(`/assistant/ask/history/${id}/save`).expect(200);
    const refused = await api(admin()).post(`/assistant/ask/history/${ids[20]}/save`).expect(422);
    expect(refused.body.error.code).toBe("saved_question_limit");
  });
});

describe("assistant Ask rate limits", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let one: string;
  let two: string;

  const interpret = (token: string) =>
    ctx.http().post("/api/v1/assistant/ask/interpret").set(as(token, tenant.facilityId)).send({ text: "what is running low" });

  beforeAll(async () => {
    ctx = await createTestApp({
      disableRateLimit: false,
      rateLimitStorage: { redisUrl: TEST_REDIS_URL, keyPrefix: `ask-throttle-${randomBytes(4).toString("hex")}:` },
    });
    tenant = await createTenant(ctx.pool, "ask-limits-org");
    for (const name of ["one", "two"]) await createStaff(ctx.pool, tenant, `${name}@al.ph`, ["inventory_officer"]);
    one = (await login(ctx, "one@al.ph")).accessToken;
    two = (await login(ctx, "two@al.ph")).accessToken;
  });
  afterAll(() => ctx.close());

  it("counts each person's own questions: one at the limit does not stop a colleague on the same address", async () => {
    for (let i = 0; i < 30; i += 1) await interpret(one).expect(200);
    const refused = await interpret(one).expect(429);
    expect(refused.body.error.code).toBe("rate_limited");
    await interpret(two).expect(200);
  });
});
