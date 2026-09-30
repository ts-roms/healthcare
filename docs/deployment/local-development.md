# Local development

Requirements: Node 22+, pnpm 10, Docker (or local PostgreSQL 16 + Redis).

```bash
pnpm install
cp .env.example .env              # then set SEED_ADMIN_PASSWORD
pnpm dev:deps                     # PostgreSQL, Redis, S3 storage (RustFS), Mailpit
pnpm db:migrate
pnpm db:seed                      # first organization, facility and platform admin
pnpm dev                          # everything below, in parallel (one terminal)
```

`pnpm dev` starts the API, the notification and integration workers, the staff app and the portal together with prefixed, interleaved logs (`nx run-many -t serve dev`); stop them all with Ctrl+C. The Next.js `dev` targets are marked `continuous` in each app's `package.json` so Nx runs them alongside the API. To run one app on its own (sign in to the staff app with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`):

```bash
pnpm dev:api                      # http://localhost:3333/api, docs at /api/docs
pnpm dev:worker                   # notification worker
pnpm dev:integration-worker       # integration worker (outbound exchanges: PhilHealth, …)
pnpm dev:instrument-gateway       # analyzer gateway (needs GATEWAY_* variables; docs/domains/laboratory-instruments.md)
pnpm dev:staff                    # http://localhost:3000 — staff app (needs the API)
pnpm dev:portal                   # http://localhost:3001 — patient portal (needs the API)
pnpm storybook                    # http://localhost:6006 — design system
```

`CORS_ORIGINS` in `.env.example` already allows both web apps.

To try the patient portal: in the staff app, open a patient, use **Record
consent** (Consent & communication) to record "Patient portal access" as
granted, then **Invite to portal** on the patient page. On http://localhost:3001 choose
"Set up your account" and enter the patient number, date of birth and the code.
The portal serves the organization in `PORTAL_ORGANIZATION_CODE` (seeded: `demo`). `PORTAL_BASE_URL` (the API's setting; `http://localhost:3001` in `.env.example`) is where password-reset emails link; with no mail provider the reset link is written to the API log in development.

Checks (what CI runs):

```bash
pnpm nx sync:check
pnpm format:check
pnpm nx run-many -t lint typecheck test build
pnpm nx run api:integration  # needs TEST_DATABASE_URL (a database that may be wiped)
pnpm test:e2e                # critical journeys in a browser (below)
```

The integration tests drop and recreate the `public` schema of
`TEST_DATABASE_URL`. Never point it at a database you care about.

### End-to-end journeys (`apps/e2e`)

`pnpm test:e2e` (`nx run e2e:e2e`) builds the API, the staff app and the portal, then runs the CLAUDE.md §31 critical
journeys with Playwright against the built applications, each person in their own browser session:

1. **Registration → appointment → check-in → consultation → laboratory order → specimen collection → result →
   verification, approval and release → MyHealth** (`tests/1-clinic-laboratory-portal.journey.ts`).
2. **Online booking in MyHealth → pre-consult questionnaire → waiting room → teleconsultation → prescription →
   laboratory order → follow-up booking → instructions, prescription and follow-up in MyHealth**
   (`tests/2-online-booking-telemedicine.journey.ts`). The waiting room opens 30 minutes before the appointment and
   online bookings need notice, so the test moves the booked appointment to a few minutes from now in the database
   (the only step that does not go through the applications). No video server runs, so the consultation uses the
   callback-number fallback.

It needs PostgreSQL and Redis (`pnpm dev:deps`) and Chromium (`pnpm --filter e2e exec playwright install chromium`;
already present in Claude Code cloud sessions). It uses its own database (`E2E_DATABASE_URL`, default
`healthcare_e2e`, dropped and recreated on every run — its name must contain `e2e`) and its own ports (API 3433, staff
3100, portal 3101; `E2E_*_PORT`), so it runs next to `pnpm dev` without touching the development database.
`support/prepare-database.ts` creates the tenant and staff users; the `setup` project (`tests/setup.setup.ts`)
configures visit types, schedules, coding, the laboratory catalog and a MyHealth patient through the API. A journey
fails on any browser error or server error (5xx), not only on missing text. On failure, traces and screenshots are in
`apps/e2e/test-results` (`pnpm --filter e2e exec playwright show-trace <trace.zip>`); CI uploads them as an artifact. A
minified React error (e.g. "#441") becomes readable with `E2E_STAFF_DEV=1`, which runs the staff app with `next dev`.

Mailpit (captured email): http://localhost:8025. Object storage console (RustFS): http://localhost:9001 (user `healthcare`, password `healthcare-dev-secret`).
