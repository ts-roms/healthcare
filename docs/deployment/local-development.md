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

Frontend (the staff app needs the API running; sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`):

```bash
pnpm dev:staff                    # http://localhost:3000 — staff app
pnpm dev:portal                   # http://localhost:3001 — patient portal
pnpm storybook                    # http://localhost:6006 — design system
```

`CORS_ORIGINS` in `.env.example` already allows both web apps.

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
