import { AsyncLocalStorage } from "node:async_hooks";
import { Logger } from "@nestjs/common";
import { Pool, type PoolClient, type PoolConfig } from "pg";

/**
 * Row-level security context (migration 0111, docs/runbooks/database-roles.md "Row-level security"). Every database
 * connection is stamped, before each use, with the organization the work belongs to (`app.organization_id`), or with
 * the platform scope (`app.scope = 'all'`) for work that crosses organizations on purpose. The policies on every
 * organization-scoped table then show and accept only that organization's rows. The application's own
 * `organization_id` filters stay; this is the second line of defence.
 *
 * The context lives in AsyncLocalStorage: a request gets a mutable store from middleware, the guards set its
 * organization once the actor is known; background work declares its scope with `asPlatform(reason, …)` or
 * `asOrganization(id, …)`. Call sites do not change.
 */
export interface DatabaseContextStore {
  organizationId?: string;
  /** Work that crosses organizations on purpose; `reason` says why (logs only). */
  platform?: { reason: string };
}

export type RowLevelSecurityMode = "off" | "observe" | "enforce";

const storage = new AsyncLocalStorage<DatabaseContextStore>();

/** Runs `fn` with a fresh, mutable context (request middleware); guards fill it in with `setRequestOrganization`. */
export function withDatabaseContext<T>(fn: () => T): T {
  return storage.run({}, fn);
}

/** Sets the organization of the current request's context (the access guards, once the actor is known). */
export function setRequestOrganization(organizationId: string): void {
  const store = storage.getStore();
  if (store && !store.platform) store.organizationId = organizationId;
}

/** Marks the current request's context as platform-wide (a platform administrator route), with the reason. */
export function setRequestPlatformScope(reason: string): void {
  const store = storage.getStore();
  if (store) {
    store.platform = { reason };
    delete store.organizationId;
  }
}

/** Runs `fn` for one organization: every query inside sees only its rows. */
export function asOrganization<T>(organizationId: string, fn: () => T): T {
  return storage.run({ organizationId }, fn);
}

/**
 * Runs `fn` across organizations on purpose (sign-in lookups, schedulers, workers); `reason` is for the logs.
 * A Drizzle query is lazy: return an `async` function (or call an async method), never the bare builder, or the query
 * runs after the scope has ended. A transaction already open keeps the context it started with.
 */
export function asPlatform<T>(reason: string, fn: () => T): T {
  return storage.run({ platform: { reason } }, fn);
}

export function currentDatabaseContext(): DatabaseContextStore | undefined {
  return storage.getStore();
}

/** The two settings stamped on a connection: organization id ('' for none) and scope ('all', 'organization' or 'none'). */
export function contextSettings(
  store: DatabaseContextStore | undefined,
  mode: RowLevelSecurityMode,
): { organizationId: string; scope: string; missing: boolean } {
  if (mode === "off") return { organizationId: "", scope: "all", missing: false };
  if (store?.platform) return { organizationId: "", scope: "all", missing: false };
  if (store?.organizationId) return { organizationId: store.organizationId, scope: "organization", missing: false };
  // No context: observe lets it through (and it is logged); enforce refuses the connection (ContextPool), and the
  // policies would let a connection stamped 'none' see and write nothing.
  return { organizationId: "", scope: mode === "observe" ? "all" : "none", missing: true };
}

/**
 * A query without an organization or platform context in enforce mode. Refused before it runs, so a path nobody
 * scoped fails visibly instead of reading nothing (docs/runbooks/database-roles.md "Row-level security").
 */
export class DatabaseContextMissingError extends Error {
  constructor() {
    super("A database query ran without an organization or platform context (DATABASE_RLS_MODE=enforce)");
    this.name = "DatabaseContextMissingError";
  }
}

const SET_CONTEXT = "SELECT set_config('app.organization_id', $1, false), set_config('app.scope', $2, false)";

/**
 * A pg Pool that stamps the current context on a connection each time it is handed out (pool.query and transactions
 * alike). Without a context, `observe` runs the query and logs its call site once per process; `enforce` logs it the
 * same way and refuses with DatabaseContextMissingError.
 */
export class ContextPool extends Pool {
  private readonly logger = new Logger("DatabaseContext");
  private readonly reported = new Set<string>();

  constructor(
    config: PoolConfig,
    private readonly mode: RowLevelSecurityMode,
  ) {
    super(config);
  }

  override connect(): Promise<PoolClient>;
  override connect(callback: (err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void): void;
  override connect(callback?: (err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void): Promise<PoolClient> | void {
    const settings = contextSettings(storage.getStore(), this.mode);
    if (settings.missing) this.report();
    const ready: Promise<PoolClient> = settings.missing && this.mode === "enforce" ? Promise.reject(new DatabaseContextMissingError()) : this.stamped(settings);
    if (!callback) return ready;
    ready.then(
      (client) => callback(undefined, client, (release) => client.release(release as Error | boolean | undefined)),
      (error: Error) => callback(error, undefined, () => undefined),
    );
  }

  private stamped(settings: { organizationId: string; scope: string }): Promise<PoolClient> {
    return super.connect().then(async (client) => {
      try {
        await client.query(SET_CONTEXT, [settings.organizationId, settings.scope]);
        return client;
      } catch (error) {
        client.release(error as Error);
        throw error;
      }
    });
  }

  /** Logs the first query without a context from each call site (the frames outside pg, drizzle and this file). */
  private report(): void {
    const site =
      new Error().stack
        ?.split("\n")
        .slice(2)
        .map((line) => line.trim())
        .find((line) => !/node_modules|database-context|node:internal|<anonymous>/.test(line)) ?? "unknown";
    if (this.reported.has(site)) return;
    this.reported.add(site);
    this.logger.warn({
      event: "db.context_missing",
      mode: this.mode,
      site,
      message:
        this.mode === "observe"
          ? "A query ran without an organization or platform context (allowed in observe mode)"
          : "A query ran without an organization or platform context (refused in enforce mode)",
    });
  }
}

/**
 * Express middleware: gives each request its own context store, which the access guards fill in once the actor is
 * known. Registered first in the API (app.module.ts).
 */
export function databaseContextMiddleware(_request: unknown, _response: unknown, next: () => void): void {
  withDatabaseContext(next);
}
