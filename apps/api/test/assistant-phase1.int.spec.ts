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
 * The heuristic assistant, phase 1 (docs/domains/assistant.md): procedures with no charge on the billing desk, patients
 * who often miss appointments on the board, waits longer than usual on the queue, lots that may expire unused, and the
 * replay that tells an administrator how often a rule would have spoken. Rules stay off until turned on; each needs its
 * screen's permission; suggestions name counts and times, never a patient.
 */
describe("heuristic assistant, phase 1", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let admin: string;
  let doctor: string;
  let cashier: string;
  let receptionist: string;
  let nurse: string;
  let adminUserId: string;
  let practitionerId: string;
  let patientId: string;
  let visitType: string;
  let key = 0;

  const api = (token: string, facilityId: string | undefined = tenant.facilityId) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, facilityId)).send(body),
    put: (url: string, body: object = {}) => ctx.http().put(`/api/v1${url}`).set(as(token, facilityId)).send(body),
  });
  const q = (sql: string, params: unknown[] = []) => ctx.pool.query(sql, params);
  const turnOn = (ruleId: string, parameters?: object) =>
    api(admin).put(`/assistant/rules/${ruleId}/settings`, { enabled: true, parameters, expectedVersion: 0 }).expect(200);
  const suggestions = async (token: string, surface: string, date?: string) =>
    (
      await api(token)
        .get(`/assistant/suggestions?surface=${surface}${date ? `&date=${date}` : ""}`)
        .expect(200)
    ).body as {
      items: Suggestion[];
      withheld: Array<{ ruleId: string }>;
    };

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = await createTenant(ctx.pool, "assistant-p1");
    adminUserId = await createStaff(ctx.pool, tenant, "admin@assistant-p1.ph", ["org_admin"]);
    practitionerId = (await createClinician(ctx, tenant, "doctor@assistant-p1.ph", ["physician"])).practitionerId;
    await createStaff(ctx.pool, tenant, "cashier@assistant-p1.ph", ["cashier"]);
    await createStaff(ctx.pool, tenant, "reception@assistant-p1.ph", ["receptionist"]);
    await createStaff(ctx.pool, tenant, "nurse@assistant-p1.ph", ["nurse"]);
    admin = (await login(ctx, "admin@assistant-p1.ph")).accessToken;
    doctor = (await login(ctx, "doctor@assistant-p1.ph")).accessToken;
    cashier = (await login(ctx, "cashier@assistant-p1.ph")).accessToken;
    receptionist = (await login(ctx, "reception@assistant-p1.ph")).accessToken;
    nurse = (await login(ctx, "nurse@assistant-p1.ph")).accessToken;
    patientId = (await api(admin).post("/patients", juan).expect(201)).body.id;
    visitType = (await api(admin).post("/clinic/visit-types", { code: "consult", name: "General consult", defaultDurationMinutes: 15 }).expect(201)).body.id;
  });
  afterAll(() => ctx.close());

  it("gives the front desk, cashiers and nurses the assistant, each only on screens they hold", async () => {
    expect((await suggestions(cashier, "billing")).items).toEqual([]);
    expect((await suggestions(receptionist, "appointments")).items).toEqual([]);
    expect((await suggestions(nurse, "queue")).items).toEqual([]);
    // A cashier asking for the queue's suggestions gets the rule withheld once it is on, never its findings.
    await turnOn("clinic.queue-wait");
    const queue = await suggestions(cashier, "queue");
    expect(queue.items).toEqual([]);
    expect(queue.withheld.map((w) => w.ruleId)).toEqual(["clinic.queue-wait"]);
  });

  it("finds procedures with no charge, grouped by code and the likely reason, without naming a patient", async () => {
    const definition = async (code: string, name: string) =>
      (await api(admin).post("/clinic/procedure-definitions", { code, name }).expect(201)).body.id as string;
    const sut = await definition("SUT-S", "Suture repair");
    const neb = await definition("NEB", "Nebulization");
    const drs = await definition("DRS", "Wound dressing");
    // SUT is priced; DRS is mapped but priced only from next month; NEB has no service.
    await api(admin)
      .post("/billing/services", {
        code: "SUT",
        name: "Suture repair",
        category: "procedure",
        sourceKind: "clinic_procedure",
        sourceCode: "SUT-S",
        unitPrice: 50_000,
        effectiveFrom: manilaDate(-30),
      })
      .expect(201);
    await api(admin)
      .post("/billing/services", {
        code: "DRS",
        name: "Wound dressing",
        category: "procedure",
        sourceKind: "clinic_procedure",
        sourceCode: "DRS",
        unitPrice: 20_000,
        effectiveFrom: manilaDate(30),
      })
      .expect(201);
    const encounter = (await api(doctor).post("/encounters", { patientId, chiefComplaint: "Laceration" }).expect(201)).body.id;
    // The consultation began four hours ago, so the procedures can be timed three hours ago (never before it began).
    await q(`UPDATE encounter SET started_at = now() - interval '4 hours' WHERE id = $1`, [encounter]);
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    for (const definitionId of [sut, neb, neb, drs]) {
      await api(doctor).post(`/encounters/${encounter}/procedures`, { definitionId, performedAt: threeHoursAgo }).expect(201);
    }
    await drainEvents(ctx);

    await turnOn("billing.uncharged-work");
    const found = (await suggestions(cashier, "billing")).items;
    expect(found.map((s) => [s.title, s.severity])).toEqual([
      ["1 × Wound dressing (DRS) not charged", "warning"],
      ["2 × Nebulization (NEB) not charged", "advice"],
    ]);
    expect(found[1]!.action!.href).toBe("/billing/settings");
    expect(JSON.stringify(found)).not.toMatch(/Juan|Dela Cruz|Laceration/i);
    // A nurse may use the assistant but holds no billing.charge.read: the rule is withheld from her.
    expect((await suggestions(nurse, "billing")).withheld.map((w) => w.ruleId)).toEqual(["billing.uncharged-work"]);
  });

  it("flags today's unconfirmed appointment of a patient who often misses, by time and with a link", async () => {
    const appointment = (startsAt: string, status: string, extra = "") =>
      q(
        `INSERT INTO appointment (organization_id, facility_id, patient_id, practitioner_id, visit_type_id, starts_at, ends_at, status, booking_channel,
                                  checked_in_at, completed_at, no_show_at, created_by, updated_by, created_at)
         VALUES ($1, $2, $3, $4, $5, ${startsAt}, ${startsAt} + interval '15 minutes', $6, 'front_desk',
                 CASE WHEN $6 = 'completed' THEN ${startsAt} END, CASE WHEN $6 = 'completed' THEN ${startsAt} END,
                 CASE WHEN $6 = 'no_show' THEN ${startsAt} END, $7, $7, ${extra || "now() - interval '200 days'"})
         RETURNING id`,
        [tenant.organizationId, tenant.facilityId, patientId, practitionerId, visitType, status, adminUserId],
      );
    for (const [days, status] of [
      [150, "completed"],
      [120, "no_show"],
      [90, "no_show"],
      [60, "completed"],
      [30, "no_show"],
    ] as const) {
      await appointment(`now() - interval '${days} days'`, status);
    }
    const upcoming = (await appointment("now() + interval '3 hours'", "booked", "now() - interval '1 day'")).rows[0].id as string;
    const { rows } = await q(`SELECT to_char((starts_at AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS d FROM appointment WHERE id = $1`, [upcoming]);
    const date = rows[0].d as string;

    await turnOn("clinic.no-show-risk");
    const [s] = (await suggestions(receptionist, "appointments", date)).items;
    expect(s).toMatchObject({ ruleId: "clinic.no-show-risk", severity: "advice", strength: "weak" });
    expect(s!.title).toMatch(/^\d{1,2}:\d{2} (AM|PM) appointment: the patient missed 3 of their last 5 appointments$/);
    expect(s!.action!.href).toBe(`/appointments?date=${date}&appointmentId=${upcoming}`);
    expect(JSON.stringify(s)).not.toMatch(/Juan|Dela Cruz/i);
    // Confirmed: only information.
    await q(`UPDATE appointment SET status = 'confirmed', confirmed_at = now() WHERE id = $1`, [upcoming]);
    expect((await suggestions(receptionist, "appointments", date)).items[0]!.severity).toBe("info");
  });

  it("flags patients waiting longer than this facility usually takes for the visit type", async () => {
    // 24 past visits over the last days, each called 10 to 21 minutes after check-in.
    for (let i = 0; i < 24; i++) {
      await q(
        `INSERT INTO visit (organization_id, facility_id, patient_id, visit_type_id, arrival_mode, queue_date, queue_number, status, checked_in_at, called_at,
                            completed_at, checked_in_by)
         VALUES ($1, $2, $3, $4, 'walk_in', (now() - interval '${1 + (i % 6)} days')::date, ${100 + i}, 'completed',
                 now() - interval '${1 + (i % 6)} days', now() - interval '${1 + (i % 6)} days' + interval '${10 + (i % 12)} minutes',
                 now() - interval '${1 + (i % 6)} days' + interval '1 hour', $5)`,
        [tenant.organizationId, tenant.facilityId, patientId, visitType, adminUserId],
      );
    }
    // Waiting since 90 minutes ago, never called.
    await q(
      `INSERT INTO visit (organization_id, facility_id, patient_id, visit_type_id, arrival_mode, queue_date, queue_number, status, checked_in_at, checked_in_by)
       VALUES ($1, $2, $3, $4, 'walk_in', (now() AT TIME ZONE 'Asia/Manila')::date, 1, 'waiting', now() - interval '90 minutes', $5)`,
      [tenant.organizationId, tenant.facilityId, patientId, visitType, adminUserId],
    );
    const [s] = (await suggestions(nurse, "queue")).items;
    expect(s).toMatchObject({ ruleId: "clinic.queue-wait", severity: "warning" });
    expect(s!.title).toBe("General consult: 1 patient has waited longer than usual");
    expect(s!.evidence[1]!.value).toMatch(/^1, longest (89|90|91) min$/);
  });

  it("flags a lot that will expire unused", async () => {
    const item = (
      await api(admin).post("/inventory/items", { code: "amox", name: "Amoxicillin 500 mg", category: "medicine", stockUnit: "capsule" }).expect(201)
    ).body.id;
    const location = (await api(admin).post("/inventory/locations", { facilityId: tenant.facilityId, code: "pharmacy", name: "Pharmacy" }).expect(201)).body.id;
    await api(admin)
      .post("/inventory/receipts", {
        locationId: location,
        itemId: item,
        lotNumber: "A1",
        expiryDate: manilaDate(20),
        quantity: 40,
        idempotencyKey: `p1-${++key}-receipt`,
      })
      .expect(201);
    await turnOn("inventory.expiry-exposure");
    const [s] = (await suggestions(admin, "inventory")).items.filter((x) => x.ruleId === "inventory.expiry-exposure");
    expect(s).toMatchObject({ severity: "warning", strength: "matched" });
    expect(s!.title).toBe(`Amoxicillin 500 mg, lot A1: about 40 capsule may expire unused on ${manilaDate(20)}`);
  });

  it("replays a rule over past days for an administrator, counts only, audited", async () => {
    await api(cashier).post("/assistant/rules/billing.uncharged-work/replay", { days: 3 }).expect(403);
    await api(admin).post("/assistant/rules/nope/replay", { days: 3 }).expect(404);
    await api(admin)
      .post("/assistant/rules/clinic.no-show-risk/replay", { days: 3, parameters: { historyDays: 30, minAppointments: 3, missedPercent: 5 } })
      .expect(422)
      .expect((r) => expect(r.body.error.message).toBe("Count appointments from the last: enter a whole number from 90 to 1825."));
    const replay = (await api(admin).post("/assistant/rules/clinic.queue-wait/replay", { days: 5 }).expect(200)).body as {
      readAt: string;
      days: Array<{ date: string; suggestions: number }>;
      averagePerDay: number;
    };
    expect(replay.readAt).toBe("10:00");
    expect(replay.days).toHaveLength(5);
    expect(replay.days.map((d) => d.date)).toEqual([...replay.days.map((d) => d.date)].sort());
    expect(replay.days.at(-1)!.date < manilaDate(0)).toBe(true);
    // Replaying stock reads the ledger as it stood: the lot received today did not exist on past days.
    const stock = (await api(admin).post("/assistant/rules/inventory.expiry-exposure/replay", { days: 2 }).expect(200)).body;
    expect(stock.days.map((d: { suggestions: number }) => d.suggestions)).toEqual([0, 0]);
    const audit = await auditRows(ctx.pool, "action = 'assistant.replay'");
    expect(audit.map((a) => a.metadata?.ruleId)).toEqual(["clinic.queue-wait", "inventory.expiry-exposure"]);
  });
});
