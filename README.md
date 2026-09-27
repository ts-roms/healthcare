# Healthcare Platform

Nx + pnpm monorepo for an integrated healthcare platform for the Philippines (clinic/EMR, laboratory, dental,
telemedicine, patient CRM and portal, billing) — a NestJS modular-monolith API on PostgreSQL, Next.js staff and patient
apps, and a custom **Healthcare Design System** built on shadcn/ui.

**One patient. One longitudinal health record. One connected care journey.** Engineering rules: [`CLAUDE.md`](./CLAUDE.md).

```text
Next.js ─ React ─ Tailwind CSS v4 ─ shadcn/ui (Radix) ─ Healthcare Design System
                                                          ├── Staff app   (desktop-first, dense, role-aware)
                                                          └── Patient portal (mobile-first, plain language)
```

## Status

- **Backend — Phase 1 (Foundation) and Phase 2 (Clinic) implemented:** authentication with MFA, RBAC, Patient Master, audit, documents, notifications; scheduling, queue, triage, encounters, diagnoses, prescriptions, care plans. See [docs/architecture/overview.md](docs/architecture/overview.md).
- **Staff app — connected for sign-in and patients:** sign-in with MFA, permission-based navigation, facility selection, patient lookup, the patient record (with allergies and clinical summary) and registration with duplicate review, the queue (walk-in check-in, call, move) and appointments (day schedule, booking from open slots, confirm, check in, cancel, no-show) run against the API ([how](docs/architecture/staff-app.md)). Other clinical modules (encounters, laboratory, dental, telemedicine) are still **demo previews** on sample data, clearly badged.
- **Patient portal — prototype** on demo fixtures. The Healthcare Design System (`libs/ui`) is documented in Storybook.

## Getting started

```bash
pnpm install

# Backend (API on http://localhost:3333/api, OpenAPI at /api/docs)
cp .env.example .env  # set SEED_ADMIN_PASSWORD
pnpm dev:deps         # PostgreSQL, Redis, MinIO, Mailpit (Docker)
pnpm db:migrate && pnpm db:seed
pnpm dev:api          # NestJS API
pnpm dev:worker       # notification worker

# Frontend (the staff app needs the API; sign in with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)
pnpm dev:staff        # http://localhost:3000  — staff workstation
pnpm dev:portal       # http://localhost:3001  — patient portal (demo data)
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
├── staff/                Next.js staff application
└── portal/               Next.js patient portal
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

| Route                     | Screen                                                                                                             | Data       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| `/login`                  | Sign-in: password, TOTP MFA, organization choice                                                                   | API        |
| `/`                       | Welcome, quick actions; clinical dashboard previews (doctor · lab · front desk)                                    | API + demo |
| `/patients`               | Patient lookup (name, patient no., mobile, birth date); minimal fields, masked mobile                              | API        |
| `/patients/new`           | Registration with duplicate review and audited override                                                            | API        |
| `/patients/[id]`          | Patient record: demographics, contacts, identifiers, consent, allergies and clinical summary (Patient 360)         | API        |
| `/preview/patient-360`    | **Patient 360** design preview (overview, encounters, labs, meds, care plan, dental, documents, billing, timeline) | Demo       |
| `/clinic/encounters/[id]` | **Doctor workspace** — history · encounter note · clinical context, collapses to tabs < 1280px                     | Demo       |
| `/laboratory/worklist`    | **Lab workbench** — TanStack worklist + result entry, auto-flagging, verify/critical/reject                        | Demo       |
| `/dental`                 | **Odontogram** (FDI) with per-surface charting                                                                     | Demo       |
| `/telemedicine/[id]`      | Video consult with the patient record alongside                                                                    | Demo       |
| `/queue`                  | Live queue board: call, send to triage / ready for provider, cancel or left-without-being-seen (with reason)       | API        |
| `/queue/walk-in`          | Walk-in check-in from the patient record (visit type, priority, chief complaint)                                   | API        |
| `/appointments`           | Day schedule per practitioner: confirm, check in, cancel (with reason), no-show                                    | API        |
| `/appointments/new`       | Booking from the practitioner's open slots                                                                         | API        |

Modules in the navigation that aren't built yet render a placeholder.

Patient, queue and appointment pages use the API through `apps/staff/src/lib/api`. Demo modules read `apps/staff/src/lib/demo-data.ts` until their backends exist.
