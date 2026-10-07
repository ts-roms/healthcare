# Database roles: the application connects with least privilege

The API and both workers should not connect as the database owner. An owner can alter or drop tables and disable the
triggers that keep the audit trail, consent history, payments and stock movements append-only. Migration `0109`
creates a group role, `healthcare_app`, that may read and write but may not:

- update or delete rows that an unconditional `prevent_mutation()` trigger protects (the audit trail, consent
  history, billing notes and payments, stock movements and every other append-only table — about 60 tables; the
  trigger stays as the second line of defence);
- truncate any table, write the migration ledger (`schema_migration`), or create, alter or drop anything.

`apply_app_privileges()` sets these rights from the triggers themselves, and `pnpm db:migrate` calls it after every
run. Tables and append-only triggers added by later migrations, and a database restored with `pg_restore --no-acl`,
are therefore covered without a step to remember. Nothing in the application changes: it never did what the role
withholds.

The login role the processes use is created once, by hand, with its own password, because a password never belongs
in the repository and Railway's Terraform provider does not manage PostgreSQL roles. Until it exists, everything runs
as the owner exactly as before.

## Who connects as what

| Process                                      | Variable                 | Role                                          |
| -------------------------------------------- | ------------------------ | --------------------------------------------- |
| API, notification worker, integration worker | `DATABASE_URL`           | `healthcare_api` (member of `healthcare_app`) |
| API pre-deploy migration (`pnpm db:migrate`) | `MIGRATION_DATABASE_URL` | the owner (`${{Postgres.DATABASE_URL}}`)      |
| `pnpm db:seed`, restores, manual repairs     | given explicitly         | the owner                                     |

`pnpm db:migrate` uses the URL given as its argument, else `MIGRATION_DATABASE_URL`, else `DATABASE_URL`.

## Set it up (once per environment)

1. Deploy a release that contains migration `0109` (its pre-deploy migration creates `healthcare_app` and grants it).
2. Generate a password: `openssl rand -base64 32 | tr -d '/+=' | cut -c1-32`.
3. As the owner (Railway: the Postgres service's **Data** tab or `psql "$DATABASE_URL"` from a shell with the owner's
   URL), create the login role:

   ```sql
   CREATE ROLE healthcare_api LOGIN PASSWORD '<password>' IN ROLE healthcare_app;
   ```

4. Check it from that session:

   ```sql
   SET ROLE healthcare_api;
   SELECT count(*) FROM audit_event;                                  -- works
   UPDATE audit_event SET action = action WHERE false;                -- ERROR: permission denied for table audit_event
   RESET ROLE;
   ```

5. Switch the variables, then redeploy the three services:
   - **Terraform** (`infrastructure/terraform/railway/`): set `secrets.app_database_url` to
     `postgresql://healthcare_api:<password>@<private host>:<port>/<database>` (the owner's URL with the user and
     password replaced). The module then sets it as `DATABASE_URL` on the API and both workers, and
     `MIGRATION_DATABASE_URL = ${{Postgres.DATABASE_URL}}` on the API only. Apply.
   - **By hand** (Railway dashboard): on `api`, add `MIGRATION_DATABASE_URL = ${{Postgres.DATABASE_URL}}`; on `api`,
     `notification-worker` and `integration-worker`, set `DATABASE_URL` to the `healthcare_api` URL.
6. Verify: the API's deploy log shows the migration ran ("0 applied"), `GET /api/v1/health/ready` answers `200`, a
   sign-in works and appears on `/admin/audit`.

## Roll back

Set `DATABASE_URL` on the three services back to `${{Postgres.DATABASE_URL}}` (Terraform: remove
`secrets.app_database_url`) and redeploy. The role can stay; to remove it: `DROP ROLE healthcare_api;`.

## Rotate the password

```sql
ALTER ROLE healthcare_api PASSWORD '<new password>';
```

Update `DATABASE_URL` (or `secrets.app_database_url`) and redeploy straight away: running processes keep their open
connections, new ones need the new password.

## When something is refused

`permission denied for table …` from the application means it tried something the role withholds. Do not grant it
back by hand: the next migration run would take it away again. Either the code is wrong (an append-only table must
only receive inserts) or a new migration must change the trigger and say why. Integration tests and the end-to-end
journeys run the application as this role (`apps/api/test/harness.ts`, `apps/e2e/support/env.ts`), so such a change
fails there first.

## Row-level security per organization

Migration `0111` turns on row-level security for every table with an `organization_id` (222 tables; partitions of the
audit trail through their parent; tables added later by `apply_rls_policies()`, which `pnpm db:migrate` runs after
every migration). Through the application role a connection sees and writes only the rows of the organization it is
stamped with, or every row under the platform scope. The owner is not subject to it: a deployment whose
`DATABASE_URL` is still the owner sees no change.

**Where the stamp comes from** (`libs/core/src/lib/database/database-context.ts`): the API's first middleware gives each
request a context; the staff access guard sets the member's organization once the session is resolved, the MyHealth
guard the patient's; a platform administrator route takes the platform scope. Background work declares its scope:
every scheduler tick, the outbox relay and the three BullMQ workers run under `asPlatform(reason, …)` because they act
on rows of every organization by id; the session lookups in both guards run under it too. `ContextPool` stamps each
connection (`set_config('app.organization_id' / 'app.scope')`) when it is handed out, so `pool.query` and transactions
alike carry the context of the code that asked for them.

**Rows without an organization:** built-in roles and sessions before an organization is chosen are visible to every
context; audit events without one (a failed sign-in with an unknown email) can always be written and are visible only
to the platform scope.

**Modes** (`DATABASE_RLS_MODE` on the API and both workers):

| Mode                | A query without any context                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `observe` (default) | Runs as before. Its call site is logged once per process: `event: "db.context_missing"`, with `site`. |
| `enforce`           | Sees nothing and can write nothing (the policies refuse it).                                          |
| `off`               | Every connection gets the platform scope: the organization rule is suspended (rollback only).         |

The organization rule itself applies in `observe` and `enforce` alike: a request stamped with organization A never
sees or writes organization B's rows. Phase 2 follows the `db.context_missing` log lines (sign-in routes, public
MyHealth routes, the realtime socket and the remaining unmarked paths) to zero, then makes `enforce` the default.

**When something is missing:** a request that reads another organization's rows on purpose (none is known) must say
so with `asPlatform("why", …)` in the service, never by widening the policy. A row "not found" that exists means the
request ran under another organization's context; a write refused with `new row violates row-level security policy`
means the row's organization is not the request's.

## Not covered

Partitioning and retention of the audit trail are in the [audit retention runbook](audit-retention.md). Backups and
point-in-time recovery on the host remain open in [`docs/database/README.md`](../database/README.md) and the
[backup and restore runbook](backup-and-restore.md).
