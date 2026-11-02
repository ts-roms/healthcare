# Performance and Reliability Audit

Stage A (read-only), static review only. Date: 2026-11-02. No load, soak, failover or chaos testing was performed: **Not tested**. No database was queried; index analysis compares `CREATE INDEX` statements in `database/migrations/*.sql` with query shapes read in service code, not with `EXPLAIN` plans.

## 1. Scope and method

| Area | Method | Result summary |
|---|---|---|
| Unbounded queries | List endpoints/services read; heuristic: files with 3+ `.from(` and no `.limit(` | Most user-facing lists are bounded (date windows, `limit`, cursor). Unbounded: reference-data lists and the inventory balance list (PERF-005) |
| N+1 patterns | grep of `map(async`, `for ... of` + awaited query | One real fan-out (CRM reach), several small ones (PERF-004) |
| Missing indexes | 16 busiest tables sampled (section 3) | Index coverage is good; one gap found (PERF-006) |
| Pooling | `libs/core/src/lib/database/database.module.ts`, `database-context.ts`, `app-config.ts` | Pool `max` configurable (default 10); no timeouts, no pool error handler (PERF-001, PERF-002) |
| BullMQ | `libs/notification/src/lib/bullmq.ts`, `libs/interoperability/src/lib/exchange/bullmq.ts`, `libs/laboratory/src/lib/results/lab-report-archive-queue.ts` | Retries, backoff, jobId dedupe present; failed-job retention gaps (PERF-007) |
| Graceful shutdown | `grep enableShutdownHooks/onModuleDestroy/OnApplicationShutdown` | API, both workers and DB pool close cleanly; instrument gateway has no handler (PERF-009) |
| Upload limits | `libs/documents/src/lib/document.dto.ts:8,20`, `apps/api/src/app/configure-app.ts:23` | 50 MB declared max, direct-to-object-storage; 1 MB JSON body |
| Health checks | `apps/api/src/app/health.controller.ts`, `libs/core/src/lib/health/*` | `/health/live`, `/health/ready` (DB required, Redis/object storage degrade); worker `/live` `/ready` |
| Load/capacity | None | **Not tested** |

## 2. Details

### 2.1 Connection pool and database timeouts
- `new ContextPool({ connectionString, max: DATABASE_POOL_MAX })` (`libs/core/src/lib/database/database.module.ts:16`); default max 10 (`libs/core/src/lib/config/app-config.ts:47`). `connectionTimeoutMillis`, `idleTimeoutMillis`, `statement_timeout`, `idle_in_transaction_session_timeout` are not set in code; grep for `statement_timeout` in `libs/core`, `database/` and `tools/` found nothing (it could be set at role or database level; not checked).
- `pg` defaults: no acquire timeout (waits indefinitely when all clients are busy), no statement timeout.
- No `pool.on("error", ...)` listener anywhere in the API/libs (grep). `ContextPool` extends `Pool` without registering one (`libs/core/src/lib/database/database-context.ts:95-107`). In node-postgres an error on an idle client is emitted on the pool; an `error` event without a listener throws and can terminate the process.
- Shutdown closes the pool (`database.module.ts` `onApplicationShutdown` -> `pool.end()`).

### 2.2 List endpoints and bounded queries (sample)
- Bounded and well designed: patient timeline (keyset cursor, max 100, `apps/api/src/app/patient-timeline/patient-timeline.controller.ts:35`), issued prescriptions (<= 92 days, `MAX_LIST_ROWS + 1`, `libs/prescription/src/lib/prescription-list.service.ts:76-105`), inventory movements (`.limit(200)`, `libs/inventory/src/lib/stock/inventory-stock.service.ts:~668`), notifications log (`pageSize` max 100, `libs/notification/src/lib/notification.dto.ts:40`), FHIR (`_count`, `_cursor`), management dashboard (<= 366 days).
- Unbounded / no pagination: `InventoryStockService.stock` (`inventory-stock.service.ts:582`, selects `inventoryBalance`, `inventoryStockLevel` without limit), catalogue lists (`libs/billing/src/lib/catalog/billing-catalog.service.ts:62,228,253`; `libs/laboratory/src/lib/catalog/lab-catalog.service.ts:84,119,157,281`; `inventory-queries.ts:62 items()`). These are organisation reference data and grow slowly; stock balances grow with items x locations x lots.
- Integration tests asserting pagination exist for timeline, FHIR, notifications, prescriptions and audit; none for patients search, billing, laboratory or inventory lists.

### 2.3 N+1 and fan-out
- `AppCrmReachSource.reach` (`apps/api/src/app/adapters/crm-adapters.ts:158-171`) runs `recipients.resolve` for every patient x channel concurrently with `Promise.all` (the segment preview/reach checks "the first 2,000" per CLAUDE.md). Each resolve performs its own consent/preference/contact lookups, so one preview can queue thousands of queries against a pool of 10 with no acquire timeout.
- `ReferenceLab` dispatch (`apps/api/src/app/adapters/reference-lab-adapters.ts:23`) calls `patients.identity` once per patient: bounded by one dispatch.
- `PackageService.list` (`libs/billing/src/lib/packages/package.service.ts:76-84`) calls `catalog.priceOn` per package: small N.
- `ManagementReportService` stale-run loop (`apps/api/src/app/management-dashboard/management-report.service.ts:399-404`) selects a schedule per run: bounded, background.
- No ORM lazy-loading N+1 (Drizzle, explicit queries). Dashboard composition runs domain queries in parallel via ports.

### 2.4 Index review (16 tables sampled from `database/migrations/*.sql`)
Query shapes were inferred from services; plans were not captured.

| Table | Indexes found (key columns) | Assessment |
|---|---|---|
| patient | trigram GIN on `name_search`, `family_name_normalized`; `(organization_id, created_at)`; `merged_into_patient_id` partial | Search covered; patient_number/phone lookups rely on unique constraints or `patient_identifier(patient_id)` only (identifier value lookup index not verified) |
| appointment | `(facility_id, starts_at)`, `(patient_id, starts_at DESC)`, partial `(facility_id, ends_at)` for no-shows | Good |
| visit | `(facility_id, queue_date, status)`, unique active per patient, service point partial | Good |
| encounter | `(patient_id, started_at DESC)`, `(organization_id, completed_at)` partial | Good |
| lab_order | `(patient_id, ordered_at DESC)`, `(facility_id, ordered_at)` partial active, `(organization_id, ordered_at)` | Good |
| lab_result | current unique partial, patient/test/released, `(organization_id, released_at)`, first-entered | Good |
| billing_invoice | `(facility_id, status, issued_at)`, `(organization_id, patient_id, status)`, issued partials | Good |
| billing_charge | unique source, `(organization_id, patient_id, status)` | Good |
| notification | idempotency unique, patient/user inbox, pending, org/facility log | Good |
| document | `(patient_id, created_at DESC)`, upload-by-account, quarantined | Good |
| audit_event (partitioned monthly) | org+time, patient+time, actor+time, `(resource_type, resource_id)` created on parent in `0110` | Good; time column in every index supports partition pruning |
| domain_event (outbox) | pending partial `(position)`, patient/time | Good |
| prescription | `(patient_id, issued_at DESC)` only | Gap for the facility list (PERF-006) |
| patient_message | `(thread_id, created_at, id)`, patient+sent partial | Good |
| inventory_movement | 8+ indexes incl. item, location, source, register | Over-indexed for an append-only ledger (write cost), acceptable |
| prescription_dispense | by prescription, `(org, facility, dispensed_at)`, `(org, patient, dispensed_at)` | Good |

RLS adds an `organization_id` predicate to every query (policy `organization_isolation`, migration `0111`); composite same-organization foreign keys plus `organization_id`-leading indexes mitigate this. Policy cost on large scans was not measured.

### 2.5 Queues and background jobs
- Notification queue: `jobId = notificationId` (dedupe), `attempts: 5`, exponential backoff 30 s, `removeOnComplete: true`, `removeOnFail: 1000`, concurrency 5 (`libs/notification/src/lib/bullmq.ts:27-40,61-72`); a recovery sweep re-queues stranded notifications.
- Integration queue: `jobId = exchangeId`, `attempts = INTEGRATION_JOB_ATTEMPTS`, backoff 60 s, `removeOnFail: true` (`libs/interoperability/src/lib/exchange/bullmq.ts:27-40`), concurrency 2. Failures are recorded in `integration_exchange` and visible at `/admin/integrations`, so failed Redis jobs are not the system of record.
- Lab report archive queue: same pattern (`libs/laboratory/src/lib/results/lab-report-archive-queue.ts:27-39`).
- Idempotency: DB-level (outbox `domain_event` at-least-once; `inventory_movement_source_once` unique indexes; `billing_charge_source_uq`; notification idempotency key).
- Scheduled jobs are `setInterval` timers started in `apps/api/src/main.ts` (about 12 services); claims use `FOR UPDATE SKIP LOCKED`/advisory locks in the files found (`libs/crm/src/lib/crm-campaign-runs.ts`, `libs/care-plan/src/lib/recall-reminders.ts`, `libs/core/src/lib/events/domain-events.ts`, others); not every timer was inspected for multi-instance safety.
- Redis loss: throttler fails open with a warning (`apps/api/src/app/redis-throttler-storage.ts`); socket.io falls back to local delivery.

### 2.6 Graceful shutdown, uploads, health
- `app.enableShutdownHooks()` (`configure-app.ts:24`); DB pool, queues (`onModuleDestroy`: `queue.close(); connection.disconnect()`) and timers (`onModuleDestroy` found in the scheduled services) are closed. Worker apps register shutdown handlers (`apps/notification-worker/src/main.ts`, `apps/integration-worker/src/main.ts`).
- `apps/instrument-gateway/src/main.ts:11-21` starts TCP servers without any SIGTERM/SIGINT handling; `libs/interoperability/src/lib/instruments/instrument-links.ts:20-40` (`MllpDecoder`) keeps an unbounded `Buffer` per connection (no max frame size; `Buffer.concat` on every chunk is O(n squared) for large frames); no socket idle timeout in `apps/instrument-gateway/src/listeners.ts` (grep).
- Uploads: files go to object storage via presigned flow; declared size max 50 MB (`libs/documents/src/lib/document.dto.ts:8,20`), checksum enforced, ClamAV scan with whole-scan deadline (`libs/documents/src/lib/malware-scanner.ts:34`). JSON bodies capped at 1 MB (`configure-app.ts:23`). Actual size of the stored object is read back and hashed (CLAUDE.md section 0); enforcement of the declared size against the real object was not verified in code.
- Health: `/health/ready` returns 503 only for the database, `degraded` for Redis/object storage; storage probe cached 60 s (`health.controller.ts:23`). Railway health path per `railway.json` not re-verified.
- Rate limits: global throttler 300 req/60 s per client (`apps/api/src/app/app.module.ts:186`), Redis-backed.

## Findings

### PERF-001 HIGH No `error` listener on the pg pool
- Location: `libs/core/src/lib/database/database.module.ts:16`, `libs/core/src/lib/database/database-context.ts:95-107`.
- Evidence: grep for `pool.on(` / `.on("error"` in `libs/core` and `apps/api/src` finds only Redis/socket/gzip listeners. node-postgres emits `error` on the Pool when an idle client fails (database restart, failover, network drop); an unhandled `error` event raises an uncaught exception.
- Impact: a PostgreSQL failover or restart can crash the API (and workers using the pool) instead of reconnecting; a restart loop during maintenance windows. Not reproduced (no destructive tests).
- Recommended fix: register `pool.on("error", log)` in `ContextPool`; add `process.on("unhandledRejection"/"uncaughtException")` logging with controlled exit.
- Status: Open

### PERF-002 MEDIUM No connection acquire or statement timeouts
- Location: `libs/core/src/lib/database/database.module.ts:16`.
- Evidence: only `connectionString` and `max` are passed; no `connectionTimeoutMillis`, `statement_timeout`, `idle_in_transaction_session_timeout` in code, migrations or tools (grep). Default `max` 10 (`app-config.ts:47`).
- Impact: a slow query or a leaked transaction makes every request queue indefinitely; requests do not fail fast under load, hiding saturation until clients time out.
- Recommended fix: set `connectionTimeoutMillis` (e.g. 5-10 s), role-level `statement_timeout`, `idle_in_transaction_session_timeout`; export pool wait/usage metrics.
- Status: Open

### PERF-003 MEDIUM Outreach reach check fans out thousands of concurrent resolutions
- Location: `apps/api/src/app/adapters/crm-adapters.ts:158-171`.
- Evidence: `Promise.all(patientIds.map(... Promise.all(channels.map(resolve))))`, up to the first 2,000 patients per CLAUDE.md, against a pool of 10 with no acquire timeout.
- Impact: one segment preview can saturate the pool and delay clinical requests (queue, triage) on the same instance.
- Recommended fix: process in bounded batches (e.g. 25 concurrent) or resolve preferences with one set-based SQL query.
- Status: Open

### PERF-004 LOW Small per-row fan-outs
- Location: `libs/billing/src/lib/packages/package.service.ts:76-84`, `apps/api/src/app/adapters/reference-lab-adapters.ts:23`, `libs/billing/src/lib/payments/deposit.service.ts:219,312`.
- Evidence: `map(async ...)` with a query per element.
- Impact: grows linearly with packages/patients per dispatch; negligible today.
- Recommended fix: batch price lookups and identity lookups.
- Status: Open

### PERF-005 LOW Unpaginated stock and catalogue lists
- Location: `libs/inventory/src/lib/stock/inventory-stock.service.ts:582`, `libs/billing/src/lib/catalog/billing-catalog.service.ts:62,228,253`, `libs/laboratory/src/lib/catalog/lab-catalog.service.ts:84-281`, `libs/inventory/src/lib/stock/inventory-queries.ts:62`.
- Evidence: selects without `.limit()`/cursor.
- Impact: response size grows with items x locations x lots; memory and payload growth for large clinics.
- Recommended fix: add cursor pagination or a hard cap with a "truncated" flag (as in prescription list).
- Status: Open

### PERF-006 LOW Prescription facility/date list lacks a supporting index
- Location: `database/migrations/0010_prescription.sql:36` (only `prescription_patient_idx (patient_id, issued_at DESC)`); query at `libs/prescription/src/lib/prescription-list.service.ts:70-77`.
- Evidence: the list filters `organization_id`, `facility_id`, `issued_at` range (<= 92 days) and groups by status; no matching index found in any migration (`grep -hiE "index.*prescription"`).
- Impact: sequential scan of the prescription table per list view; grows with history.
- Recommended fix: `CREATE INDEX ... ON prescription (organization_id, facility_id, issued_at DESC)` in a new forward-only migration.
- Status: Open

### PERF-007 LOW Failed BullMQ jobs are discarded
- Location: `libs/interoperability/src/lib/exchange/bullmq.ts:38`, `libs/laboratory/src/lib/results/lab-report-archive-queue.ts:37`.
- Evidence: `removeOnFail: true` (notifications keep 1000, `libs/notification/src/lib/bullmq.ts:37`).
- Impact: no Redis-side evidence (stack, attempts) of final failures; mitigated because `integration_exchange` and the archive table record outcomes, and queue-failure metrics exist (`libs/core/src/lib/telemetry/metrics.ts:37`).
- Recommended fix: keep a bounded number (e.g. 500) of failed jobs for diagnostics.
- Status: Open

### PERF-008 INFO Capacity and load behaviour unknown
- Evidence: no load or soak test exists in `apps/` (only `apps/api/test/clinic-dashboard-load.int.spec.ts`, a dashboard query test); this audit did not run any.
- Impact: Not tested; pool size 10 and global 300 req/min per client throttle are unvalidated against clinic peak load.
- Recommended fix: k6/Artillery scenarios for queue board, patient search, lab worklist and result release against a seeded database with `pg_stat_statements` enabled.
- Status: Open

### PERF-009 MEDIUM Instrument gateway: unbounded frame buffer, no idle timeout, no shutdown handling
- Location: `libs/interoperability/src/lib/instruments/instrument-links.ts:20-40`, `apps/instrument-gateway/src/listeners.ts`, `apps/instrument-gateway/src/main.ts:11-21`.
- Evidence: `MllpDecoder.push` concatenates every chunk and only trims when a terminator arrives; no maximum message size; no `socket.setTimeout`; no SIGTERM handler (grep).
- Impact: a faulty or hostile device on the LAN can grow gateway memory without bound; ASTM/HL7 messages in flight may be cut on redeploy without ACK semantics. Exposure is limited to the clinic network.
- Recommended fix: cap frame size (e.g. 1 MB) and destroy the socket, add idle timeout and a graceful close on SIGTERM.
- Status: Open
