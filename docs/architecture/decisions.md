# Architecture decisions

Short records of decisions taken while building Phase 1. Add new entries at
the end; do not rewrite accepted ones — supersede them.

## ADR-0001 SQL-first migrations, Drizzle as query layer

**Decision.** The schema is defined by hand-written, forward-only SQL files in
`database/migrations/`, applied by `runMigrations` (checksummed, advisory-locked,
one transaction per file). Libraries use Drizzle for typed queries.

**Why.** Healthcare invariants belong in the database (CLAUDE.md §24):
composite same-organization foreign keys, check constraints, partial unique
indexes, append-only triggers. These are clearest as plain SQL and reviewable in
PRs. A generated-migration tool would need per-lib schema imports across
domain boundaries.

**Consequence.** Table definitions exist twice (SQL + Drizzle). A schema drift
integration test compares them.

## ADR-0002 Access metadata in core, enforcement in auth

**Decision.** `@Public`, `@RequirePermissions`, `@RequireFacility`,
`@RequirePlatformAdmin`, `@CurrentActor` and the permission catalog live in
`libs/core`. `libs/auth` registers one global `AccessGuard` that authenticates,
resolves organization/facility/department context, computes effective
permissions and enforces the metadata.

**Why.** Every domain library can declare access rules without importing auth,
keeping the dependency graph acyclic. Secure-by-default: a new route without
metadata still requires authentication.

## ADR-0003 Zod for validation and OpenAPI

**Decision.** Request validation uses Zod via `nestjs-zod` (`createZodDto`,
global `ZodValidationPipe`). class-validator is not used.

**Why.** CLAUDE.md §1 asks for one approach. Zod schemas can later be shared
with the Next.js and Expo clients.

## ADR-0004 Sessions: short-lived JWT + rotating refresh token, checked per request

**Decision.** Access tokens are 15-minute HS256 JWTs bound to a server-side
session. The guard checks the session, user status and membership on every
request, so logout, password change and suspension take effect immediately.
Refresh tokens are random, stored as SHA-256 hashes, rotated on every use;
replaying a rotated token revokes the session.

**Trade-off.** A few indexed queries per request. Add a short-lived cache
before this becomes a bottleneck.

## ADR-0005 Notifications: stored first, delivered by a worker, ports for recipients and channels

**Decision.** `NotificationService.send` validates the template, resolves the
recipient through the `RecipientDirectory` port (consent/preferences), stores
the notification (including suppressed ones) and enqueues it on BullMQ. The
worker claims it atomically, records each attempt and calls a `ChannelSender`.
A reconciler re-enqueues stranded notifications. Delivery is at-least-once.

**Why.** Complete communication history (CLAUDE.md §16, §27); replaceable
providers (§19); SMS/push providers are not selected yet, so production uses a
sender that fails loudly rather than pretending to deliver.

## ADR-0006 Patient identity is per organization

**Decision.** A patient belongs to one organization and is shared by all of its
facilities (one canonical identity, CLAUDE.md §5). Cross-organization identity
(e.g. a network sharing records) is out of scope until there is a consent and
data-sharing model for it.

## ADR-0007 Appointments, queue and encounters in one clinic library

**Decision.** Scheduling, appointments, the facility queue (visits), triage, vital
signs, allergies, encounters and diagnoses live in `libs/clinic` rather than
separate `appointment`, `queue` and `encounter` libraries. Prescriptions and care
plans are separate domain libraries (`libs/prescription`, `libs/care-plan`).

**Why.** Check-in marks the appointment and creates the queue entry in one
transaction; starting and signing an encounter move the queue entry and complete
the appointment. Splitting these would force cross-library transactions or
eventual consistency where the clinic workflow needs immediate consistency
(CLAUDE.md §26). `libs/clinic/CLAUDE.md` allows either layout.

**Consequence.** Prescription and care-plan reach clinic data only through a port
(`PrescribingContext`) or through composite `(patient_id, id)` foreign keys that
guarantee references belong to the same patient.

## ADR-0008 Unified workspace after merging the frontend prototype

**Decision.** The backend (this branch) and the frontend prototype (main) share one
Nx workspace. Main's conventions win for tooling that applies to everyone: the
`type:*` + `scope:*` module-boundary tags, Prettier (160 columns, Tailwind
plugin) and the CI pipeline shape. Backend projects keep TypeScript 6 project
references via `tsconfig.node.json`; frontend projects keep TypeScript 5.9 with
`tsconfig.base.json`. Backend-only Nx plugins are excluded from frontend
projects in `nx.json`. The API listens on :3333 (the staff app uses :3000).

**Follow-ups.** Align on one TypeScript major once Next.js and Storybook are
verified on TypeScript 6; move the frontend drug–allergy demo rule to call the
API; replace `apps/staff/src/lib/data.ts` fixtures with `/api/v1` calls.

## ADR-0009 Patient merge: link, don't move

**Decision.** Merging a duplicate patient record never rewrites what is filed under it. The retired record gets
`status = 'merged'` and `merged_into_patient_id` = the surviving record; merge chains stay flat (a survivor is never
itself merged; re-pointing happens in the merge's transaction and a deferred database check enforces it). Every
patient view reads the survivor's records **and** those of every record merged into it, each row keeping the
`patientId` it was filed under so screens can mark it ("Filed under P…"). An unmerge restores the stored previous
status and clears the link; it is exact because nothing moved. See `docs/domains/patient.md`.

**How domains read linked records.** The Patient Master owns two SQL functions (migration 0068):
`patient_record_ids(id)` (the record and every record merged into it) and `patient_canonical_id(id)` (the survivor a
record is filed as). `libs/core` wraps them as `filedAsPatient(column, patientId)`, `canonicalPatientId(column)` and
`isFiledAs(executor, rowPatientId, patientId)`. Domain libraries call these helpers in their patient-scoped reads
(allergies, clinical summary, prescriptions, laboratory, encounters, vitals, care plans, dental, documents,
notifications, billing views, PhilHealth answers, portal access classes, timeline and workspace queries, reporting
counts); writes keep the single id. No library reads the `patient` table.

**Why a database function rather than a port.** About 120 read sites in a dozen libraries filter by patient. A
TypeScript port (`PatientLinks`) would add a round trip and a constructor dependency to each service, and the link
set would be read outside the query's own snapshot. The function is evaluated inside the same statement (one
snapshot, index-friendly: `col = ANY(patient_record_ids($1))` is a stable, constant-argument expression), keeps
boundaries (the contract is the function, owned and migrated by the Patient Master, not its table) and is trivially
mockable in SQL. Per-domain ports were rejected for the same cost multiplied by each domain.

**Writes to a merged record.** A trigger (`refuse_record_for_merged_patient`, SQLSTATE `PM001`) refuses new care
filed under a merged record in the tables where care starts (appointments, visits, triage, vitals, allergies,
encounters, prescriptions, care plans, laboratory orders, dental records, imported history, PhilHealth answers,
package enrollments); `HttpExceptionFilter` maps it to `422 patient_merged` with the survivor's id. Corrections of
existing records and asynchronous work of earlier events (charges, report archives) are not refused. Blockers (work
in progress under the record to retire) come from the domains through the `PatientMergeContext` port so the merge
cannot strand an open encounter, a queue visit, an upcoming appointment, an active laboratory order, draft billing
or a balance.

**Consequences.** Balances shown for a survivor add the retired record's ledger; applying and refunding use the
record's own ledger (the preview blocks merging a record that still holds a balance). Identifiers stay active on the
retired record, so the survivor cannot hold the same identifier as well. Records created on the survivor after a
merge stay there when it is undone.

## ADR-0010 Infrastructure as code: Railway config-as-code now, Terraform only for what a verified provider covers

**Decision.** The platform's infrastructure code today is Railway **config-as-code**: one `railway.json` per service
(build, pre-deploy migration, start command, health check, restart policy) next to its app. Everything else about an
environment — the project, the Postgres and Redis services, the five app services bound to the repository, each
service's config-as-code path, deploy-on-push turned off, variables and domains — is set in the dashboard by hand and
is listed as a checklist in [railway.md](../deployment/railway.md#what-is-codified-and-what-is-not), so an environment
can be rebuilt or a second one (staging) created step by step. Terraform (named in `CLAUDE.md` §1) is adopted only
after a provider for Railway has been verified outside this repository — its maintainer, licence and which of the
checklist items it manages — and then only for those items, under `infrastructure/terraform/`.

**Secrets.** No secret (`JWT_ACCESS_SECRET`, `MFA_ENCRYPTION_KEY`, integration payload keys, S3, SMTP, VAPID, PayMongo,
LiveKit, Expo) is ever written into a Terraform file, a committed `.tfvars` or state kept in the repository: a module
declares them as sensitive variables supplied at apply time, and state lives in an encrypted remote backend the
organization controls. The choice of backend, whether a community-maintained provider is acceptable in production,
and whether CI holds a Railway token to run `terraform plan` are decisions recorded here when made.

**Why not Terraform now.** Nothing in the repository verifies that a Railway provider exists and covers these items,
and this project's rule is not to assume an integration. Config-as-code already holds the parts that change with
the code; the dashboard parts change rarely, and a checked checklist is a smaller, auditable step than an untested
module. Local development stays Docker Compose (`infrastructure/docker/docker-compose.yml`).
