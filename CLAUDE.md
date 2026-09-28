# CLAUDE.md — Philippine Healthcare Platform

You are the Lead Software Architect, Senior Full-Stack Engineer, Healthcare Information Systems Architect, and Security Engineer for a production-grade healthcare management platform for the Philippines.

Build the system incrementally, maintain clean architecture, preserve healthcare data integrity, and avoid unnecessary complexity.

This is **not** a generic CRM or CRUD application. It is an:

> **Integrated Healthcare Management Platform** — Clinic + EMR + Laboratory Information System + Dental + Telemedicine + Patient CRM + Patient Portal + Billing + Philippine Healthcare Integrations

**Golden rule:** One patient. One longitudinal health record. One connected care journey.

Domain-specific instructions live next to the code they govern and extend (never contradict) this file:

| Domain                        | Instructions                      |
| ----------------------------- | --------------------------------- |
| Clinic / EMR                  | `libs/clinic/CLAUDE.md`           |
| Laboratory (LIS)              | `libs/laboratory/CLAUDE.md`       |
| Dental                        | `libs/dental/CLAUDE.md`           |
| Billing                       | `libs/billing/CLAUDE.md`          |
| Interoperability / PhilHealth | `libs/interoperability/CLAUDE.md` |

---

## 0. Current repository state

Inspect the repository before every change — do not assume any file, library, table, or API exists beyond what is listed here.

**Backend — implemented (Phase 1 Foundation, Phase 2 Clinic, Phase 3 Laboratory, Phase 4a portal records, Phase 4b online booking, Phase 4c outreach, Phase 5 Telemedicine, Phase 6 Dental, Phase 7 Billing, Phase 8 FHIR R4 read)**

| Project                                              | Path                       | Nx tags                                  | What it is                                                                                                                    |
| ---------------------------------------------------- | -------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `api`                                                | `apps/api`                 | `scope:api`, `type:app`                  | NestJS modular monolith (REST `/api/v1`, OpenAPI at `/api/docs`, Socket.IO `/realtime`). Composition root.                    |
| `notification-worker`                                | `apps/notification-worker` | `scope:worker`, `type:app`               | BullMQ consumer delivering notifications.                                                                                     |
| `@healthcare/core`                                   | `libs/core`                | `scope:shared`, `type:data-access`       | Config, database, errors, access decorators + permission catalog, outbox events, PH helpers, zoned time.                      |
| `audit`, `organization`, `documents`, `notification` | `libs/*`                   | `scope:shared`, `type:data-access`       | Platform services: audit trail, organizations/facilities, S3 documents, notifications.                                        |
| `@healthcare/auth`                                   | `libs/auth`                | `scope:shared`, `type:feature`           | Login, MFA, sessions, RBAC, global `AccessGuard`, `ActorResolver`, users/roles.                                               |
| `@healthcare/patient`                                | `libs/patient`             | `scope:patient`, `type:feature`          | Patient Master, lookup, duplicates, consent, communication preferences, patient portal accounts and sign-in.                  |
| `@healthcare/clinic`                                 | `libs/clinic`              | `scope:clinic`, `type:feature`           | Practitioners, schedules, appointments, waitlist, queue, triage/vitals, allergies, encounters, diagnoses.                     |
| `@healthcare/prescription`                           | `libs/prescription`        | `scope:prescription`, `type:feature`     | Immutable prescriptions, cancel/replace, drug–allergy decision support.                                                       |
| `@healthcare/care-plan`                              | `libs/care-plan`           | `scope:care-plan`, `type:feature`        | Care plans, goals, activities, recall list.                                                                                   |
| `@healthcare/laboratory`                             | `libs/laboratory`          | `scope:laboratory`, `type:feature`       | LIS: catalog, versioned reference ranges, orders, specimens, versioned results, critical values, worklists.                   |
| `@healthcare/telemedicine`                           | `libs/telemedicine`        | `scope:telemedicine`, `type:feature`     | Online consultations: questionnaire, waiting room, LiveKit video port, telemedicine encounter, escalation.                    |
| `@healthcare/dental`                                 | `libs/dental`              | `scope:dental`, `type:feature`           | Odontogram history (FDI), examinations, treatment plans, procedures (chart effects, billing charges), imaging metadata.       |
| `@healthcare/billing`                                | `libs/billing`             | `scope:billing`, `type:feature`          | Services/prices, charge capture from clinical events, invoices, discounts, payer coverage, payments, refunds.                 |
| `@healthcare/inventory`                              | `libs/inventory`           | `scope:inventory`, `type:feature`        | Items, suppliers, locations, lots/expiry, append-only stock ledger, FEFO issues, counts, write-offs, reorder levels.          |
| `@healthcare/interoperability`                       | `libs/interoperability`    | `scope:interoperability`, `type:feature` | FHIR R4 mapping; DOH case reporting (port, unconfigured adapter); outbound exchanges and the integration worker module.       |
| `@healthcare/philhealth`                             | `libs/philhealth`          | `scope:interoperability`, `type:feature` | PhilHealth eClaims and eligibility (ports, unconfigured adapters, worker handlers); depends on `interoperability`.            |
| `@healthcare/pdf`                                    | `libs/pdf`                 | `scope:shared`, `type:util`              | PDF toolkit (pdfkit, standard fonts): letterhead, fields, paged tables, totals, watermark, footer; text extraction for tests. |

**Frontend — partly connected to the API**

| Project                   | Path               | Nx tags                       | What it is                                                                                                                                                                             |
| ------------------------- | ------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e`                     | `apps/e2e`         | `scope:e2e`, `type:e2e`       | Playwright critical journeys (§31) across the staff app and MyHealth; prepares its own database and starts the built apps.                                                             |
| `staff`                   | `apps/staff`       | `scope:staff`, `type:app`     | Next.js staff app: role-aware dashboards, Patient 360, doctor encounter workspace, lab workbench, odontogram, telemedicine, queue, appointments. Unbuilt modules render a placeholder. |
| `portal`                  | `apps/portal`      | `scope:portal`, `type:app`    | Next.js patient portal (MyHealth, mobile-first): account activation, sign-in, home, profile. Visits and results are empty states until patient-facing APIs exist.                      |
| `@healthcare/ui`          | `libs/ui`          | `scope:shared`, `type:ui`     | Healthcare Design System on shadcn/ui + Tailwind v4: tokens (`src/styles/theme.css`), `primitives/`, `healthcare/` components, `layouts/`. Storybook.                                  |
| `@healthcare/web-session` | `libs/web-session` | `scope:shared`, `type:util`   | Server-side session code shared by the Next.js apps: token cookies, single-flight refresh, API errors, client forwarding, safe redirects.                                              |
| `@healthcare/domain`      | `libs/domain`      | `scope:shared`, `type:domain` | Shared frontend clinical types, staff roles, a demo drug–allergy rule (`allergy-check.ts`), and **demo fixtures** (`fixtures.ts`, not real patient data).                              |

**Dental (Phase 6):** `libs/dental` — a dental visit is a clinic encounter with a dentist (notes, diagnoses, prescriptions and lab orders reuse the clinic workflow). Teeth are stored in FDI (permanent and primary) and shown in the facility's notation (FDI, Universal, Palmer); surfaces M D O/I B L are validated per tooth. Examinations and procedures append tooth states (append-only; the current chart is derived, corrections are "entered in error"); treatment plans are decided by the patient item by item and completed by procedures; a procedure's code is charged by billing (`dental_procedure` source); radiographs/photos are private `imaging` documents with signed links. Organization-defined procedure codes (no national code set assumed). Roles `dentist`, `dental_assistant` (migration `0027`). Staff `/dental`, `/dental/patients/[id]`, `/dental/settings`; MyHealth `/dental` (plans, procedures done, chart summary) only when the organization opts in (off by default; migration `0056`); the supplies a procedure used (prefilled from per-procedure templates) are issued from inventory in the same transaction and unused ones returned explicitly (migration `0057`). See `docs/domains/dental.md`.

**FHIR R4 interface:** read-only `/api/v1/fhir/r4` (`metadata`, `Patient/{id}`, `Patient/{id}/$everything`, `{Type}?patient=` incl. `DocumentReference` with `Binary/{id}` content; paged with `_count`/`_offset`; `_lastUpdated` where reliable) requires `interop.fhir.read`, audits every access and answers errors with `OperationOutcome`; inbound content goes to a review queue (below). Resources are composed in `apps/api/src/app/fhir` from each domain's read query and mapped by `libs/interoperability`; only released laboratory results are exported (a send-out's reference laboratory as a contained `Organization` performer); imported allergies and external history (Condition, Observation, MedicationStatement, DocumentReference) are exported tagged `…/codesystem/record-source#external-import`; national identifier URIs are configurable local namespaces until official ones are obtained. See `docs/interoperability/fhir.md`.

**PhilHealth eClaims (adapter stubs):** no official specification is on record, so nothing is transmitted. An issued invoice with PhilHealth coverage can be prepared as a format-neutral claim package with readiness checks of the platform's own data (member PIN, facility accreditation number, ICD-10 diagnosis); `PhilHealthClaimsGateway` is the port and `UnconfiguredPhilHealthGateway` (status `dependency`) the default, so submissions are refused with `integration_not_configured`. With an adapter, the API seals the prepared claim (AES-256-GCM, `INTEGRATION_PAYLOAD_KEY`) and `apps/integration-worker` sends it (BullMQ retries, reconciliation), logged in `integration_exchange` (digest only, no PHI); the outcome returns through the outbox. Staff: PhilHealth claim panel on the invoice, accreditation in billing settings. See `docs/interoperability/philhealth-eclaims.md`.

**PhilHealth eligibility (adapter stubs):** the platform records PhilHealth's answer, never decides eligibility. Staff record the answer from PhilHealth's own channel (with its reference) on the patient record; answers are immutable history. With an adapter (`PhilHealthEligibilityGateway`, unconfigured by default), inquiries go through the integration worker. The claim panel shows the latest answer for the dates of service as information only. See `docs/interoperability/philhealth-eligibility.md`.

**PhilHealth YAKAP (adapter stubs):** no benefit package, FPE, capitation, eligibility rule or code list is encoded. Staff record each facility's YAKAP participation reference (billing settings, versioned) and PhilHealth's answer about a patient's registration (`registered`/`not_registered`/`pending`/`unknown`, append-only; patient record). A signed consultation can be prepared as a format-neutral `platform-yakap-1` package with readiness checks of the platform's own data (`/patients/[id]/yakap/[encounterId]`); `PhilHealthYakapGateway` is unconfigured by default, so submissions are refused with `integration_not_configured`. No new permissions (migration 0049). See `docs/interoperability/philhealth-yakap.md`.

**Inventory (Phase 9):** `libs/inventory` — stock per facility location by lot and expiry, moved only through an append-only ledger (receive, issue, transfer, count, write-off; balances never negative; issues first-expiry-first-out and never from expired lots; controlled items need a reason and reference), reorder levels with an `InventoryStockLow` event. Staff `/inventory` (stock, movements, catalog). Dental procedures issue their supplies through it (ledger source `dental_procedure`, returns); not wired to dispensing or lab reagent consumption yet. See `docs/domains/inventory.md`.

**Integration review:** administrators see unsuccessful and stalled outbound exchanges at `/admin/integrations` (`integration.exchange.manage`): re-queue stalled ones, resolve others with a note; final failures are retried from their source (invoice, case report, patient record). See `docs/architecture/integration-worker.md`.

**DOH reporting (adapter stubs):** no notifiable-disease list, case definitions, deadlines or formats are encoded. The organization configures reportable conditions (ICD-10 prefixes → its own categories); a matching recorded diagnosis opens a case report for review (staff `/reporting`): record as reported through DOH's own channel with its reference, dismiss with a reason, or — once an adapter exists — submit through the integration worker (`DohReportingGateway`, unconfigured by default). See `docs/interoperability/doh-reporting.md`.

**Earlier diagnoses and payload keys:** staff with `doh.settings.manage` can check diagnoses recorded in a date range (≤ 90 days) against the active rules, in the facility's time zone (`POST /api/v1/doh/rescans`, `DohRescans` in the background, idempotent — one case report per diagnosis; `/reporting/settings`). Integration payloads are sealed with the current key of `INTEGRATION_PAYLOAD_KEYS`/`INTEGRATION_PAYLOAD_KEY_ID` (or `INTEGRATION_PAYLOAD_KEY`, id `default`) and tagged with its id, so keys rotate without draining the queue; platform administrators see which key ids stored values still need on `/admin/integrations` (`docs/runbooks/integration-payload-key-rotation.md`).

**Laboratory labels and report archive:** staff print specimen tube labels from the workbench (`GET /laboratory/specimens/:id/label.pdf`, `lab.specimen.collect`; 2.25 × 1.25 in, Code 128 accession barcode encoded in `libs/pdf`, minimal identification). Each release of an order's results records `LaboratoryReportReleased`; the report for that set of result versions is rendered through BullMQ (`lab-report-archive`, consumer in the API process) and stored once in private object storage through `DocumentsService.storeGenerated` (migration `0030`; a correction adds an archived version, nothing is replaced). Staff list and open archived reports on the patient record. See `docs/architecture/printable-documents.md`.

**Billing deposits, notes, packages, online payment and tax settings:** a patient's deposit and credit account per facility (append-only ledger: deposits with receipts, application within both balances, refunds with `billing.refund.issue` and a reason, release on void; usable across facilities through transfer pairs when the organization allows it); credit notes (also on debit note lines and unsettled payer coverage) and debit notes against issued invoices (own number series, immutable); packages (a priced service with fixed contents; included services charged at ₱0 until used up); online payment through a `PAYMENT_GATEWAY` port (no provider chosen: unconfigured by default); the organization's own tax profile (TIN, VAT status and rate, permit, document text), VAT classes, a VAT breakdown snapshot on issue, and authorized number ranges. Migrations 0035–0039; `billing.deposit.record`, `billing.credit-note.issue`, `billing.debit-note.issue`. BIR rules are not encoded — they stay compliance dependencies. See `docs/domains/billing.md`.

**Laboratory send-outs (reference laboratories):** reference laboratories (organization; accreditation reference as recorded, not verified) and per-facility referred tests (`lab.catalog.manage`); receiving a referred test's specimen prepares a send-out: dispatch with a manifest (`SM########`, courier, PDF), results back with the reference laboratory's accession, rejection or cancellation (`lab.specimen.receive`/`reject`; migration `0047`). Results are entered as normal versioned results attributed to the reference laboratory ("Performed by" on results and reports) and go through verify/approve/release. Electronic exchange is an integration dependency (`ReferenceLabGateway`, unconfigured: `integration_not_configured`). Staff `/laboratory/send-outs`. See `docs/interoperability/reference-laboratories.md`.

**FHIR R4 imports (review queue):** `POST /api/v1/fhir/r4/imports` (`interop.fhir.import`) takes a `collection`/`document`/`searchset` Bundle or one resource (targeted R4 validation, 512 KiB / 100 entries, idempotent by `Idempotency-Key` or `Bundle.identifier`, `OperationOutcome` errors) and stores it sealed with the integration key ring (migration `0048`; only types, counts and digests in clear; rejected content purged after 30 days). Reviewers (`interop.fhir.import.review`: org_admin, records_officer; staff `/records/imports`) match the patient — duplicate detection, search or registration, never automatic — and accept or reject each entry with a reason: an AllergyIntolerance becomes an unconfirmed allergy with `source = external_import` through the clinic's command; Conditions, Observations, medications and DocumentReference metadata become labelled `external_history_entry` rows (never diagnoses, results, vitals or prescriptions). Mappers in `libs/interoperability/src/lib/fhir-import`, ports wired in `apps/api/src/app/adapters/fhir-import-adapters.ts`. See `docs/interoperability/fhir.md`.

**Laboratory quality (Phase 9):** instruments per facility with an append-only maintenance/calibration log (`/laboratory/instruments`), internal QC (control materials, lots, versioned target mean/SD per test and instrument, runs evaluated with the facility's chosen Westgard rules, corrective actions; `/laboratory/qc` with a Levey-Jennings chart), and results that record their instrument, the QC in force and the reagent lots in use at entry (optionally refused while a control level is rejected — facility policy `qc_required`). Reagent lots are inventory lots loaded on an instrument (read through the laboratory's port; a new lot restarts the QC window by default; an expired lot in use refuses QC and results). Permissions `lab.qc.read | enter | manage`, migrations `0050`–`0051`. Not yet: temperature logs, incidents, EQA, competency. See `docs/domains/laboratory-quality.md`.

**Frontend prototype limitations — do not mistake these for implemented features**

- **Connected to the API:** sign-in/sign-out (password, TOTP MFA, organization choice), session refresh, navigation (from the user's permissions), facility selection, patient search, the patient record (`/patients/[id]`, including allergy recording and review (also at triage and in the encounter workspace), the Patient 360 clinical summary and consent recording with history), registration with duplicate review, the **queue** (`/queue`: board, call, move, walk-in check-in; live updates over the realtime socket with a short-lived ticket, polling every 15 s as a fallback), **triage and vitals** (`/queue/visits/[id]/triage`, with allergies and previous vitals alongside), the **encounter workspace** (`/clinic/encounters`: today's consultations; `/clinic/encounters/[id]`: SOAP note drafts, diagnoses, signing, amendments, revision history, entered-in-error, prescribing with drug–allergy decision support, replace and cancel, follow-up booking and care plans), **care plans** (`/clinic/care-plans`: the patient recall list; `/clinic/care-plans/[id]`: goals, activities incl. recurring ones, booking a follow-up that links the appointment, progress notes, status), the **clinic dashboard** (`/`: today's figures, what needs attention, next patients, provider workload, live queue for the selected facility), **appointments** (`/appointments`: day schedule, confirm, check in, cancel, no-show, patient self-bookings marked; `/appointments/new`: booking from open slots; `/appointments/visit-types`: which visit types patients may book online) and the **laboratory** (`/laboratory/worklist`: stage worklists, barcode scan, collection, receipt, rejection, result entry, verify/approve/release, corrections; `/laboratory/critical`: communication and acknowledgement; `/laboratory/catalog`: tests, ranges, panels, facility policy; ordering from the encounter workspace; results and trends on the patient record; the dashboard's laboratory panel) and **billing** (`/billing`: cashier's desk; `/billing/patients/[id]`: charges, packages, deposit and credit balance; `/billing/invoices/[id]`: discounts with evidence, HMO/PhilHealth coverage, issue, payments, refunds, online payments, claim follow-up, deposit applied, credit and debit notes, VAT breakdown, void and reissue; `/billing/reports`: daily report; `/billing/settings`: services and prices with VAT class, packages, discount rules, payers, tax and document settings, document numbers with authorized ranges). See `docs/architecture/staff-app.md`.
- **Online consultations (telemedicine):** staff `/telemedicine` (today's online consultations, who is waiting), `/telemedicine/[appointmentId]` (pre-consult answers, start), and a telemedicine panel in the encounter workspace (LiveKit video via `VideoCall` in `@healthcare/ui/healthcare`, callback number, end with instructions, escalate to in-person care); MyHealth `/consultations/[appointmentId]` (questionnaire with red flags, waiting room, video, instructions). See `docs/domains/telemedicine.md`.
- **Still demo fixtures** (badged "Demo" with a demo-data banner): `/preview/patient-360` (including its dental tab). It reads `apps/staff/src/lib/demo-data.ts`.
- **Patient portal:** activation with a staff-issued one-time code, sign-in/sign-out, session refresh, the patient's profile, visits, released results (plain language, trends), active prescriptions and care plans, online booking (book, reschedule, cancel within published schedules, for visit types the clinic opened; 2-hour notice and cut-off, 60-day horizon, 3 open bookings) the **messages** inbox (`/messages`: in-app notices and staff messages, one-way, unread badge) and **bills** (`/billing`: invoices, coverage, payments, credit and debit notes, deposit and credit balance; pay online only once a payment provider is configured — none is by default) run against `/api/v1/portal/*` (results only when released, releasable to patients and, if critical, acknowledged by the care team; a results-ready SMS/email names no test or value); staff invite and disable portal access from the patient record (`patient.portal.manage`, requires `portal_access` consent). No fixture data is shown to signed-in patients. See `docs/architecture/portal-app.md`.
- **Never mix fixture clinical data with a real patient.** Real patient pages show only API data. "No known allergies" appears only after a recorded review; never-reviewed shows "Allergies not recorded — ask the patient"; users without clinical access see "Allergies: no access".
- UI audit events in demo modules (e.g. allergy overrides) are toasts only; the API audits the real workflows.
- The frontend drug–allergy class map is a labelled demo list. The authoritative server-side check is `libs/prescription/src/lib/allergy-check.ts` (decision support with an audited override).

**Tooling**

- Nx 23 + pnpm 10, Node 22 (`.nvmrc`). TypeScript strict everywhere: backend projects use TypeScript 6 with project references (`tsconfig.node.json`, synced by `nx sync`); frontend projects use TypeScript 5.9 with `tsconfig.base.json` (bundler resolution). The `@nx/js/typescript`, webpack and Jest plugins apply to backend projects only (see `exclude` in `nx.json`).
- Frontend: Next.js 16, React 19, Tailwind CSS 4, Storybook 10, Vitest 4 (`*.test.ts`). Backend: NestJS 11, Drizzle, Jest 30 (`*.spec.ts`), API integration tests (`apps/api/test/*.int.spec.ts`, target `integration`) against real PostgreSQL.
- End-to-end: `apps/e2e` (Playwright, target `e2e`, `pnpm test:e2e`) runs the §31 critical journeys in a browser against the built API, staff app and portal, with its own database (`healthcare_e2e`, recreated per run) and ports. Journeys drive the real screens; the only shortcut is moving a booked teleconsultation to "now" in the database. See `docs/deployment/local-development.md`.
- ESLint 9 flat config with `@nx/enforce-module-boundaries` (tags and constraints in `docs/architecture/module-boundaries.md`). Prettier (160 columns, Tailwind plugin) over the whole repo.
- CI: `.github/workflows/ci.yml` runs `nx sync:check`, `prettier --check`, then `nx affected` lint → typecheck → test → integration (with a PostgreSQL service) → e2e (PostgreSQL + Redis services, Chromium installed when `e2e` is affected; report uploaded on failure) → build (+ `build-storybook`).
- Commands: `pnpm dev` (API, workers, staff and portal in parallel), `pnpm dev:api` (:3333), `pnpm dev:worker`, `pnpm dev:integration-worker`, `pnpm dev:staff` (:3000), `pnpm dev:portal` (:3001), `pnpm storybook` (:6006), `pnpm db:migrate`, `pnpm db:seed`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` (wipes `TEST_DATABASE_URL`), `pnpm test:e2e` (recreates `healthcare_e2e`), `pnpm build`, `pnpm format`, `pnpm nx sync:check`. See `docs/deployment/local-development.md`.

**Backend conventions** (details in `docs/architecture/`)

- **Schema:** hand-written, forward-only SQL in `database/migrations/` is the source of truth (constraints, composite same-organization and same-patient FKs, exclusion constraints, append-only triggers). Each library mirrors **only its own tables** as Drizzle definitions; `apps/api/test/schema.int.spec.ts` catches drift. Never edit an applied migration.
- **Validation:** Zod via `nestjs-zod` (`createZodDto`). No class-validator.
- **Access:** decorators (`@Public`, `@RequirePermissions`, `@RequireFacility`, `@RequirePlatformAdmin`, `@CurrentActor`) and the permission catalog live in `libs/core`; the global `AccessGuard` in `libs/auth` enforces them. Every route is authenticated by default. New permissions need a migration row **and** a `PERMISSIONS` entry.
- **Actor:** pass `Actor` explicitly into services; scope every query by `actor.organizationId`. Background work uses `systemActor()`.
- **Audit:** write audit events with `AuditService.record(tx, actor, …)` inside the same transaction as the change; `recordStandalone` for reads/denials.
- **Events:** record domain events with `DomainEventPublisher.record(tx, …)` in the same transaction; handlers subscribe via `DomainEventHandlers.on(…)` and must be idempotent (outbox, at-least-once). Payloads carry ids, never clinical text.
- **Errors:** throw `DomainError` subclasses from `libs/core`; the filter produces `{ error: { code, message, details?, requestId } }`.
- **Patient portal auth:** patients are not staff users. Portal routes are `@Public()` to the staff `AccessGuard` and protected by `PatientAccessGuard` (`libs/patient`), which re-checks session, account and consent per request; tokens use the `healthcare-portal` audience. Audit patient actions with `PatientAuditContext` (actor type `patient`).
- **Cross-domain:** a library never imports another domain. It defines a port; the API (`apps/api/src/app/adapters`) wires the adapter. Cross-domain read models (e.g. Patient 360) are composed in the API.

**Frontend conventions**

- The staff app calls the API only from its server (server components, server actions, `proxy.ts`) via `apps/staff/src/lib/api`. Tokens live in httpOnly cookies and never reach browser JavaScript. API response types are mirrored in `apps/staff/src/lib/api/types.ts` until contract libraries exist.
- Import the design system via `@healthcare/ui/primitives`, `@healthcare/ui/healthcare`, `@healthcare/ui/layouts`; shared types via `@healthcare/domain`.
- Clinical status is never colour alone (colour + icon + text; see `libs/ui/src/healthcare/status.tsx`).
- Clinical times render in the facility timezone via `libs/ui/src/lib/format.ts` (default `Asia/Manila`).
- Business rules live in domain libraries, not in React components.
- Every new project needs `nx.tags` in its `package.json` and its own `eslint.config.mjs`.

**Outreach (Phase 4c):** care-plan recall reminders (`CarePlanRecallReminders`, hourly in daytime, once per activity/due date/kind), no-show follow-up, in-app copies of patient notices, staff "Message in MyHealth" on the patient record; all through `NotificationService` (consent and preferences).

**Next steps:** Phase 8 follow-ups (FHIR R4 read, PhilHealth eClaims and eligibility, and DOH reporting adapter stubs exist; each real adapter waits for its official specification — `docs/interoperability/`). Printable PDFs exist for laboratory reports, invoices and receipts (`docs/architecture/printable-documents.md`); released lab reports are archived to object storage via BullMQ. Billing follow-ups: a payment provider adapter (provider dependency), and validation of the configured BIR documents and VAT treatment with the organization's accountant. Phase 3 follow-ups done: result attachments (laboratory-managed documents, frozen from verification) and realtime lab status (`lab.updated`). Dental follow-ups (periodontal charting, the MyHealth view and supply use from inventory done): dental FHIR resources, releasing images and online plan decisions in MyHealth.

## 1. Technology stack

Use this stack unless there is a strong, documented technical reason to change it.

| Area           | Choice                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| Monorepo       | **Nx + pnpm + TypeScript**. Do **not** introduce Turborepo.                                                      |
| Frontend       | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, React Hook Form, Zod, TanStack Query where appropriate      |
| Backend        | NestJS, TypeScript, REST, OpenAPI/Swagger. Validation: **Zod** (via `nestjs-zod`) everywhere.                    |
| Database       | PostgreSQL — primary transactional store, strong relational modeling. SQL migrations + Drizzle query builder     |
| Cache / jobs   | Redis + BullMQ                                                                                                   |
| Object storage | S3-compatible                                                                                                    |
| Mobile         | React Native + Expo (primarily for patients)                                                                     |
| Realtime       | WebSockets / Socket.IO                                                                                           |
| Telemedicine   | WebRTC via a proven/managed provider (e.g. LiveKit). The app owns the clinical workflow; video is one component. |
| Infrastructure | Docker, Terraform, GitHub Actions, CDN/WAF where appropriate                                                     |
| Observability  | OpenTelemetry, Prometheus, Grafana, centralized structured logging, error tracking                               |

**PostgreSQL:** do not store the healthcare system as arbitrary JSON. Use JSONB only where genuinely appropriate (configurable forms, structured extension fields, specialty-specific data).

**Background jobs (BullMQ)** for: notifications, SMS, email, PDF generation, report generation, long-running integrations, data synchronization, scheduled patient outreach, and laboratory processing where appropriate.

**Object storage** for: medical documents, lab reports, dental images, X-rays, patient/consultation attachments, medical certificates, consent documents, generated PDFs. Never store large binaries in PostgreSQL.

**Realtime** for: queue updates, lab status, notifications, telemedicine waiting room, operational dashboards.

---

## 2. Architectural principle — modular monolith

Start with a **modular monolith**. Do **not** start with microservices.

The NestJS API is one deployable application with strict domain boundaries. Extract a domain into a separate service only with a demonstrated requirement: independent scaling, isolated deployment, external integration requirements, workload characteristics, security isolation, or operational necessity. Never create microservices because they sound more enterprise-grade.

---

## 3. Nx monorepo structure

```
apps/
  staff/                Next.js — clinic, lab, dental, billing, admin staff      [exists]
  portal/               Next.js — patients                                       [exists]
  mobile/               Expo — patients                                          [planned]
  api/                  NestJS modular monolith                                  [exists]
  notification-worker/  BullMQ worker                                            [exists]
  integration-worker/   BullMQ worker for external systems                       [exists]
  e2e/                  Playwright critical journeys (§31)                       [exists]

libs/
  ui/ domain/                                                                    [exist, frontend shared]
  core/ audit/ organization/ auth/ documents/ notification/                      [exist, backend platform]
  patient/ clinic/ prescription/ care-plan/ laboratory/ telemedicine/ billing/    [exist, backend domains]
  inventory/ dental/                                                             [exist]
  crm/ reporting/
  interoperability/ (FHIR mapping) pdf/                                          [exist]
  philhealth/                                                                    [exists]

database/migrations/  tools/  docs/  infrastructure/
nx.json  package.json  pnpm-workspace.yaml  tsconfig.base.json (frontend)  tsconfig.node.json (backend)
```

`libs/ui` is the shared Healthcare Design System; `libs/domain` holds shared frontend clinical types. Appointments, queue and encounters live together in `libs/clinic` (their lifecycle is transactionally coupled — see `docs/architecture/decisions.md` ADR-0007); prescriptions and care plans are separate domain libraries.

Prefer domain-oriented libraries. Do not create hundreds of tiny libraries.

---

## 4. Architectural boundaries

Domains must not depend on each other's internal implementation.

```
BAD:  Dental  → directly modifies Laboratory tables
      Billing → directly accesses Clinic repositories
      Patient Portal → directly accesses Lab database implementation

GOOD: Clinic → Laboratory Order API (contract) → Laboratory
      Dental → Application contract → Core domain / integration
```

Use domain services, application services, commands, queries, events, contracts, DTOs, and repository interfaces where appropriate. Enforce boundaries with **Nx tags and `@nx/enforce-module-boundaries`**.

---

## 5. Core healthcare domain

The patient is the center of the system. There is exactly **one canonical Patient identity** — never separate patients for clinic, dental, laboratory, or telemedicine. Domains own domain-specific records linked to that identity.

```
Patient
├── Appointments        ├── Care Plans            ├── Referrals
├── Encounters          ├── Laboratory Orders     ├── Documents
├── Diagnoses           ├── Laboratory Results    ├── Billing
├── Medications         ├── Dental Records        └── Communications
├── Prescriptions       ├── Telemedicine Encounters
└── Vital Signs
```

---

## 6. Patient management

Registration, lookup, search, profile, demographics, contact information, emergency contacts, family relationships, dependents, allergies, medical/surgical/family/social history, medication history, immunization history, insurance/HMO, PhilHealth information, documents, consent, privacy preferences, duplicate detection, patient merge, patient status, and patient timeline.

The **patient timeline** eventually unifies consultation, appointment, laboratory, prescription, dental, telemedicine, payment, care plan, and communication into one chronological view.

## 7. Patient lookup

Fast lookup by patient number, name, date of birth, contact number, and other configured identifiers. Support duplicate detection. Do not expose sensitive information unnecessarily in search results.

## 8. Clinic module

See `libs/clinic/CLAUDE.md`. Covers registration (walk-in, appointment, check-in, triage, queue, visit type, provider assignment), appointments (doctor/clinic/room schedules, online booking, recurring, reschedule, cancel, waitlist, no-show, confirmation, reminder, online check-in), triage, consultation (SOAP-style without one rigid template), configurable diagnosis coding, and prescriptions.

## 9. Care plan

A first-class domain: goals, problems, interventions, medications, laboratory monitoring, follow-up appointments, referrals, patient tasks, provider tasks, target dates, status, progress. Care plans connect to appointments and laboratory orders.

```
Diabetes Care Plan: Diagnosis → HbA1c → Medication → Diet/lifestyle → Follow-up → Repeat labs
```

## 10. Telemedicine / online checkup

A complete clinical workflow, not a video-call button.

```
Patient: Book → Pre-consult questionnaire → Payment (if required) → Waiting room
         → Video consultation → Clinical encounter → Diagnosis → Prescription → Lab order → Follow-up
```

Doctor: online queue, patient history, previous encounters, lab history, available vitals, video, notes, diagnosis, prescription, lab order, referral, follow-up. Support medical certificates, digital documents, patient instructions, follow-up scheduling.

Do not imply every condition is suitable for telemedicine. Providers must be able to **escalate to in-person care**.

## 11. Dental

See `libs/dental/CLAUDE.md`. Same Patient Master — never a second patient database.

## 12–15. Laboratory (LIS, QC, inventory, trends)

See `libs/laboratory/CLAUDE.md`. Treat it as a serious LIS. **Never silently overwrite a released result.**

## 16. Healthcare CRM

Patient communication (SMS, email, push, in-app), appointment/follow-up/lab-result reminders, outreach, recall, no-show follow-up, chronic care follow-up, preventive-care reminders, campaigns, segmentation, communication history.

The CRM is subordinate to legitimate healthcare workflows and privacy requirements. Never implement marketing features that expose sensitive health information improperly. Respect consent and communication preferences.

## 17. Patient portal

Registration, authentication, appointment booking/management, online checkup, lab results, prescriptions, care plans, billing, payments, documents, messages, notifications, medical record requests, consent management.

Only release records/results that are **authorized for patient access**.

## 18. Billing

See `libs/billing/CLAUDE.md`. Keep billing logic separate from clinical logic.

## 19–20. PhilHealth, Philippine integrations, FHIR

See `libs/interoperability/CLAUDE.md`. A dedicated interoperability layer with replaceable adapters. Internal domain model and external interoperability model are separate concerns.

---

## 21. Security

First-class requirement: RBAC; organization-, facility-, and department-level access; provider, lab, billing, and patient permissions; MFA; secure sessions; rate limiting; encryption in transit and at rest where appropriate; secure file access via signed/private URLs; audit trail; access logging; data retention; backup; disaster recovery; secure secrets management.

Never expose healthcare records through uncontrolled APIs.

## 22. Audit trail

Every sensitive healthcare action is auditable. Record: who, what, when, which patient, which resource, which facility, what action, before/after where appropriate, reason where required, source/device where appropriate.

Examples: doctor viewed patient record; lab technician entered result; pathologist approved result; doctor modified encounter; patient accessed lab report; administrator changed permission; billing staff issued refund.

Audit events are append-only. Never silently overwrite important clinical history.

## 23. Core entities

```
Organization Facility Department User Role Permission Practitioner
Patient PatientIdentifier PatientContact PatientRelationship PatientConsent
Appointment QueueEntry
Encounter VitalSign Diagnosis Procedure ClinicalNote Prescription Medication
CarePlan CarePlanGoal CarePlanTask
LaboratoryOrder LaboratoryOrderItem Specimen SpecimenEvent
LaboratoryResult LaboratoryResultComponent LaboratoryApproval
DentalRecord DentalChart DentalProcedure
Invoice InvoiceItem Payment Claim
Document Communication Notification AuditEvent
```

Use proper foreign keys and constraints.

## 24. Database rules

The database enforces important invariants — never rely on frontend validation alone. Use foreign keys, unique constraints, check constraints, transactions, optimistic locking where useful, idempotency for external operations, and soft deletion only where appropriate.

Healthcare records are not casually deleted. Prefer statuses, archival, amendments, and audit history.

## 25. API design

REST + OpenAPI, versioned under `/api/v1`:

```
/api/v1/patients              /api/v1/laboratory/results
/api/v1/appointments          /api/v1/prescriptions
/api/v1/encounters            /api/v1/care-plans
/api/v1/laboratory/orders     /api/v1/billing/invoices
/api/v1/laboratory/specimens
```

Consistent pagination, filtering, sorting, error format, request IDs, idempotency keys where appropriate, and server-side authorization on every endpoint. Never return more patient information than the caller needs.

## 26. Events

Domain/application events for decoupling, e.g. `PatientRegistered`, `AppointmentBooked`, `AppointmentCheckedIn`, `EncounterCompleted`, `PrescriptionIssued`, `LaboratoryOrderCreated`, `SpecimenCollected`, `LaboratoryResultEntered`, `LaboratoryResultVerified`, `LaboratoryResultApproved`, `LaboratoryResultReleased`, `CarePlanCreated`, `FollowUpDue`, `PaymentCompleted`.

```
LaboratoryResultApproved → Audit | Notify → Patient Portal | Timeline
```

Not every event is asynchronous. Use synchronous transactions where immediate consistency is required.

## 27. Notification architecture

One `NotificationService` abstraction over SMS, email, push, and in-app channels, delivered through queues. Track sent, delivered (where supported), failed, retried, cancelled, template, recipient, and consent/communication preference.

## 28. Dashboards

- **Clinic:** today's appointments, waiting patients, queue, online consultations, no-shows, follow-ups, pending and critical lab results, provider workload.
- **Laboratory:** orders, specimens, pending tests, rejected specimens, results awaiting verification, critical results, turnaround time, workload, QC, equipment, inventory.
- **Management:** patient volume, revenue, services, provider and lab utilization, no-show rate, waiting time, lab TAT, patient retention, operational metrics.

## 29. UX principles

Users are healthcare workers under time pressure — no unnecessarily complicated workflows. Do not force all users into the same UI.

- **Doctors:** patient-centric "Patient 360" workspace — demographics, allergies, medications, alerts; current encounter (SOAP, diagnosis, orders, prescription); history (encounters, lab trends, imaging, care plan).
- **Laboratory staff:** a workbench optimized for throughput.
- **Reception:** a fast workflow.
- **Patients:** a simple mobile experience.

## 30. Offline-first consideration

Design for eventual offline support (registration, queue, vitals, selected documentation, printing, local encrypted temporary storage, sync after reconnect). Never implement unsafe synchronization — healthcare data conflicts need explicit resolution rules.

## 31. Testing

- **Unit:** domain logic, validation, calculations, authorization, clinical workflow rules.
- **Integration:** PostgreSQL, Redis, object storage, external integrations.
- **API:** authentication, authorization, validation, contracts.
- **E2E critical journeys:**
  - Registration → Appointment → Check-in → Consultation → Lab order → Specimen collection → Result → Approval → Patient portal
  - Online booking → Telemedicine → Prescription → Lab order → Follow-up

Never rely solely on frontend tests.

## 32. CI/CD

Every pull request runs, using Nx affected commands: lint → typecheck → affected unit tests → affected integration tests → affected E2E → build. Protect `main`; require passing CI.

## 33. Documentation

Maintain `docs/` (`architecture/`, `domains/`, `database/`, `api/`, `security/`, `interoperability/`, `deployment/`, `runbooks/`). Every major domain documents its purpose, entities, commands, queries, events, permissions, API, database relationships, and integration points. Use `docs/domains/_template.md`. Do not let undocumented business logic accumulate.

## 34. Coding standards

TypeScript strict mode, ESLint, Prettier, consistent naming, explicit domain boundaries, small cohesive modules, dependency inversion where appropriate, strong typing, no unnecessary `any`, no hidden global state, no duplicated business rules. Do not prematurely abstract. Prefer simple, readable code over clever code.

## 35. Healthcare safety principles

The software assists healthcare professionals; it must not pretend to independently diagnose patients. Any clinical decision support must be clearly labeled as decision support, show supporting information, avoid presenting suggestions as definitive diagnoses, allow provider override, log important interactions, use configurable rules, and warn about uncertainty. Never build autonomous medical decisions into ordinary CRUD workflows.

## 36. Philippine context

Design with consideration for the Data Privacy Act and National Privacy Commission guidance, DOH requirements, PhilHealth workflows (eClaims, YAKAP where applicable), facility licensing and clinical laboratory regulations, Philippine healthcare terminology, currency (PHP), address formats, mobile numbers, local date/time (Asia/Manila), and holidays where relevant.

- Do not claim regulatory compliance merely because a feature exists. Compliance must be validated against current official requirements before production certification or deployment.
- **Never invent government APIs, regulatory requirements, or certification rules.** If a government integration is required but documentation is unavailable, mark it as an integration dependency instead of inventing an implementation.

## 37. Development process

Before a major feature: understand the domain → inspect the repository → identify existing patterns → check boundaries → design the data model → define API contracts → define permissions → define events → implement backend/domain → implement frontend → add tests → update documentation.

Do not rewrite working architecture unnecessarily. Do not add a library when an existing dependency already solves the problem.

## 38. Implementation priority

1. **Foundation** — Nx monorepo, authentication, organizations, facilities, users/roles, Patient Master, patient lookup, audit, documents, notifications
2. **Clinic** — appointments, queue, registration, triage, vital signs, encounters, diagnosis, prescription, care plan, clinical dashboard
3. **Laboratory** — catalog, orders, specimens, barcode, worklists, results, verification, approval, reports, result history
4. **Patient experience** — portal, online booking, notifications, communication, outreach, follow-up, lab result access
5. **Telemedicine** — online consultation, waiting room, video, prescription, lab orders, follow-up
6. **Dental** — dental record, odontogram, examination, treatment plans, procedures, imaging
7. **Billing** — charges, invoices, payments, discounts, HMO, insurance, PhilHealth
8. **Philippine integration** — PhilHealth/eClaims, DOH reporting, external systems, FHIR
9. **Advanced operations** — inventory, lab QC, equipment, procurement, multi-branch, advanced analytics, offline

Change the order only with a documented reason.

## 39. Standout features

Differentiate through connected workflows, not screen count:

- **Patient 360** — one unified timeline across consultation, lab, dental, prescription, telemedicine, care plan, billing, communication.
- **Doctor one-screen workspace** — patient → current encounter → history → lab trends → care plan → orders → prescription.
- **Connected lab** — consultation → order → specimen → testing → result → verification → approval → patient and doctor.
- **Digital care journey** — online booking → telemedicine → prescription → lab → result → follow-up → care plan.
- **Patient recall** — automatically identify patients due for configured follow-up.
- **Result trends** — longitudinal lab values, not isolated reports.
- **Offline capability** — for clinics with unreliable connectivity.

## 40. Engineering rules

**Never:**

- Expose database entities directly from controllers
- Put business logic in React components
- Put healthcare rules directly into SQL
- Let every module access every repository
- Delete clinical records without a documented policy
- Overwrite released lab results
- Store sensitive files directly in the database
- Hard-code government integration assumptions
- Put secrets in source control
- Skip authorization because the frontend hides a button
- Trust client-side validation
- Introduce microservices without a demonstrated reason

**Always:**

- Validate and authorize server-side
- Audit sensitive actions
- Use transactions for critical workflows
- Use idempotency for external operations
- Maintain history for important clinical records
- Protect patient data
- Keep integrations replaceable
- Write tests for critical workflows
- Keep domain boundaries explicit

## 41. When implementing code

Inspect the repository first. Do not assume files exist, invent APIs, invent tables, or silently change architecture. Follow established patterns unless there is a clear reason to improve them.

When requirements are ambiguous: choose the safest reasonable interpretation, state the assumption briefly, and implement so it can change later. Do not stop unnecessarily for minor clarification.

## 42. Output format for development tasks

1. **Understanding** — what you understand.
2. **Architecture impact** — apps, libraries, database changes, API changes, events, permissions, integrations.
3. **Implementation**
4. **Tests**
5. **Validation** — lint, typecheck, affected tests, build where appropriate.
6. **Summary** — files changed, features implemented, remaining limitations, follow-up recommendations.

Keep explanations concise unless detailed architectural analysis is requested.

## 43. Golden rule

The system behaves like a connected healthcare platform, not a collection of CRUD screens.

```
                    PATIENT
                       │
        ┌──────────────┼──────────────┐
      CLINIC         DENTAL          LAB
        └──────────────┼──────────────┘
                  PATIENT 360
        ┌──────────────┼──────────────┐
  TELEMEDICINE     CARE PLAN       BILLING
        └──────────────┼──────────────┘
                 PATIENT PORTAL
                       │
                   MOBILE APP
```

Always prioritize patient safety, privacy, clinical data integrity, interoperability, maintainability, and excellent user experience over unnecessary technical complexity.
