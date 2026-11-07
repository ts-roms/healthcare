import type { Pool } from "pg";
import type { AppConfig } from "../config/app-config";
import { DatabasePrivilegeCheck, overPrivilegedReasons, type DatabaseRolePrivileges } from "./database-privileges";

const restricted: DatabaseRolePrivileges = { role: "healthcare_api", superuser: false, bypassRls: false, ownsTables: false };

function poolAnswering(row: { role: string; superuser: boolean; bypass_rls: boolean; owns_tables: boolean }): Pool {
  return { query: jest.fn().mockResolvedValue({ rows: [row] }) } as unknown as Pool;
}

function check(pool: Pool, config: Partial<AppConfig>): DatabasePrivilegeCheck {
  return new DatabasePrivilegeCheck(pool, { NODE_ENV: "production", DATABASE_ALLOW_OWNER: false, ...config } as AppConfig);
}

describe("overPrivilegedReasons", () => {
  it("accepts the restricted application role", () => {
    expect(overPrivilegedReasons(restricted)).toEqual([]);
  });

  it("names every way a role escapes row-level security", () => {
    expect(overPrivilegedReasons({ ...restricted, superuser: true, bypassRls: true, ownsTables: true })).toEqual([
      "is a superuser",
      "has BYPASSRLS",
      "owns the application's tables",
    ]);
  });
});

describe("DatabasePrivilegeCheck", () => {
  const owner = { role: "postgres", superuser: true, bypass_rls: true, owns_tables: true };

  it("refuses to start in production as the owner", async () => {
    await expect(check(poolAnswering(owner), {}).onApplicationBootstrap()).rejects.toThrow(/"postgres", which is a superuser/);
  });

  it("starts as the owner only when DATABASE_ALLOW_OWNER says so", async () => {
    await expect(check(poolAnswering(owner), { DATABASE_ALLOW_OWNER: true }).onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it("starts as the restricted role", async () => {
    const pool = poolAnswering({ role: "healthcare_api", superuser: false, bypass_rls: false, owns_tables: false });
    await expect(check(pool, {}).onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it("does not check outside production", async () => {
    const pool = poolAnswering(owner);
    await check(pool, { NODE_ENV: "development" }).onApplicationBootstrap();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
