import { gunzipSync } from "node:zlib";
import { Pool } from "pg";
import { AuditRetentionService } from "../src/app/audit-retention/audit-retention.service";
import { as, createStaff, createTenant, createTestApp, login, TEST_APP_DATABASE_URL, type Tenant, type TestContext } from "./harness";

/**
 * Audit trail retention (0110_audit_partitions.sql, docs/runbooks/audit-retention.md): monthly partitions kept ready,
 * archives of closed months verified in the background, and removal only of an archived month past the deployment's
 * retention period, by a platform administrator with a reason.
 *
 * Time cannot move in a test, so the setup moves the history partition's end back to 2025-01-01 (before any event
 * exists) and adds a January 2025 partition: two closed periods in the past to archive and remove.
 */
describe("audit trail retention", () => {
  let ctx: TestContext;
  let tenant: Tenant;
  let platformAdmin: string;
  let orgAdmin: string;
  let config: { AUDIT_RETENTION_MONTHS?: number };

  const http = (token: string) => ({
    get: (url: string) => ctx.http().get(`/api/v1${url}`).set(as(token, tenant.facilityId)),
    post: (url: string, body: object = {}) => ctx.http().post(`/api/v1${url}`).set(as(token, tenant.facilityId)).send(body),
  });
  const insertEvents = async (at: string, count: number) => {
    for (let i = 0; i < count; i += 1) {
      await ctx.pool.query(
        "INSERT INTO audit_event (occurred_at, organization_id, actor_type, action, resource_type, outcome) VALUES ($1::timestamptz + make_interval(secs => $2), $3, 'system', 'test.event', 'test', 'success')",
        [at, i, tenant.organizationId],
      );
    }
  };
  const partitions = async () =>
    (await http(platformAdmin).get("/audit/retention/partitions").expect(200)).body as {
      retentionMonths: number | null;
      partitions: Array<{ partitionName: string; archivable: boolean; removable: boolean; archive: { id: string; status: string; rowCount: number } | null }>;
    };
  const runArchives = () => ctx.app.get(AuditRetentionService).runPending();

  beforeAll(async () => {
    ctx = await createTestApp();
    config = ctx.config as { AUDIT_RETENTION_MONTHS?: number };
    // Two closed periods in the past: the history partition up to 2025-01-01, and January 2025.
    await ctx.pool.query("ALTER TABLE audit_event DETACH PARTITION audit_event_history");
    await ctx.pool.query("ALTER TABLE audit_event ATTACH PARTITION audit_event_history FOR VALUES FROM (MINVALUE) TO ('2025-01-01 00:00+08')");
    await ctx.pool.query("CREATE TABLE audit_event_2025_01 PARTITION OF audit_event FOR VALUES FROM ('2025-01-01 00:00+08') TO ('2025-02-01 00:00+08')");
    await ctx.pool.query("SELECT ensure_audit_partitions(3)");
    tenant = await createTenant(ctx.pool, "audit-retention");
    await createStaff(ctx.pool, tenant, "platform@audit-retention.ph", ["org_admin"], { platformAdmin: true });
    await createStaff(ctx.pool, tenant, "admin@audit-retention.ph", ["org_admin"]);
    platformAdmin = (await login(ctx, "platform@audit-retention.ph")).accessToken;
    orgAdmin = (await login(ctx, "admin@audit-retention.ph")).accessToken;
    await insertEvents("2024-12-15 10:00+08", 3);
    await insertEvents("2025-01-10 10:00+08", 5);
  });
  afterAll(async () => {
    delete config.AUDIT_RETENTION_MONTHS;
    await ctx.close();
  });

  it("keeps the current and the next three months ready, and a default partition", async () => {
    const { rows } = await ctx.pool.query<{ partition_name: string; is_default: boolean }>("SELECT partition_name, is_default FROM audit_partitions()");
    const names = rows.map((r) => r.partition_name);
    const month = (offset: number) => {
      const d = new Date(Date.now() + 8 * 3600_000);
      const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
      return `audit_event_${m.getUTCFullYear()}_${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
    };
    expect(names).toEqual(
      expect.arrayContaining(["audit_event_history", "audit_event_2025_01", month(0), month(1), month(2), month(3), "audit_event_default"]),
    );
    expect(rows.filter((r) => r.is_default)).toHaveLength(1);
    // Events land in their month; nothing is refused.
    const { rows: placed } = await ctx.pool.query<{ partition: string; n: string }>(
      "SELECT tableoid::regclass::text AS partition, count(*) AS n FROM audit_event WHERE action = 'test.event' GROUP BY 1 ORDER BY 1",
    );
    expect(placed).toEqual([
      { partition: "audit_event_2025_01", n: "5" },
      { partition: "audit_event_history", n: "3" },
    ]);
  });

  it("is for platform administrators only", async () => {
    await http(orgAdmin).get("/audit/retention/partitions").expect(403);
    await http(orgAdmin).post("/audit/retention/partitions/audit_event_2025_01/archive").expect(403);
    await http(orgAdmin).post("/audit/retention/partitions/audit_event_2025_01/remove", { reason: "Retention reached" }).expect(403);
  });

  it("archives a closed month, verified, and refuses an open one", async () => {
    const before = await partitions();
    expect(before.retentionMonths).toBeNull();
    expect(before.partitions.find((p) => p.partitionName === "audit_event_2025_01")).toMatchObject({ archivable: true, removable: false, archive: null });
    const current = before.partitions.find((p) => !p.archivable && p.partitionName !== "audit_event_default" && p.partitionName !== "audit_event_history")!;
    await http(platformAdmin)
      .post(`/audit/retention/partitions/${current.partitionName}/archive`)
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("audit_partition_open"));
    await http(platformAdmin).post("/audit/retention/partitions/audit_event_nope/archive").expect(404);

    const queued = (await http(platformAdmin).post("/audit/retention/partitions/audit_event_2025_01/archive").expect(202)).body;
    expect(queued).toMatchObject({ status: "pending" });
    await http(platformAdmin)
      .post("/audit/retention/partitions/audit_event_2025_01/archive")
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("audit_archive_exists"));
    expect(await runArchives()).toBe(1);

    const archived = (await partitions()).partitions.find((p) => p.partitionName === "audit_event_2025_01")!;
    expect(archived.archive).toMatchObject({ status: "verified", rowCount: 5 });
    const file = await http(platformAdmin)
      .get(`/audit/retention/archives/${archived.archive!.id}/file`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      })
      .expect(200)
      .expect("content-type", /application\/gzip/);
    const events = gunzipSync(file.body as Buffer)
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toHaveLength(5);
    expect(events[0]).toMatchObject({ action: "test.event", organization_id: tenant.organizationId, actor_type: "system" });
    const { rows: audits } = await ctx.pool.query<{ action: string }>(
      "SELECT action FROM audit_event WHERE action IN ('audit.archive-request', 'audit.archive-download') ORDER BY occurred_at",
    );
    expect(audits.map((a) => a.action)).toEqual(["audit.archive-request", "audit.archive-download"]);
  });

  it("removes nothing without a retention period, or within it, or before an archive is verified", async () => {
    await http(platformAdmin)
      .post("/audit/retention/partitions/audit_event_2025_01/remove", { reason: "Retention period reached" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("audit_retention_unset"));
    config.AUDIT_RETENTION_MONTHS = 1200;
    await http(platformAdmin)
      .post("/audit/retention/partitions/audit_event_2025_01/remove", { reason: "Retention period reached" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("audit_within_retention"));
    config.AUDIT_RETENTION_MONTHS = 12;
    await http(platformAdmin)
      .post("/audit/retention/partitions/audit_event_history/remove", { reason: "Retention period reached" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("audit_not_archived"));
    await http(platformAdmin).post("/audit/retention/partitions/audit_event_2025_01/remove", { reason: "no" }).expect(400);
  });

  it("refuses to remove a month that changed after it was archived", async () => {
    await http(platformAdmin).post("/audit/retention/partitions/audit_event_history/archive").expect(202);
    await runArchives();
    await insertEvents("2024-11-01 10:00+08", 1);
    await http(platformAdmin)
      .post("/audit/retention/partitions/audit_event_history/remove", { reason: "Retention period reached" })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe("audit_removal_refused"));
  });

  it("removes an archived month past the retention period, with a reason, and records it", async () => {
    const removed = (
      await http(platformAdmin).post("/audit/retention/partitions/audit_event_2025_01/remove", { reason: "Retention period reached" }).expect(200)
    ).body;
    expect(removed).toEqual({ removedEvents: 5 });
    const { rows } = await ctx.pool.query("SELECT 1 FROM audit_partitions() WHERE partition_name = 'audit_event_2025_01'");
    expect(rows).toHaveLength(0);
    const { rows: archive } = await ctx.pool.query<{ removal_reason: string; removed_at: Date }>(
      "SELECT removal_reason, removed_at FROM audit_archive WHERE partition_name = 'audit_event_2025_01'",
    );
    expect(archive[0]).toMatchObject({ removal_reason: "Retention period reached", removed_at: expect.any(Date) });
    const { rows: audit } = await ctx.pool.query<{ reason: string; metadata: Record<string, unknown> }>(
      "SELECT reason, metadata FROM audit_event WHERE action = 'audit.partition-remove'",
    );
    expect(audit[0]).toMatchObject({ reason: "Retention period reached", metadata: expect.objectContaining({ removedEvents: 5, retentionMonths: 12 }) });
    // The archive keeps its record: once removed, nothing about it changes.
    await expect(ctx.pool.query("UPDATE audit_archive SET removal_reason = 'Something else' WHERE partition_name = 'audit_event_2025_01'")).rejects.toThrow(
      /never changes/,
    );
    await expect(ctx.pool.query("DELETE FROM audit_archive")).rejects.toThrow(/never deleted/);
  });

  it("leaves the application role unable to change, detach or drop a partition, or remove one itself", async () => {
    const app = new Pool({ connectionString: TEST_APP_DATABASE_URL, max: 1 });
    try {
      await expect(app.query("UPDATE audit_event_history SET action = 'x.y'")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("TRUNCATE audit_event_history")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("ALTER TABLE audit_event DETACH PARTITION audit_event_history")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("DROP TABLE audit_event_history")).rejects.toMatchObject({ code: "42501" });
      // The removal function checks the archive itself: the role cannot remove an unarchived partition through it.
      await expect(app.query("SELECT remove_audit_partition('audit_event_default', 1, NULL, 'Trying it')")).rejects.toThrow(/No such audit partition/);
    } finally {
      await app.end();
    }
  });
});
