import { ManagementReportRuns } from "../src/app/management-dashboard/management-report-runs";
import { as, auditRows, createStaff, createTenant, createTestApp, login, type Tenant, type TestContext } from "./harness";

/**
 * Scheduled management reports (docs/architecture/management-dashboard.md, "Scheduled reports"): a schedule's ended
 * periods are produced once as stored CSV files through the dashboard's own export, with the owner's permissions,
 * and the recipients who may view the dashboard are told without figures.
 */
describe("scheduled management reports", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let adminId: string;
  let admin: string;
  let auditorId: string;
  let opsId: string;
  let ops: string;
  let runs: ManagementReportRuns;
  // A Monday: the week of 28 September to 4 October 2026 has ended, in Manila and in UTC alike.
  const MONDAY = new Date("2026-10-05T02:00:00Z");

  const api = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
    put: (url: string, body: object) => ctx.http().put(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });

  beforeAll(async () => {
    ctx = await createTestApp({}, { STAFF_BASE_URL: "https://staff.test.invalid/" });
    tenant = await createTenant(ctx.pool, "reports-org");
    adminId = await createStaff(ctx.pool, tenant, "admin@reports.ph", ["org_admin"]);
    auditorId = await createStaff(ctx.pool, tenant, "auditor@reports.ph", ["auditor"]);
    // A manager who may view the dashboard and schedule reports but holds no billing reporting (org_admin holds both).
    const role = (
      await ctx.pool.query<{ id: string }>(`INSERT INTO role (organization_id, key, name) VALUES ($1, 'ops_manager', 'Operations manager') RETURNING id`, [
        tenant.organizationId,
      ])
    ).rows[0]!.id;
    await ctx.pool.query(`INSERT INTO role_permission (role_id, permission_key) VALUES ($1, 'management.dashboard.read'), ($1, 'management.report.manage')`, [
      role,
    ]);
    opsId = await createStaff(ctx.pool, tenant, "ops@reports.ph", []);
    await ctx.pool.query(`INSERT INTO role_assignment (organization_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenant.organizationId, opsId, role]);
    admin = (await login(ctx, "admin@reports.ph")).accessToken;
    ops = (await login(ctx, "ops@reports.ph")).accessToken;
    runs = ctx.app.get(ManagementReportRuns);
  });
  afterAll(() => ctx.close());

  it("refuses a schedule whose recipient may not view the dashboard, or whose owner cannot report revenue", async () => {
    const base = { name: "Weekly figures", cadence: "weekly", tables: ["summary", "daily"] };
    const notPermitted = await api(admin)
      .post("/management/report-schedules", { ...base, recipientUserIds: [auditorId] })
      .expect(422);
    expect(notPermitted.body.error.code).toBe("recipient_not_permitted");
    // The owner produces the report with their own permissions: without billing reporting, revenue tables cannot be promised.
    const noRevenue = await api(ops)
      .post("/management/report-schedules", { ...base, tables: ["summary", "revenue"], recipientUserIds: [opsId] })
      .expect(403);
    expect(noRevenue.body.error.code).toBe("revenue_not_reportable");
    await api(admin)
      .post("/management/report-schedules", { ...base, tables: ["nonsense"], recipientUserIds: [adminId] })
      .expect(400);
  });

  it("produces each ended period once, stores the tables as CSV and tells the recipients without figures", async () => {
    // The auditor may not view the dashboard, so a schedule naming them is refused as a whole.
    await api(admin)
      .post("/management/report-schedules", { name: "Weekly figures", cadence: "weekly", tables: ["summary", "daily"], recipientUserIds: [adminId, auditorId] })
      .expect(422);
    const schedule = (
      await api(admin)
        .post("/management/report-schedules", { name: "Weekly figures", cadence: "weekly", tables: ["summary", "daily"], recipientUserIds: [adminId, opsId] })
        .expect(201)
    ).body;
    expect(schedule).toMatchObject({ cadence: "weekly", tables: ["summary", "daily"], status: "active", ownerUserId: adminId, version: 1 });

    const first = await runs.tick(MONDAY);
    expect(first).toMatchObject({ resumed: 0 });
    expect(first!.produced).toBeGreaterThanOrEqual(1);
    const again = await runs.tick(MONDAY);
    expect(again).toEqual({ produced: 0, resumed: 0 });

    const list = (await api(admin).get(`/management/reports?scheduleId=${schedule.id}`).expect(200)).body;
    const latest = list[0];
    expect(latest).toMatchObject({ periodFrom: "2026-09-28", periodTo: "2026-10-04", status: "produced", withheld: [] });
    expect(latest.files.map((f: { table: string }) => f.table)).toEqual(["daily", "summary"]);
    expect(latest.files.every((f: { storedAt: string | null }) => f.storedAt)).toBe(true);

    const csv = await api(admin).get(`/management/reports/${latest.id}/files/summary`).expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain(`management-summary-2026-09-28-to-2026-10-04.csv`);
    expect(csv.text.startsWith("\uFEFF")).toBe(true);
    // The same export the screen gives for that range.
    const live = await api(admin).get("/management/dashboard/export?table=summary&from=2026-09-28&to=2026-10-04").expect(200);
    expect(csv.text).toBe(live.text);

    const notices = await ctx.pool.query<{ channel: string; template_key: string; variables: Record<string, string> }>(
      // Up to three missed periods are caught up (each told once); look at the latest one.
      `SELECT channel, template_key, variables FROM notification
       WHERE recipient_user_id = $1 AND template_key = 'management.report-ready' AND variables->>'periodFrom' = '2026-09-28' ORDER BY channel`,
      [adminId],
    );
    expect(notices.rows.map((r) => r.channel)).toEqual(["email", "in_app"]);
    // No figures: a name, the dates and a link only.
    expect(notices.rows[0]!.variables).toEqual({
      scheduleName: "Weekly figures",
      periodFrom: "2026-09-28",
      periodTo: "2026-10-04",
      link: "https://staff.test.invalid/management/reports",
    });

    expect(await auditRows(ctx.pool, `action = 'management.report.produce' AND resource_id = $1`, [latest.id])).toHaveLength(1);
    expect(await auditRows(ctx.pool, `action = 'management.report.download' AND resource_id = $1 AND outcome = 'success'`, [latest.id])).toHaveLength(1);
  });

  it("withholds revenue tables from a download by someone without billing reporting, and pauses and resumes", async () => {
    // An owner who holds billing reporting (org_admin) may schedule revenue tables for a recipient who does not.
    const schedule = (
      await api(admin)
        .post("/management/report-schedules", { name: "Monthly revenue", cadence: "monthly", tables: ["summary", "revenue"], recipientUserIds: [opsId] })
        .expect(201)
    ).body;
    await runs.tick(MONDAY);
    const [run] = (await api(admin).get(`/management/reports?scheduleId=${schedule.id}`).expect(200)).body;
    expect(run).toMatchObject({ periodFrom: "2026-09-01", periodTo: "2026-09-30", status: "produced" });
    await api(admin).get(`/management/reports/${run.id}/files/revenue`).expect(200);
    const refused = await api(ops).get(`/management/reports/${run.id}/files/revenue`).expect(403);
    expect(refused.body.error.message).toContain("billing report permission");
    expect(await auditRows(ctx.pool, `action = 'management.report.download' AND resource_id = $1 AND outcome = 'denied'`, [run.id])).toHaveLength(1);
    await api(ops).get(`/management/reports/${run.id}/files/summary`).expect(200);

    const paused = (await api(admin).post(`/management/report-schedules/${schedule.id}/status`, { status: "paused", version: schedule.version }).expect(201))
      .body;
    expect(paused.status).toBe("paused");
    await api(admin).post(`/management/report-schedules/${schedule.id}/status`, { status: "active", version: schedule.version }).expect(409);
    // Taking a schedule over makes the caller its owner: the manager may keep it only once revenue tables are dropped.
    await api(ops)
      .put(`/management/report-schedules/${schedule.id}`, {
        name: "Monthly revenue",
        cadence: "monthly",
        tables: ["summary", "revenue"],
        recipientUserIds: [opsId],
        version: paused.version,
      })
      .expect(403);
    const taken = await api(ops).put(`/management/report-schedules/${schedule.id}`, {
      name: "Monthly figures",
      cadence: "monthly",
      tables: ["summary"],
      recipientUserIds: [opsId],
      version: paused.version,
    });
    expect(taken.status).toBe(200);
    expect(taken.body).toMatchObject({ ownerUserId: opsId, tables: ["summary"], version: paused.version + 1 });
  });

  it("needs the manage permission to schedule and the dashboard permission to read", async () => {
    const auditor = (await login(ctx, "auditor@reports.ph")).accessToken;
    await api(auditor).get("/management/report-schedules").expect(403);
    await api(auditor)
      .post("/management/report-schedules", { name: "x", cadence: "weekly", tables: ["summary"], recipientUserIds: [adminId] })
      .expect(403);
  });
});
