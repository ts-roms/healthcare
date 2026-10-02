# Healthcare Platform

Nx + pnpm monorepo for an integrated healthcare platform for the Philippines (clinic/EMR, laboratory, dental,
telemedicine, patient CRM and portal, billing) — a NestJS modular-monolith API on PostgreSQL, Next.js staff and patient
apps, an Expo (React Native) patient mobile app, and a custom **Healthcare Design System** built on shadcn/ui.

**One patient. One longitudinal health record. One connected care journey.** Engineering rules: [`CLAUDE.md`](./CLAUDE.md).

```text
Next.js ─ React ─ Tailwind CSS v4 ─ shadcn/ui (Radix) ─ Healthcare Design System
                                                          ├── Staff app   (desktop-first, dense, role-aware)
                                                          └── Patient portal (mobile-first, plain language)
Expo ─ React Native ─ expo-router ───────────────────────── Patient mobile app (sign-in, results, notifications)
```

## Status

- **Backend — implemented (Phase 1 Foundation, Phase 2 Clinic, Phase 3 Laboratory, Phase 4a portal records, Phase 4b online booking, Phase 4c outreach, Phase 5 Telemedicine, Phase 6 Dental, Phase 7 Billing, Phase 8 FHIR R4 read and interoperability adapter stubs, Phase 9 inventory, dispensing and laboratory quality; [`CLAUDE.md`](./CLAUDE.md) §0 has the details), including:** authentication with MFA, RBAC, Patient Master, audit, documents, notifications; scheduling, queue, triage, encounters, diagnoses, prescriptions, care plans; laboratory catalog, orders, specimens, versioned results with verification/approval/release, critical values, worklists and trends ([docs](docs/domains/laboratory.md)). See [docs/architecture/overview.md](docs/architecture/overview.md).
- **Staff app — connected for sign-in and patients:** sign-in with MFA, permission-based navigation, facility selection, patient lookup, the patient record (with allergies and clinical summary) and registration with duplicate review, the queue (walk-in check-in, call, move), triage and vital signs, the doctor's encounter workspace (SOAP note, diagnoses, prescriptions, follow-up booking, care plans, sign, amend), and appointments (day schedule, booking from open slots, confirm, check in, cancel, no-show) run against the API ([how](docs/architecture/staff-app.md)). The laboratory runs against the API too: workbench, critical results, catalog, ordering from the encounter, and results with trends on the patient record. Online consultations run end to end: MyHealth questionnaire and waiting room, LiveKit video, the telemedicine encounter, and escalation to in-person care. Billing runs against the API: charges captured from signed consultations and laboratory orders, invoices with statutory discounts (with evidence) and HMO/PhilHealth coverage, payments, refunds and a daily report. Dental runs against the API too: the day's dental visits (`/dental`), the patient's dental record with the odontogram (`/dental/patients/[id]`) and dental settings (`/dental/settings`).
- **Patient portal — connected for sign-in:** staff invite a patient from their record (one-time activation code, requires portal-access consent); the patient activates and signs in to MyHealth and sees their visits, released lab results in plain language with trends, active medicines and care plan, and gets an SMS/email (no clinical detail) when results are ready, books, moves or cancels visits online within the clinic's published schedules, and sees their bills ([how](docs/architecture/portal-app.md)). MyHealth also has a messages inbox (notices and messages from the clinic), and patients get follow-up reminders from their care plan and a "we missed you" message after a no-show — all subject to consent and communication preferences. The Healthcare Design System (`libs/ui`) is documented in Storybook.
- **Patient mobile app — first slice:** MyHealth on iPhone and Android (`apps/mobile`, Expo): sign-in with two-step verification, released lab results with their history, and push notifications, against the same `/api/v1/portal` API as the web portal. Not yet tried on a device; store release is set up per organization but no build has been made. See [Mobile app](#mobile-app).

## Getting started

```bash
pnpm install

# Backend (API on http://localhost:3333/api, OpenAPI at /api/docs)
cp .env.example .env  # set SEED_ADMIN_PASSWORD
pnpm dev:deps         # PostgreSQL, Redis, S3 storage (RustFS), Mailpit (Docker)
pnpm db:migrate && pnpm db:seed
pnpm dev:api          # NestJS API
pnpm dev:worker       # notification worker
pnpm dev:integration-worker  # integration worker

# Frontend (both need the API; staff sign-in: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)
pnpm dev:staff        # http://localhost:3000  — staff workstation
pnpm dev:portal       # http://localhost:3001  — patient portal (MyHealth)
pnpm dev:mobile       # Expo dev server — patient mobile app (see "Mobile app" below)
pnpm storybook        # http://localhost:6006  — design system
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:integration # API integration tests (wipes TEST_DATABASE_URL)
pnpm format
```

The staff app's navigation follows the signed-in user's permissions from the API; modules marked **Demo** show sample data only.

## Layout

```text
apps/
├── api/                  NestJS modular-monolith API (REST /api/v1, OpenAPI, Socket.IO realtime)
├── notification-worker/  BullMQ worker delivering SMS / email / push
├── integration-worker/   BullMQ worker sending exchanges to external systems
├── staff/                Next.js staff application
├── portal/               Next.js patient portal
└── mobile/               Expo (React Native) patient app — an API client only
database/migrations/      Forward-only SQL migrations (source of truth for the schema)
libs/
├── core/ audit/ organization/ auth/ documents/ notification/   Backend platform services
├── patient/ clinic/ prescription/ care-plan/                    Backend clinical domains
├── domain/     Shared clinical types (FHIR-inspired), staff roles, demo fixtures (frontend)
└── ui/         Healthcare Design System (+ Storybook)
    └── src/
        ├── styles/       theme.css (tokens) · globals.css (entry)
        ├── primitives/   shadcn/Radix components tuned for density
        ├── healthcare/   PatientHeader, LabWorklist, Odontogram, PrescriptionEditor, …
        └── layouts/      StaffLayout, DoctorLayout, LaboratoryLayout, TelemedicineLayout, PatientLayout
```

Import paths: `@healthcare/ui/primitives`, `@healthcare/ui/healthcare`, `@healthcare/ui/layouts`,
`@healthcare/ui/styles.css`, `@healthcare/domain`, `@healthcare/domain/fixtures`.

## Backend

Architecture, database, API conventions and security are documented in [`docs/`](./docs/README.md)
([overview](docs/architecture/overview.md)). Highlights: PostgreSQL-enforced invariants (tenant-safe composite keys,
no double-booking, append-only audit and clinical history, immutable prescriptions), RBAC scoped to organization /
facility / department, TOTP MFA, a transactional event outbox, and API integration tests against a real database.

## Mobile app

`apps/mobile` is the patient app (MyHealth) for iPhone and Android, built with Expo and React Native. It is a client of the same
patient API as the web portal (`/api/v1/portal/*`) and holds no business rules: which results a patient may see, sign-in rules and
notifications are all decided by the API. Requirements, decisions and what is verified: [mobile-app.md](docs/architecture/mobile-app.md).

### What patients can do

| Screen        | What it does                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in       | Email and password, then the authenticator or recovery code if two-step verification is on. Accounts are activated on the web portal. |
| Your results  | Latest released result per test in plain language (same wording as the web portal), in the clinic's time zone.                        |
| Result        | A test's history, each value with the range it had at the time.                                                                       |
| Notifications | Turn notifications on or off for this phone, send a test, remove other devices. Notices never contain a result, name or reason.       |

Activation, password reset, visits, booking, medicines, bills, messages and everything else stay in MyHealth on the web for now.

### Develop

```bash
# 1. The API must run (see Getting started) and have a patient with MyHealth activated on the web portal.
# 2. Point the app at it — a phone or emulator cannot reach "localhost"; use the computer's network address
#    (the Android emulator reaches the host at 10.0.2.2).
cp apps/mobile/.env.example apps/mobile/.env.local   # EXPO_PUBLIC_API_BASE_URL, EXPO_PUBLIC_ORGANIZATION_CODE (seeded: demo)
pnpm dev:mobile                                      # scan the QR code with Expo Go, or open in a development build

pnpm nx run-many -t lint typecheck test -p mobile    # what CI runs for the app
```

- **Expo Go** runs sign-in and results; notifications are switched off there (the Notifications screen says a development build is
  needed), because Expo Go cannot receive remote notifications. **Push** needs a development build (`eas build --profile development`)
  linked to an Expo project, and `EXPO_PUSH_ENABLED=true` for the API and notification worker.
- **Code layout:** screens in `src/app` (expo-router), the session and API client in `src/lib` (platform-neutral, unit-tested with
  Vitest). The refresh token lives only in the phone's secure storage; the access token in memory.
- **Shared code:** only platform-neutral `type:domain` libraries — today `@healthcare/domain/portal-results` (result types and wording,
  shared with the web portal). Lint refuses backend and web-only imports.
- **Settings** (`apps/mobile/.env.example`) are built into the app and readable in it — never a secret.

### Release

One store app per organization, published under the organization's own Apple and Google accounts and built with EAS Build
(`apps/mobile/app.config.ts`, `apps/mobile/eas.json`). Each organization sets its own identifiers — none is in the repository, and builds
refuse to run without them. Steps, store listing inputs and the release checklist: [mobile-release.md](docs/deployment/mobile-release.md).

## Frontend stack

| Concern            | Choice                                                    |
| ------------------ | --------------------------------------------------------- |
| Framework          | Next.js (App Router), React 19                            |
| Styling / tokens   | Tailwind CSS v4 (`@theme`), shadcn/ui token names         |
| Primitives         | shadcn/ui on Radix UI                                     |
| Icons              | Lucide                                                    |
| Clinical tables    | TanStack Table (`LabWorklist`)                            |
| Forms              | React Hook Form + Zod (`PrescriptionEditor`)              |
| Charts             | Recharts (`LabTrendChart`)                                |
| Dates              | date-fns + facility-timezone formatting (`lib/format.ts`) |
| Toasts             | Sonner                                                    |
| Design system docs | Storybook (with a11y addon)                               |

## Design principles

1. **Information density, not a generic SaaS dashboard.** Type scale: 12 meta · 13 table · 14 body · 16–18 section ·
   20–24 page. 32px controls.
2. **Never colour alone.** Every clinical status is colour + icon + text (`⚠ Critical`). See `healthcare/status.tsx`.
3. **Patient identity always visible** in any patient context. An empty allergy list explicitly says
   "No known allergies".
4. **One workspace per job.** Patient 360, the three-column doctor encounter workspace, the lab workbench and the
   telemedicine workspace replace multi-screen flows.
5. **Clinical decision support, never silent blocking.** Drug–allergy checks (`findAllergyConflict` in `libs/domain`)
   show their evidence and allow an override with a documented reason, returned to the caller for the audit trail.
6. **Keyboard first for staff.** `/` patient search · `↑/↓` or `j/k` worklist · `Enter` next result · `F2` barcode ·
   `Alt+P` prescription · `Alt+L` lab order.
7. **Role-aware navigation.** `navigationForRole()` filters `STAFF_NAVIGATION`.
8. **Action-first dashboards.** "What do I need to do next?" (`AttentionList`, `ActionMetric`) rather than charts.
9. **Facility time, always.** Clinical times render in the facility timezone (`setClinicTimeZone`, default
   `Asia/Manila`), never the server's.
10. **Staff and patients get different products.** The portal is mobile-first with a bottom tab bar, 16px base text and
    plain-language results.

## Screens (staff app)

| Route                                                                                                                                 | Screen                                                                                                                                                                                                                                                                                   | Data   |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `/login`                                                                                                                              | Sign-in: password, TOTP MFA, organization choice                                                                                                                                                                                                                                         | API    |
| `/`                                                                                                                                   | Clinic today (facility): appointments, waiting, with provider, seen, average wait, no-show rate, attention list, next patients, provider workload, queue; laboratory today and critical results                                                                                          | API    |
| `/patients`                                                                                                                           | Patient lookup (name, patient no., mobile, birth date); minimal fields, masked mobile                                                                                                                                                                                                    | API    |
| `/patients/new`                                                                                                                       | Registration with duplicate review and audited override                                                                                                                                                                                                                                  | API    |
| `/patients/[id]`                                                                                                                      | Patient record: demographics, contacts, identifiers, consent, allergies and clinical summary (Patient 360)                                                                                                                                                                               | API    |
| `/preview/patient-360`                                                                                                                | **Patient 360** design preview (overview, encounters, labs, meds, care plan, dental, documents, billing, timeline)                                                                                                                                                                       | Demo   |
| `/clinic/encounters`                                                                                                                  | Today's consultations: ready for provider, with provider, seen; start or open                                                                                                                                                                                                            | API    |
| `/clinic/encounters/[id]`                                                                                                             | **Doctor workspace** — encounters · SOAP note (drafts, sign, amend, history) + diagnoses + prescriptions + care plans + follow-up · clinical context; collapses to tabs < 1280px                                                                                                         | API    |
| `/clinic/care-plans`                                                                                                                  | Recall list: overdue and due care-plan activities with patient, plan, book / done / cancel                                                                                                                                                                                               | API    |
| `/clinic/care-plans/[id]`                                                                                                             | Care plan: goals, activities (book follow-up, done, cancel, recurring), progress notes, status                                                                                                                                                                                           | API    |
| `/laboratory/worklist`                                                                                                                | **Lab workbench** — stage worklists (STAT first), barcode scan, collect, receive, reject, enter results, verify / approve / release, correct                                                                                                                                             | API    |
| `/laboratory/critical`                                                                                                                | Critical results: document the call (read-back), acknowledge                                                                                                                                                                                                                             | API    |
| `/laboratory/catalog`                                                                                                                 | Tests, versioned reference ranges, panels, departments, specimen types, facility laboratory policy                                                                                                                                                                                       | API    |
| `/dental`                                                                                                                             | Dental visits of the day; the patient's dental record with the odontogram (FDI, per-surface charting) at `/dental/patients/[id]`                                                                                                                                                         | API    |
| `/telemedicine`                                                                                                                       | Today's online consultations: questionnaire answered, waiting since, red flags; review and start                                                                                                                                                                                         | API    |
| `/telemedicine/[id]`                                                                                                                  | Pre-consult answers and **Start** (then the encounter workspace with video, end with instructions, escalate to in-person)                                                                                                                                                                | API    |
| `/queue`                                                                                                                              | Live queue board: call, send to triage / ready for provider, cancel or left-without-being-seen (with reason)                                                                                                                                                                             | API    |
| `/queue/walk-in`                                                                                                                      | Walk-in check-in from the patient record (visit type, priority, chief complaint)                                                                                                                                                                                                         | API    |
| `/queue/visits/[id]/triage`                                                                                                           | Triage: chief complaint, priority, pain score, risk flags, vital signs (with allergies and previous vitals shown)                                                                                                                                                                        | API    |
| `/appointments`                                                                                                                       | Day schedule per practitioner: confirm, check in, cancel (with reason), no-show                                                                                                                                                                                                          | API    |
| `/appointments/new`                                                                                                                   | Booking from the practitioner's open slots                                                                                                                                                                                                                                               | API    |
| `/patients/[id]/360`                                                                                                                  | **Patient 360** workspace: banner, alerts, current and recent consultations, problem list, medications, care plans, latest vitals, results with trends, open lab orders, images and documents, timeline slice                                                                            | API    |
| `/patients/[id]/timeline`                                                                                                             | Patient timeline across every domain, newest first: day groups, kind chips, date range                                                                                                                                                                                                   | API    |
| `/patients/[id]/edit`                                                                                                                 | Edit details: demographics, status, contacts, addresses, identifiers, emergency contacts and guardians, communication preferences                                                                                                                                                        | API    |
| `/patients/[id]/history`, `/immunizations`, `/communications`                                                                         | Patient history (past procedures and conditions, medications taken, family and social history); immunization records; the patient's communication history and preferences                                                                                                                | API    |
| `/patients/[id]/merge`, `/merge/[survivorId]`                                                                                         | Merge a duplicate record (compare, blockers, acknowledged differences) and unmerge                                                                                                                                                                                                       | API    |
| `/clinic/referrals`, `/clinic/referrals/[id]`, `/clinic/referrals/settings`                                                           | Referrals to a practitioner of the organization or an outside provider; the overdue follow-up setting                                                                                                                                                                                    | API    |
| `/clinic/prescriptions`                                                                                                               | Prescriptions issued at the selected facility over a period                                                                                                                                                                                                                              | API    |
| `/clinic/procedures`, `/clinic/vaccines`                                                                                              | The organization's procedure catalogue with supply templates; its vaccine catalogue                                                                                                                                                                                                      | API    |
| `/appointments/schedules`, `/visit-types`, `/waitlist`                                                                                | Weekly schedules, closures, practitioners and rooms; visit types open to online booking and per-clinic booking rules; the patient waiting list                                                                                                                                           | API    |
| `/calendar`, `/doctors`, `/doctors/[id]`                                                                                              | Staff calendar (meetings, events, blocked time) beside appointments; doctors and a doctor's appointments for the day                                                                                                                                                                     | API    |
| `/laboratory/qc`, `/instruments`, `/reagents`, `/temperatures`, `/nonconformances`, `/eqa`, `/competency`, `/licence`                 | Laboratory quality: internal QC with a Levey-Jennings chart, instruments with their maintenance log, reagent lots and use, temperature logs, nonconformances with CAPA, EQA rounds, staff competency, the facility's laboratory licence as recorded                                      | API    |
| `/laboratory/send-outs`, `/laboratory/instrument-results`                                                                             | Send-outs to reference laboratories; analyzer results waiting for review                                                                                                                                                                                                                 | API    |
| `/dental/settings`                                                                                                                    | Dental settings: the procedures the clinic records (its own codes, priced by billing by code) and how teeth are numbered on screen                                                                                                                                                       | API    |
| `/billing`, `/billing/patients/[id]`, `/billing/invoices`, `/billing/invoices/[id]`, `/billing/reports`, `/billing/settings`          | Cashier's desk; a patient's charges, packages, deposit and credit balance; invoices (discounts, HMO/PhilHealth coverage, payments, refunds, credit and debit notes, PhilHealth claim panel); daily report; services, prices, packages, discount rules, payers, tax and document settings | API    |
| `/pharmacy`, `/pharmacy/[prescriptionId]`                                                                                             | Dispensing from stock against an active prescription                                                                                                                                                                                                                                     | API    |
| `/inventory`, `/catalog`, `/movements`, `/purchase-orders`, `/supplier-invoices`, `/valuation`, `/controlled-register`, `/compliance` | Stock by location and lot, movements, catalog, purchase orders, supplier invoices, valuation, the register of controlled items, withholding codes and procurement methods                                                                                                                | API    |
| `/records/requests`, `/records/imports`, `/records/retention`                                                                         | Records office: patients' records requests, FHIR import review, document retention review                                                                                                                                                                                                | API    |
| `/reporting`, `/reporting/[id]`, `/reporting/settings`                                                                                | DOH case reports for review; reportable-condition rules and rescans of earlier diagnoses                                                                                                                                                                                                 | API    |
| `/management`                                                                                                                         | Management dashboard with CSV export                                                                                                                                                                                                                                                     | API    |
| `/communications`, `/messages`, `/notifications`                                                                                      | Communication log; conversations with patients; in-app notices                                                                                                                                                                                                                           | API    |
| `/admin/users`, `/roles`, `/facilities`, `/organization`, `/security`, `/consent-wording`, `/compliance`, `/integrations`, `/audit`   | Staff and roles, facilities and departments, company settings, two-step verification policy, consent wording, compliance reviews, integration review and payload keys, the audit trail                                                                                                   | API    |
| `/account`, `/help`, `/forgot-password`, `/reset-password`                                                                            | Own password and two-step verification; the user manual; staff password reset by emailed link                                                                                                                                                                                            | API    |
| `/welcome`                                                                                                                            | Public landing page                                                                                                                                                                                                                                                                      | Static |

`/preview/patient-360` is the only page that reads demo fixtures (`apps/staff/src/lib/demo-data.ts`); every other screen shows API data only. An address that matches no screen renders a placeholder, but no menu entry leads there. One row above may stand for several screens; the detail per screen is in `docs/architecture/staff-app.md` and the user manual (`docs/manual/`).

## Screens (MyHealth)

| Route                                                                          | What it does                                                                                                                                                   |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/activate`, `/login`, `/forgot-password`, `/reset-password`                   | Activation with a staff-issued one-time code; sign-in, with two-step verification when the patient set it up; password reset by emailed link and date of birth |
| `/`, `/profile`                                                                | Home; the patient's profile                                                                                                                                    |
| `/appointments`, `/appointments/book`, `/appointments/[appointmentId]`         | Visits: book, reschedule and cancel within published schedules; online check-in where the clinic allows it                                                     |
| `/consultations/[appointmentId]`                                               | Online consultation: questionnaire, waiting room, video, instructions                                                                                          |
| `/results`, `/results/[testId]`                                                | Released results in plain language, with trends                                                                                                                |
| `/prescriptions`, `/care-plan`, `/immunizations`, `/health-history`, `/dental` | Active prescriptions; care plan; immunizations; health history; dental (where the organization opts in)                                                        |
| `/billing`                                                                     | Invoices, coverage, payments, credit and debit notes, deposit and credit balance; pay online once a payment provider is configured                             |
| `/messages`, `/messages/new`, `/messages/[threadId]`                           | Conversations with the clinic                                                                                                                                  |
| `/documents`                                                                   | Medical certificates, shared documents and records requests                                                                                                    |
| `/people`                                                                      | Guardians and dependents: acting for another's record under a clinic-recorded grant                                                                            |
| `/privacy`, `/privacy/[consentType]`, `/security`, `/notification-settings`    | Consents with their history, given or withdrawn online; email verification and two-step verification; message channels per kind                                |
| `/help`                                                                        | The user manual's MyHealth chapter                                                                                                                             |

An address that matches no screen shows "Coming soon"; no link in MyHealth leads there.
