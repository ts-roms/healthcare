# Local development

Requirements: Node 22+, pnpm 10, Docker (or local PostgreSQL 16 + Redis).

```bash
pnpm install
cp .env.example .env              # then set SEED_ADMIN_PASSWORD
pnpm dev:deps                     # PostgreSQL, Redis, MinIO, Mailpit
pnpm db:migrate
pnpm db:seed                      # first organization, facility and platform admin
pnpm dev:api                     # http://localhost:3333/api, docs at /api/docs
pnpm dev:worker
```

Frontend (both apps need the API running; sign in to the staff app with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`):

```bash
pnpm dev:staff                    # http://localhost:3000 — staff app
pnpm dev:portal                   # http://localhost:3001 — patient portal (needs the API)
pnpm storybook                    # http://localhost:6006 — design system
```

`CORS_ORIGINS` in `.env.example` already allows both web apps.

To try the patient portal: in the staff app, open a patient, use **Record
consent** (Consent & communication) to record "Patient portal access" as
granted, then **Invite to portal** on the patient page. On http://localhost:3001 choose
"Set up your account" and enter the patient number, date of birth and the code.
The portal serves the organization in `PORTAL_ORGANIZATION_CODE` (seeded: `demo`).

Checks (what CI runs):

```bash
pnpm nx sync:check
pnpm format:check
pnpm nx run-many -t lint typecheck test build
pnpm nx run api:integration  # needs TEST_DATABASE_URL (a database that may be wiped)
```

The integration tests drop and recreate the `public` schema of
`TEST_DATABASE_URL`. Never point it at a database you care about.

Mailpit (captured email): http://localhost:8025. MinIO console: http://localhost:9001.
