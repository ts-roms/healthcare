import { join } from "node:path";
import { runMigrations } from "@healthcare/core";
import { Pool } from "pg";
import { createStaff, createTenant, createTestApp, login, TEST_APP_DATABASE_URL, type TestContext } from "./harness";

/**
 * Least privilege for the running application (0109_app_role.sql, docs/runbooks/database-roles.md): the role the API
 * and workers connect as may read and write, but not change or remove what the append-only triggers protect, truncate
 * anything or write the migration ledger. The privileges follow the triggers, and every migration run puts them back.
 */
describe("application database role", () => {
  let ctx: TestContext;
  let app: Pool;

  // By permission, not by the append-only trigger (which also answers 42501, with "is append-only").
  const denied = async (sql: string, message = /^permission denied/) => {
    await expect(app.query(sql)).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(message) });
  };
  const privilege = async (table: string, action: string) =>
    (await ctx.pool.query<{ ok: boolean }>("SELECT has_table_privilege('healthcare_app', $1, $2) AS ok", [table, action])).rows[0]!.ok;

  beforeAll(async () => {
    ctx = await createTestApp();
    const tenant = await createTenant(ctx.pool, "app-role");
    await createStaff(ctx.pool, tenant, "admin@app-role.ph", ["org_admin"]);
    await login(ctx, "admin@app-role.ph");
    app = new Pool({ connectionString: TEST_APP_DATABASE_URL, max: 1, options: "-c app.scope=all" });
  });
  afterAll(async () => {
    await app.end();
    await ctx.close();
  });

  it("is what the application under test connects as, and the group role cannot sign in", async () => {
    expect(new URL(ctx.config.DATABASE_URL).username).toBe("healthcare_test_app");
    const { rows } = await app.query<{ member: boolean; owner: boolean }>(
      "SELECT pg_has_role(current_user, 'healthcare_app', 'MEMBER') AS member, pg_has_role(current_user, (SELECT tableowner FROM pg_tables WHERE tablename = 'audit_event'), 'MEMBER') AS owner",
    );
    expect(rows[0]).toEqual({ member: true, owner: false });
    const { rows: group } = await ctx.pool.query<{ rolcanlogin: boolean }>("SELECT rolcanlogin FROM pg_roles WHERE rolname = 'healthcare_app'");
    expect(group[0]!.rolcanlogin).toBe(false);
  });

  it("reads and writes ordinary tables", async () => {
    expect(Number((await app.query("SELECT count(*) AS n FROM audit_event")).rows[0].n)).toBeGreaterThan(0);
    const { rowCount } = await app.query("UPDATE app_user SET updated_at = updated_at WHERE email = 'admin@app-role.ph'");
    expect(rowCount).toBe(1);
  });

  it("cannot change or remove the audit trail or consent history, truncate, or write the migration ledger", async () => {
    await denied("UPDATE audit_event SET action = 'tampered.action'");
    await denied("DELETE FROM audit_event");
    await denied("TRUNCATE audit_event");
    await denied("UPDATE patient_consent SET decision = 'granted'");
    await denied("DELETE FROM patient_consent");
    await denied("TRUNCATE patient");
    await denied("INSERT INTO schema_migration (name, checksum) VALUES ('9999_x.sql', 'x')");
    await denied("CREATE TABLE intruder (id int)");
    await denied("ALTER TABLE audit_event DISABLE TRIGGER USER", /^must be owner/);
  });

  it("follows every unconditional prevent_mutation() trigger, and nothing else is withheld", async () => {
    const { rows } = await ctx.pool.query<{ relname: string; forbids_update: boolean; forbids_delete: boolean }>(`
      SELECT c.relname, bool_or(t.tgtype & 16 <> 0) AS forbids_update, bool_or(t.tgtype & 8 <> 0) AS forbids_delete
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE p.proname = 'prevent_mutation' AND NOT t.tgisinternal AND t.tgtype & 1 <> 0 AND t.tgqual IS NULL
      GROUP BY c.relname`);
    expect(rows.length).toBeGreaterThan(40);
    for (const row of rows) {
      expect({ table: row.relname, update: await privilege(row.relname, "UPDATE") }).toEqual({ table: row.relname, update: !row.forbids_update });
      expect({ table: row.relname, delete: await privilege(row.relname, "DELETE") }).toEqual({ table: row.relname, delete: !row.forbids_delete });
    }
    // Statement-level TRUNCATE triggers forbid nothing more than the blanket revoke already does.
    for (const table of ["patient", "billing_invoice", "lab_result", "patient_portal_account"]) {
      expect(await privilege(table, "UPDATE")).toBe(true);
      expect(await privilege(table, "DELETE")).toBe(true);
      expect(await privilege(table, "TRUNCATE")).toBe(false);
    }
  });

  it("puts the privileges back on every migration run (a later migration, or a restore without grants)", async () => {
    await ctx.pool.query("GRANT UPDATE, DELETE, TRUNCATE ON audit_event TO healthcare_app");
    expect(await privilege("audit_event", "UPDATE")).toBe(true);
    await runMigrations(ctx.pool, join(__dirname, "../../../database/migrations"));
    expect(await privilege("audit_event", "UPDATE")).toBe(false);
    expect(await privilege("audit_event", "DELETE")).toBe(false);
    expect(await privilege("audit_event", "TRUNCATE")).toBe(false);

    await ctx.pool.query("CREATE TABLE later_table (id int)");
    expect(await privilege("later_table", "SELECT")).toBe(false);
    await runMigrations(ctx.pool, join(__dirname, "../../../database/migrations"));
    expect(await privilege("later_table", "SELECT")).toBe(true);
    await ctx.pool.query("DROP TABLE later_table");
  });
});
