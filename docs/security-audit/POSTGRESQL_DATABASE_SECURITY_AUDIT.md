# PostgreSQL database security audit (Stage A, read-only)

Date: 2026-11-02. Scope: `database/migrations/0001-0135`, `libs/core/src/lib/database`, `libs/core/src/lib/idempotency`, billing/inventory/patient services (concurrency), `infrastructure/docker`, `infrastructure/terraform/railway`, `apps/*/railway.json`, `docs/database`, `docs/runbooks`. Method: static reading and grep. No database connection, no test execution. Anything requiring a live database is marked Not verified. See DATABASE_INVENTORY.md for counts and table lists.

Classification used: Verified secure, Tested no issue (none: nothing was run), Not tested, Incomplete implementation, Confirmed vulnerability (code-level, not exploited).

## 1. Least privilege

| Check | Result | Evidence |
|---|---|---|
| Application role is not owner and cannot DDL | Verified secure by design, conditional on deployment | `healthcare_app` NOLOGIN group, grants DML only (0109:23-60); no CREATE privilege granted |
| Append-only tables lose UPDATE/DELETE | Verified secure (design) | 0109:44-58 derives revokes from unconditional `prevent_mutation` triggers; rerun after every migration (`migrator.ts:68-70`) |
| TRUNCATE revoked, `schema_migration` read-only | Verified secure | 0109:36-38 |
| Migration role separated | Verified in config | `MIGRATION_DATABASE_URL` on API only (terraform `main.tf:48`); `apps/api/railway.json` preDeploy `pnpm db:migrate` |
| Superuser exposure | Dev only | `infrastructure/docker/docker-compose.yml:8-9` creates `healthcare/healthcare` (POSTGRES_USER is superuser); `.env.example:7,9` use it. Production default is the owner, not superuser (DB-001) |
| Restricted role actually in force in production | Incomplete implementation | requires a manual `CREATE ROLE` step; `restricted_database` is false when `secrets.app_database_url` is unset (`main.tf:142-151`); no start-up or readiness check (no `rolsuper`/`current_user` check found: `git grep rolsuper` empty) |
| `healthcare_app` lacks BYPASSRLS/SUPERUSER | Verified | `CREATE ROLE healthcare_app NOLOGIN` (0109:19-21) uses defaults; the login role is created by hand with `IN ROLE healthcare_app`, flags not enforced anywhere (Not verified in a live server) |
| SECURITY DEFINER functions | See DB-007 | two, both in 0110, both set `search_path = public, pg_temp` (good) |

## 2. Row-level security completeness

- Mechanism and policy text: 0111:15-61. `apply_rls_policies()` iterates every ordinary or partitioned table that has an `organization_id` column and no `organization_isolation` policy, enables RLS, creates the policy; it runs after every migration (`migrator.ts:66-69`), so later tables are covered (Verified).
- Covered: all 247 tables with an `organization_id` column (inventory section 1). I could not execute the catalog to confirm that all 247 actually carry the policy (Not verified); logic is complete by construction. `apps/api/test/schema.int.spec.ts` and the integration harness run `enforce` (apps/api/test/harness.ts:80) but were not run.
- Not covered (no `organization_id`): 15 tables, listed in DATABASE_INVENTORY.md 3.2. Of these, patient-data tables: `prescription_item`, `care_plan_problem`, `care_plan_goal`, `care_plan_progress_note`, `idempotency_record`. Isolation is application-level (parent join). See DB-004, DB-005.
- Facility-level isolation: none in the database; only organization. Facility scope is enforced by `@RequireFacility` and per-grant scope in the application (Not verified end to end in this audit).
- No FORCE RLS: the table owner (migrations, seeds, restores, and the API itself when running as owner) bypasses all policies (0111 header says so deliberately).
- Observe versus enforce: default `DATABASE_RLS_MODE` is `observe` (`libs/core/src/lib/config/app-config.ts:51`). In observe a connection with no context is stamped `scope = 'all'` (`database-context.ts:68-70`), i.e. RLS is suspended for that query and only a warning is logged once per call site (`:141`). `off` stamps everything `all`. Only `enforce` makes a missing context fail closed. The variable is not in `.env.example` (docs/audit/2026-10-20 R-04) nor set in terraform (`git grep` found it only in config, docs and test/e2e harnesses). The organization rule applies in observe whenever a context exists. See DB-002.
- RLS is a session-variable design: any code that can run arbitrary SQL as the app role can call `set_config('app.scope','all',false)`. It defends against missing `WHERE organization_id` bugs, not against SQL injection or a compromised app process (DB-008).
- Rows without an organization are visible to all contexts and writable by all (DB-003).

## 3. SQL construction and parameterisation

- Drizzle query builder and tagged `sql` templates are used throughout; `${}` values are bound parameters. `git grep sql.raw` (non-test) found 5 uses, all on constants: `clinic-reporting.queries.ts:165,205,207,212` (column names from code literals; `localDay(column)` takes literals) and `immunization.service.ts:655` (ternary of two literals). No string-concatenated `query()`/`execute()` call was found by the grep heuristics used (Verified for the patterns searched; not a proof of absence).
- Dynamic identifiers in SQL: `format('%I', ...)` is used in migrations' plpgsql (0109:54, 0110:96, 0111) which is the safe form. `remove_audit_partition` builds `EXECUTE format('... %I', p_partition)` after matching the name against `audit_partitions()` (0110:187-189) (Verified).
- Idempotency interceptor uses bound parameters (`idempotency.interceptor.ts:57-85`).

## 4. Constraint coverage

- Verified present: composite same-organization FKs, uuid keys, 1585 CHECKs, 58 unique indexes, GiST exclusion for double booking and overlapping reference ranges (inventory section 5).
- Verified: money and stock invariants at the database: stock balance `CHECK (quantity >= 0)` (0026:89); account balance trigger (0035:127-146); idempotency UNIQUEs on payments (0019:306, 0038).
- Cascading deletes: only 3 `ON DELETE CASCADE` FKs, all in calendar/route-template configuration (0087:61, 0116:35,50); none on clinical, billing or audit data. Verified secure.
- Soft delete: convention is status/retired/entered-in-error columns plus triggers, not DELETE (docs/database/README.md). But many clinical tables have no trigger blocking DELETE (DB-006). Billing: `invoice.service.ts:222` deletes a draft invoice (`tx.delete(billingInvoice)`), allowed by `billing_invoice_guard` for drafts (guard body not reviewed: Not verified).
- Patient merge links rather than moves; stale references blocked by `refuse_record_for_merged_patient` triggers (0068+).

## 5. Concurrency and race handling

| Area | Result | Evidence |
|---|---|---|
| Patient / document / referral / records-request numbers | Verified secure | single-statement `INSERT ... ON CONFLICT DO UPDATE SET next_value = next_value + 1 RETURNING` (`patient-registration.service.ts:270-272`, `records-request.service.ts:101-103`), serialised by row lock |
| Billing document numbers | Verified | `UPDATE billing_sequence ... next_value + 1 RETURNING` (`billing-catalog.service.ts:354-356`), authorised ranges checked under `FOR UPDATE` (`:328`) |
| Stock double-issue | Verified secure | `lockBalance` inserts-if-missing then `SELECT ... FOR UPDATE` on the balance row (`inventory-stock.service.ts:851-858`) plus `CHECK (quantity >= 0)` (0026:89); once-per-source uniqueness reported in CLAUDE.md for consume/restore (Not read) |
| Deposit / credit double-spend | Verified secure | per-patient `pg_advisory_xact_lock` (`billing-support.ts:36-38`) taken in deposit apply/refund (`deposit.service.ts:90,130,170`), credit notes (`credit-note.service.ts:163`) and online payment settlement (`online-payment.service.ts:206`); database trigger re-checks balance (0035:127-146). The trigger alone is race-prone under READ COMMITTED; the lock closes it |
| Payment idempotency | Verified | `UNIQUE (organization_id, idempotency_key)` (0019:306); payment intents (0038); invoice `FOR UPDATE` (`invoice.service.ts:305,367,420,714`) |
| HTTP idempotency keys | Partly | `idempotency.interceptor.ts`: atomic insert-or-conflict, request hash, 24 h; keyed per user only; response bodies stored (DB-005) |
| Schedulers on several instances | Verified | `pg_try_advisory_xact_lock` in recurring jobs (`laboratory-quality-reminders.ts:52`, `management-report-runs.ts:42`, `crm-approval-notices.ts:125`, `patient-message-reminders.ts:48`); migrations take `pg_advisory_lock` (`migrator.ts:26`) |
| Optimistic locking | Verified by convention | `version integer` on aggregates; `version_conflict` (docs/database/README.md) |

Concurrent-execution behaviour was not tested (no test runs allowed). 92 files use `FOR UPDATE`/`.for("update")` in libs (`git grep -c`).

## 6. Transaction boundaries and audit consistency

- Convention (CLAUDE.md "Audit"/"Events"): audit rows and outbox events are written in the same transaction as the change; reads use `recordStandalone` in a separate transaction. 197 `recordStandalone` call sites. A failing standalone audit write on a read: whether the read is then refused or served unaudited was Not verified.
- One-query-per-connection rule enforced in tests (apps/api/test/one-query-per-connection.ts): Not run.
- Connection context: `ContextPool.connect` re-stamps `set_config` on each checkout (`database-context.ts:117-135`); a stamping failure releases and rethrows. Because settings are session-level, a connection returned to the pool keeps the last tenant's stamp until the next checkout re-stamps it; every checkout path goes through `connect` so no gap was found (Verified for pg Pool `query`/`connect`; third-party code using the raw `Pool` internals would bypass, none found).

## 7. Backup, restore, encryption

- Procedure documented: `pg_dump --format=custom --no-owner --no-acl`, restore into a new database, checks, re-run migrate to restore grants (docs/runbooks/backup-and-restore.md). Docs state "tested locally"; the compliance register keeps it open until tested in the real environment.
- Not evidenced: backup schedule, retention, off-site copy, encryption of dumps (runbook: "Encrypt it ... the tool and location are the organization's decision"), point-in-time recovery, RPO/RTO, bucket restore ("has not been tested"). `docs/database/README.md` "Production hardening (not yet done)". Status: Incomplete implementation / Not tested (DB-010).
- TLS to PostgreSQL: the `pg` pool takes only `connectionString` and `max` (`database.module.ts:16`); TLS is whatever the URL's `sslmode` says. No assertion or doc found requiring it. Railway private networking is the documented path. Not verified (DB-009).

## 8. Positive controls worth keeping

Append-only history with dual defence (trigger plus privilege), partitioned and archivable audit trail, advisory-lock money paths, composite FKs, FEFO stock under row locks, sealed integration payloads with a key ring, migration checksums, and `apply_*` functions that self-heal after restore.

## Findings

### DB-001 HIGH - Production defaults to the database owner; least-privilege, RLS and append-only privileges are inactive until a manual step is done
- Location: `infrastructure/terraform/railway/main.tf:29,142-151`; `docs/runbooks/database-roles.md` ("Until it exists, everything runs as the owner"); 0111 header ("The owner ... is not subject to these policies"); no runtime check (`git grep rolsuper|current_user` found none).
- Evidence: `DATABASE_URL` becomes `${{Postgres.DATABASE_URL}}` (owner) unless `secrets.app_database_url` is set. Owner can ALTER/DROP triggers, UPDATE/DELETE every table, TRUNCATE, and bypasses RLS.
- Exploitability: any SQL execution bug, stolen DATABASE_URL, or insider with the API container gets full tamper ability including the audit trail; nothing alerts that the hardened role is not in use.
- Impact: audit immutability and tenant isolation promised in docs are not real in that deployment.
- Fix: add a start-up and `/health/ready` check that logs/degrades (or refuses in production) when `current_user` is a superuser, owns `audit_event`, or has BYPASSRLS; make `app_database_url` required in the terraform production configuration; set `FORCE ROW LEVEL SECURITY` once the owner is not the runtime role.
- Status: Open

### DB-002 MEDIUM - RLS ships in `observe`: a query with no context runs with platform scope
- Location: `libs/core/src/lib/config/app-config.ts:51`; `database-context.ts:63-71`; not in `.env.example`, not in terraform.
- Evidence: default `observe`; `contextSettings` returns `scope: "all"` for a missing context in observe.
- Exploitability: any new code path (or existing unscoped one) that forgets `asOrganization`/guard context reads and writes all tenants; only a log line results.
- Impact: second line of defence silently absent; the runbook plan (30 clean days then enforce) has no owner or date.
- Fix: set `DATABASE_RLS_MODE=enforce` in terraform for all three services now (tests/E2E already run enforce), add the variable to `.env.example`, alert on `db.context_missing`.
- Status: Open

### DB-003 MEDIUM - Policies on nullable-organization tables let any organization context modify shared rows
- Location: 0111:50-52; `role` (0004:32), `auth_session` (0004:87); `role_permission` (0004, no organization_id, no RLS).
- Evidence: `WITH CHECK (organization_id IS NULL OR visible)` and `USING (organization_id IS NULL OR visible)` apply to INSERT/UPDATE/DELETE. No trigger protects `is_system` roles or `role_permission` rows (not in the trigger scan). Built-in-role immutability is enforced only in application code ("built-in roles read-only", CLAUDE.md `/admin/roles`).
- Exploitability: needs an application bug or SQL execution as the app role from one organization; it can then change the permission set of built-in roles used by every organization.
- Impact: cross-tenant privilege escalation path that RLS was meant to close.
- Fix: split the policy: shared rows SELECT-only for organization contexts, write only under platform scope; add a trigger refusing UPDATE/DELETE of `role` rows with `is_system` and of their `role_permission` rows.
- Status: Open

### DB-004 MEDIUM - Patient-data child tables have no `organization_id` and therefore no RLS
- Location: `prescription_item` (0010:38), `care_plan_problem` (0011:31, has `patient_id`), `care_plan_goal` (0011:41), `care_plan_progress_note` (0011), also `notification_attempt` (0007:44).
- Evidence: scanner and direct read of the DDL: no organization column; policies are created only for tables with one (0111:36-45).
- Exploitability: a query that selects these children by id or patient without joining the parent returns another tenant's medication or care-plan content even in `enforce`.
- Impact: the second line of defence has a hole exactly on prescriptions and care plans.
- Fix: migration adding `organization_id` (backfilled from the parent, composite FK, NOT NULL) so `apply_rls_policies()` covers them; or policies using an EXISTS on the parent.
- Status: Open

### DB-005 MEDIUM - `idempotency_record` stores whole API responses (PHI) in clear and is never purged
- Location: `libs/core/src/lib/idempotency/idempotency.interceptor.ts:57-85` (`response_body jsonb`), 0001:14-28; `git grep idempotency_record` finds no other reader or cleanup job.
- Evidence: expired rows are deleted only inside `begin()` for the same `(user_id, key)` (`:59-62`). Rows otherwise persist indefinitely. The table has no `organization_id`, so no RLS; the key is per user only and the request hash does not include organization or facility headers.
- Exploitability: DB read access or backup exposure yields PHI copies that outlive the 24 h intent; a user with several memberships replaying the same key/path/body under another facility would be served the first response.
- Impact: unbounded PHI duplicate outside the audited, access-controlled record; retention not governed.
- Fix: scheduled purge of `expires_at < now()`; store a hash or status only for sensitive routes, or encrypt the body; include organization and facility in the request hash; add `organization_id` and RLS.
- Status: Open

### DB-006 MEDIUM - Core clinical tables lack database-level immutability; app role can UPDATE/DELETE them
- Location: tables `patient`, `encounter`, `diagnosis`, `document`, `lab_order`, `lab_specimen`, `lab_order_item` (no trigger in any migration names them; DATABASE_INVENTORY.md section 4); 0109:36 grants DML to all tables.
- Evidence: only unconditional `prevent_mutation` tables lose UPDATE/DELETE privilege (0109:44-58).
- Exploitability: needs an application bug or SQL execution as the app role.
- Impact: contradicts CLAUDE.md "Delete clinical records without a documented policy: never"; a childless diagnosis, encounter or order can be removed without trace except the audit row the app chose to write.
- Fix: BEFORE DELETE `prevent_mutation()` on these tables (DELETE only) and revoke DELETE from `healthcare_app`; keep UPDATE guarded by state-machine triggers where lifecycle exists.
- Status: Open

### DB-007 MEDIUM - SECURITY DEFINER `remove_audit_partition` is executable by the application role and its safeguards are caller-supplied or app-writable
- Location: 0109:31 (`GRANT EXECUTE ON ALL FUNCTIONS ... TO healthcare_app`, rerun after every migration), 0110:178-214 (`REVOKE ... FROM PUBLIC` only), `audit-retention.service.ts:178` (the API calls it as the app role).
- Evidence: retention months `p_retention_months` is a function parameter (a caller may pass 1); the "verified archive" it requires is a row in `audit_archive`, which the app role can INSERT (the CHECK constraints at 0110:126-148 only require non-null hash/key/count fields; the function does not check object storage); `row_count` can be read by the caller with `SELECT count(*)`. The function then detaches and drops the partition as owner.
- Exploitability: requires SQL execution as the app role (injection, compromised process, or a malicious API admin path). Not exercised.
- Impact: defeats the append-only audit guarantee that DB-level privilege revocation is meant to provide; an attacker can erase a month of audit evidence.
- Fix: revoke EXECUTE of both functions from `healthcare_app` and call them through a separate role used only by the retention route, or move retention months into a database setting the function reads; have the function verify `archive.status = 'verified'` was written by a trusted role (separate `audit_archive` writer).
- Status: Open

### DB-008 LOW - RLS context is a session GUC; it is not a security boundary against SQL execution
- Location: `database-context.ts:100-135` (`set_config(..., false)`); 0111:15-19.
- Evidence: any session may call `set_config('app.scope','all',false)`; policies trust it.
- Impact: protects against forgotten filters only; documents should say so. Related to DB-001/DB-007 (an attacker with SQL execution has the same powers).
- Fix: document the limit; consider per-tenant database roles or `SET LOCAL` inside transactions with a signed context function if a hard boundary is required.
- Status: Open

### DB-009 LOW - TLS to PostgreSQL is not asserted
- Location: `libs/core/src/lib/database/database.module.ts:16` (pool config has `connectionString`, `max` only).
- Evidence: no `ssl` option or production check; relies on URL parameters or private network.
- Fix: in production require `sslmode=require/verify-full` in `DATABASE_URL` unless the host is a private Railway address, and log a warning otherwise. Verify with the provider (Not verified).
- Status: Open

### DB-010 MEDIUM - Backup, PITR and restore evidence is incomplete
- Location: `docs/database/README.md` "Production hardening (not yet done)"; `docs/runbooks/backup-and-restore.md` (schedule, retention, encryption, PITR are "the organization's decision"; bucket restore "has not been tested").
- Evidence: no schedule, RPO/RTO or successful production restore record in the repository.
- Impact: availability and integrity of PHI after failure or ransomware is unproven; audit archive in object storage is a second copy only if the bucket itself is backed up.
- Fix: choose and document PITR/WAL archiving, encrypted dumps, retention, and run a timed restore drill; record outputs in the incident log.
- Status: Open

### DB-011 LOW - Weak development defaults can reach production configuration
- Location: `.env.example:7,13,17` (`healthcare:healthcare`, `JWT_ACCESS_SECRET=change-me...` 44 characters, MFA key placeholder), `infrastructure/docker/docker-compose.yml:8-9`; `app-config.ts:53` only enforces `min(32)`.
- Evidence: the placeholder JWT secret passes validation in production; only INTEGRATION_PAYLOAD_KEY is required to differ in production (`app-config.ts:224-238`).
- Fix: in production reject the known placeholder values and require `MFA_ENCRYPTION_KEY` not equal to the example.
- Status: Open

### DB-012 INFO - Verified controls (no action)
- Parameterised SQL (section 3), advisory-lock deposit/credit path and FOR UPDATE stock path (section 5), `search_path` fixed on SECURITY DEFINER functions (0110:188 area), only 3 benign cascades, checksum-verified forward-only migrations.
- Status: Open (informational)

### DB-013 LOW - Concurrency and ledger rules rely on tests that were not run in this audit
- Evidence: integration suites (`apps/api/test/*.int.spec.ts`) were not executed per the audit rules; trigger behaviour (guards, merged-record refusal) is Not tested here.
- Fix: run integration and E2E in CI on the target PostgreSQL major (16) as the restricted role in `enforce`, and archive results as audit evidence.
- Status: Open
