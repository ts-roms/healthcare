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

## ADR-0010 Infrastructure as code: Railway config-as-code, Terraform for what the verified provider covers

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

**Why not Terraform at first.** Nothing in the repository verified that a Railway provider existed and covered these
items, and this project's rule is not to assume an integration. Config-as-code already holds the parts that change with
the code; the dashboard parts change rarely, and a checked checklist is a smaller, auditable step than an untested
module. Local development stays Docker Compose (`infrastructure/docker/docker-compose.yml`).

**Provider verified and adopted (2026-10-02).** `terraform-community-providers/railway` — community-maintained
(not a Railway product), MPL-2.0, v0.6.2 released April 2026 after v0.6.0 and v0.6.1 in late 2025; resources
`project`, `environment`, `service` (source repository and branch, root directory, `config_path`, regions and
replicas, volumes, cron, images), `variable`, `variable_collection`, `shared_variable`, `custom_domain`,
`service_domain`, `tcp_proxy`; checked from the provider's repository, not the registry, which this container
cannot reach. It covers the project and environment, the five app services bound to the repository with their
`railway.json`, their variables and public domains; it has no resource for the Postgres and Redis templates, for
deploy-on-push, for the first deploy order or the seed. `infrastructure/terraform/railway/` now describes exactly the
covered items (validated against the provider's schema; CI runs `fmt -check` and `validate`, never `plan` or
`apply`); the rest stays the checklist in `railway.md`. Decided with it: the databases stay Railway templates by
hand and reach the services as Railway references; the existing environment is imported by whoever holds the
token, following `docs/runbooks/railway-terraform.md`, not by CI; CI holds no Railway token; the state backend is
declared in an ignored `backend.tf` so the module chooses none. Accepting a community-maintained provider is the
organization's call to revisit if it goes unmaintained — the module touches no data, and `railway.json` stays the
authoritative build and deploy configuration either way.

## ADR-0011 Reporting: figures in their domains, composition in the API, `libs/reporting` only for a second consumer

**Decision.** Reporting has three layers and no library of its own yet. **Figures** are computed by each domain's own
reporting query (`PatientReportingQueries`, `ClinicReportingQueries`, `LabReportingQueries`, `DentalReportingQueries`,
`TelemedicineReportingQueries`, `BillingReportingQueries`) over the shared period helpers in `libs/core`
(`ReportingWindow`, `reportingRange` / `reportingDay` / `reportingFacility`, formula-safe `toCsv`); a domain's figures
never leave its library, as the boundary rules require. **Composition** — range and facility scope, small-cell
suppression (patient counts 1–4 shown as "<5", rates on them withheld), the previous-period comparison, key figures and
their directions, retention, revenue gating, the CSV tables and the metric definitions — lives in the API
(`apps/api/src/app/management-dashboard/`, pure rules in `management-dashboard.rules.ts` with their own tests), because
the management dashboard is its only consumer and one place avoids a second copy of the rules. The other reports
(billing daily report, communication log and export, controlled-items register, laboratory quality summary) stay
with their domains or their API composition the same way.

**When `libs/reporting` is created.** The moment a **second process** must apply the same rules — a worker or another
application that cannot import `apps/api` — the pure rules and definitions move from the API into `libs/reporting`
(`scope:shared`, `type:util`: no database access, no domain imports; it takes figures and returns tables), and both
depend on it. Until then the library stays planned, so that a report sent by email can never disagree with the screen
about what "<5" or "net revenue" means. _Scheduled management reports_ did **not** trigger it: they run in the API
process (`ManagementReportRuns`, like the other scheduled jobs) and call the same `ManagementDashboardService.export`
the screen calls, so there is still one copy of the rules and one consumer
(`docs/architecture/management-dashboard.md`, "Scheduled reports"); the notification worker only delivers the notices. Dashboard features that stay in the API do not trigger it: same period last year, median and percentile
waiting and turnaround times, per-department laboratory figures, inventory and dispensing figures, telemedicine
waiting times, a PDF export.

**Not decided here.** A data warehouse, ETL or an analytics tool (`CLAUDE.md` §38, "advanced analytics") is a separate
decision with its own data-protection questions; nothing in the repository asks for it. See
[management-dashboard.md](management-dashboard.md).

## ADR-0012 Telemetry: OpenTelemetry over OTLP, no backend chosen, no error-tracking SDK

**Status:** accepted (2026-10-02). **Context:** phase 1 of observability (`docs/architecture/observability.md`) gave
the platform JSON logs, an access log, operational `event` names and health probes without any external service, and
left traces, metrics, error tracking and alerting as decisions. The stack (`CLAUDE.md` §1) names OpenTelemetry; the
organization has not chosen a backend, and any backend receives data about requests that can carry patient data.

**Decision.** The processes are instrumented with the OpenTelemetry SDK and export traces and metrics over OTLP/HTTP
**only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set**; the repository names no backend, dashboard or alert rule, and the
alert conditions are a runbook (`docs/runbooks/alerts.md`). Span attributes that can carry a person's data (URLs,
query strings, headers, client addresses, user agents, Redis arguments) are removed by a span processor before export,
and database spans carry no statement text or parameter values, so the rule is enforced in code rather than by the
backend's configuration. No error-tracking SDK is added: exceptions reach the trace backend as span status and events
under the same scrubbing; a dedicated error-tracking service would receive stack traces and request context, which is a
data-processing decision (compliance register, "Hosting and data protection") before any is adopted. Logs are not
exported through OpenTelemetry: the hosting provider's log stream remains the record, with `traceId` on each access-log
and unhandled-error line to join the two.

**Consequences.** Nothing changes for a deployment that sets no endpoint. Instrumentation depends on the webpack build
leaving `node_modules` external (it does; a build that bundled `pg`, `ioredis`, `express` or `@nestjs/core` would
silently stop it, which the `telemetry.started` line makes visible). Choosing a backend adds its endpoint, credentials
and alert rules to the deployment, not code. Revisit if the organization adopts an error-tracking service (scrubbing
rules and a DPA first) or if OTLP logs become the preferred log path.

## ADR-0013 Offline: capture and replay through the live routes, human-reviewed, never merged

**Status:** accepted (2026-10-02). **Context:** `CLAUDE.md` §30 asks for eventual offline support (registration,
queue, vitals, selected documentation, printing, local encrypted temporary storage, sync after reconnect) and forbids
unsafe synchronization. The staff app calls the API only from its server, tokens never reach browser JavaScript, and
nothing is cached in the browser; the API already makes unsafe requests retry-safe with an `Idempotency-Key`
(`IdempotencyInterceptor`: the stored response replays for 24 hours, the same key with another body is refused).

**Decision.** Offline is a **queue of captured actions**, not a copy of the record. Phase 1 captures three actions on
one page (`/offline`): register a patient, check a walk-in into the queue, record triage with vital signs. Nothing
with server-side decision support or immutability rules is captured offline: prescribing, signing notes, results,
billing, consents. Replay goes through the **same server actions the live screens use**, in capture order, each
action carrying its own idempotency key (the action id), so the session cookie, permissions, audit, duplicate
detection and every validation apply unchanged and a dropped connection mid-replay is safe to retry. Chaining: a
walk-in for a patient registered offline waits for that registration's replay to return the id; vital signs for an
offline walk-in wait for its visit id. Whatever the API refuses — a possible duplicate, an unknown patient number,
a closed visit, a validation error — is **parked** with the reason for a person to resolve on the live screen; the
app never merges, overrides or retries a refusal on its own, and anything that waited on a parked action is parked
with it. Server state always wins. Captured actions live in IndexedDB encrypted with a key that exists for the
browser session only (sessionStorage), so a closed tab discards what was not sent, and the page says so; no patient
list, clinical data or credential is stored. A service worker keeps the Offline page and the app's static files
reachable without a connection; the page shows the queue, visit types and practitioners **as of its last load with a
connection**, labelled with that time. Everything else in the app stays online-only.

**Consequences.** The feature is only as current as the last online load of the Offline page and only as durable as
the browser tab; both are deliberate for phase 1 and documented in the manual. Later decisions, each its own: a
staff-chosen offline PIN so the outbox survives a closed tab; more captured actions (appointments, documentation);
the mobile app (D10 stays as is). Printing stays online (every PDF is rendered by the API). Patient data held
briefly in a browser on a shared computer is a data-protection matter recorded in the compliance register.

## ADR-0014 Service points: one visit, one queue line at a time, routed after triage

**Status:** accepted (2026-10-20). **Context:** the queue was one line per facility (`visit`: waiting → in triage →
awaiting consultation → in consultation → completed). The platform is run for LGU hospitals whose outpatient
department sends a triaged patient to the consultation line, the emergency room, X-ray or another station, and the
nurse had no way to say where. `CLAUDE.md` listed service-point queues as not built, and the waiting-room display
(0112) shows only the ticket and the place typed at the call.

**Decision.** A service point is a **queue line of a facility**, defined by the organization (`service_point`, 0113:
code, name, kind `consultation` | `emergency` | `imaging` | `other`, status) — never a national list, triage scale
or emergency-care rule. A visit is at most at **one** service point (`visit.service_point_id`) and moves between them
through an **append-only** `visit_routing` history (from, to, who, reason, when) written in the same transaction as
the move, audited and published as `VisitRouted` (ids only). `null` keeps its old meaning — the facility's single
consultation line — so every earlier visit, the dashboard, the timeline and the display keep working and an
organization that sets nothing up sees no change. Routing is a step of triage (the nurse chooses **Send to** when
completing it; one transaction with the assessment, the vitals and the status change) and a command on the queue board
(`POST /queue/visits/:id/route`, `clinic.queue.manage`), allowed only from `in_triage` and `awaiting_consultation`:
a patient is triaged before being sent anywhere, a patient with the provider is not moved, a closed visit is history.
The queue of a service point is the facility queue filtered to it in the same service order (priority, then
arrival): the status machine, the ticket series and the one-active-visit-per-patient rule are unchanged, and
`GET /queue` filters by `servicePointId` rather than growing a second queue model. Kinds are labels for the staff
app, not behaviour: an `imaging` service point is where a patient waits, not an imaging order.

**Alternatives rejected.** A service point as a status of the visit (the status machine would multiply with every
station and a visit at X-ray awaiting consultation would need two states); routing on check-in (the desk would decide
what triage should); a visit per station (two active visits per patient, two tickets, two histories for one
arrival); showing the service point on the waiting-room display (a patient's destination says something about
their condition; the display keeps ticket and place only).

**Consequences.** Imaging orders and a radiology worklist, triage scales, beds and observation, a ticket series per
service point, kiosks and routing at check-in are separate decisions. Who may send a patient to the emergency room,
and under what criteria, is the organization's policy (compliance register). Billing, laboratory and dental read
nothing new; the timeline's queue entries are unchanged.

## ADR-0015 Patient self-service kiosk: a restricted staff account, short sessions, staged registrations

**Status:** accepted (2026-11-03). **Context:** reception is the bottleneck on busy mornings. The brief (`docs/kiosk/`)
asked for a touchscreen kiosk, a staged new-patient registration and a thermal ticket, and proposed sixteen new queue
tables. The platform already has the queue (`visit`, one atomic ticket counter per facility and day, one active visit
per patient), service points, the waiting-room display, appointment check-in and patient registration with duplicate
review; a second queue model would have duplicated all of it.

**Decision.** Reuse the queue and add only what is new (migration 0137): **devices**, **sessions** and **staged
registrations**. A kiosk is a **staff account holding only the `kiosk_device` role** (`kiosk.session.use`, no patient
permission; the pattern of the waiting-room display, migration 0112), registered as a `kiosk_device` of one facility.
The device's identity is its sign-in; the code in its address only routes the page. Registration refuses an account
that holds `patient.read`. A person at the kiosk is served in a **`kiosk_session`**: an opaque token (hash stored) bound
to the device, ended by the person, after two idle minutes, at fifteen in all, or at the third failed identification.
Identification (`PatientIdentityService` in the patient domain) needs a patient or mobile number, the exact date of
birth and the given name to agree on one active patient, answers every miss alike, shows initials only, and is counted
before it is answered. **Check-in** goes through the clinic's own visit code (`VisitService.kioskWalkIn` /
`kioskCheckInAppointment`, origin `visit.checked_in_via = 'kiosk'`, no staff user), so the ticket counter and the
one-active-visit rule are the existing ones. Which services a kiosk offers is the organization's choice
(`visit_type.kiosk_enabled`). A **new patient never becomes a patient on their own**: the typed registration is sealed
with the integration key ring in `kiosk_registration`, listed to reception without personal data, and approved through
the ordinary registration (duplicate rules intact), linked to an existing patient, or rejected; the sealed content is
erased on any decision and after 24 hours. The orchestration lives in the API (`apps/api/src/app/kiosk`, own tables as
ADR-0011): it spans patient and clinic, which may not import each other.

**Also added.** `POST /queue/visits/:id/skip` for a called patient who did not come forward: the call is withdrawn and
the visit goes back behind later arrivals of the same priority (`visit.queued_at`; arrival time unchanged), at most
three times (`MAX_SKIPS`), then staff close the visit.

**Alternatives rejected.** A `queue_ticket` family of tables (duplicates `visit`); a kiosk-specific token issuer (a
second authentication system; the staff sign-in already has lockout, rotation and audit); letting the kiosk create
patients directly (a public screen would write the Patient Master); a patient lookup returning the record for the
screen to confirm (an enumeration oracle).

**Consequences.** Not built in this decision: the kiosk web app, the print agent and print queue, the public display's
department grouping, counters, and "requeue" of a closed visit (reopening a closed visit is a clinical-record
decision). Hardware is verified only on the target devices. The privacy notice text and what a kiosk may collect are
the organization's (compliance register).

## ADR-0016 Migrations run by a one-off service that alone holds the owner's database URL

**Status:** proposed (2026-11-07; zero-trust audit D2, `docs/security/zero-trust-audit-2026-11-06.md`). **Context:** the
API's Railway service runs `pnpm db:migrate` as its pre-deploy command, so the owner's URL (`MIGRATION_DATABASE_URL`)
is one of the API service's variables. Railway gives a service's variables to its pre-deploy command and to the running
process alike: code execution in the API container can read the owner's credentials (the API deletes the variable from
`process.env` at start-up, but `/proc/self/environ` still holds it) and with them alter or drop tables, disable the
append-only triggers and row-level security, and rewrite the audit trail.

**Decision (proposed).** A seventh Railway service, `migrate`, built from the same repository with its own
`railway.json`: start command `pnpm db:migrate`, restart policy `NEVER`, no public or private domain, and the only
service holding `MIGRATION_DATABASE_URL`. The API and both workers hold only the restricted role's `DATABASE_URL`.
Order is kept by the code, not the platform: on start the API reads `schema_migration` and refuses to serve (readiness
`503`, `db.schema_behind`) while a migration file it ships is not yet applied, so a deploy that races ahead of
`migrate` waits instead of running against the old schema. Terraform declares `migrate` with `railway.json`; deploy
order in the runbook becomes `migrate`, then the API and workers.

**Alternatives rejected.** Keeping the pre-deploy step and scrubbing the environment (the container's environment
cannot be scrubbed); a CI job that migrates over a public TCP proxy (exposes the database and puts the owner's URL in
CI, which holds no Railway credential today); migrating on API start as the owner (the same exposure, plus every
replica racing).

**Consequences.** One more service to deploy; a deploy is two steps; the API needs the schema check. Until this is
built the exposure is documented in `docs/runbooks/database-roles.md` ("The owner's URL at runtime").

## ADR-0017 Platform scope that SQL running as the application role cannot claim

**Status:** proposed (2026-11-07; zero-trust audit D5). **Context:** row-level security (migration 0111) trusts
`current_setting('app.scope') = 'all'`. Any session of the application role may set a custom setting, so SQL that runs
as that role (an injection, a compromised dependency) can call `set_config('app.scope', 'all', false)` and read every
organization. The policies stop mistakes in the application's own filters; they do not stop SQL-level compromise.

**Decision (proposed).** Make the platform scope a role, not a setting: a second group role `healthcare_platform`
(member of `healthcare_app`, plus a policy clause `pg_has_role(current_user, 'healthcare_platform', 'MEMBER')`), and the
login role `healthcare_api` a member of `healthcare_app` only, with `healthcare_platform` granted `WITH SET` to it (PG 16
role options) so `ContextPool` takes it by `SET ROLE healthcare_platform` for `asPlatform(…)` work and `RESET ROLE`
after. The organization stays a setting (`app.organization_id`), but `rls_organization_visible` checks it only for a
connection that is not in the platform role, and a new trigger-free check refuses `app.scope` altogether. SQL that runs
as `healthcare_api` can still `SET ROLE healthcare_platform`; to close that, `asPlatform` work moves to a separate pool
whose login role is the platform one (`DATABASE_PLATFORM_URL`), and the request pool's role holds no path to it.

**Alternatives rejected.** Signing the setting with an HMAC checked in a `SECURITY DEFINER` function (the key would sit
in the same process that is assumed compromised); dropping the platform scope (schedulers, the outbox relay and the
workers act across organizations by design).

**Consequences.** Two pools and two login roles (the platform pool small); every `asPlatform` call site keeps working
unchanged; integration tests run both roles. Built only after ADR-0016 (it changes the same deployment variables).
