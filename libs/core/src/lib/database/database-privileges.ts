import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type { Pool } from "pg";
import { APP_CONFIG, type AppConfig } from "../config/app-config";
import { DATABASE_POOL } from "./database";
import { asPlatform } from "./database-context";

/** What the connected database role may do beyond the restricted application role (migration 0109). */
export interface DatabaseRolePrivileges {
  role: string;
  superuser: boolean;
  bypassRls: boolean;
  /** The role is, or is a member of, the owner of at least one table in `public`. */
  ownsTables: boolean;
}

/** Problems with running the platform as this role: each one bypasses row-level security or the append-only rules. */
export function overPrivilegedReasons(privileges: DatabaseRolePrivileges): string[] {
  const reasons: string[] = [];
  if (privileges.superuser) reasons.push("is a superuser");
  if (privileges.bypassRls) reasons.push("has BYPASSRLS");
  if (privileges.ownsTables) reasons.push("owns the application's tables");
  return reasons;
}

export async function readDatabaseRolePrivileges(pool: Pool): Promise<DatabaseRolePrivileges> {
  const { rows } = await pool.query<{ role: string; superuser: boolean; bypass_rls: boolean; owns_tables: boolean }>(
    `SELECT r.rolname AS role, r.rolsuper AS superuser, r.rolbypassrls AS bypass_rls,
            EXISTS (SELECT 1 FROM pg_tables t WHERE t.schemaname = 'public' AND pg_has_role(current_user, t.tableowner, 'USAGE')) AS owns_tables
       FROM pg_roles r
      WHERE r.rolname = current_user`,
  );
  const row = rows[0];
  if (!row) throw new Error("Could not read the database role's privileges");
  return { role: row.role, superuser: row.superuser, bypassRls: row.bypass_rls, ownsTables: row.owns_tables };
}

/**
 * Zero trust at the data layer: in production the process refuses to start as a role that row-level security and the
 * append-only triggers' revoked privileges do not bind (docs/runbooks/database-roles.md). `DATABASE_ALLOW_OWNER=true`
 * is the explicit, logged exception for the first deploy, before the restricted role exists.
 */
@Injectable()
export class DatabasePrivilegeCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger("Database");

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.NODE_ENV !== "production") return;
    const privileges = await asPlatform("start-up check of the database role", () => readDatabaseRolePrivileges(this.pool));
    const reasons = overPrivilegedReasons(privileges);
    if (reasons.length === 0) return;
    const message = `DATABASE_URL connects as "${privileges.role}", which ${reasons.join(", ")}: row-level security and the append-only rules do not apply to it`;
    if (this.config.DATABASE_ALLOW_OWNER) {
      this.logger.warn({ event: "db.owner_connection", role: privileges.role, reasons, message: `${message} (allowed by DATABASE_ALLOW_OWNER)` });
      return;
    }
    throw new Error(
      `${message}. Connect as the restricted application role (docs/runbooks/database-roles.md), or set DATABASE_ALLOW_OWNER=true for the first deploy only.`,
    );
  }
}
