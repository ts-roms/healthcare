# Local development

Requirements: Node 22+, pnpm 10, Docker (or local PostgreSQL 16 + Redis).

```bash
pnpm install
cp .env.example .env              # then set SEED_ADMIN_PASSWORD
pnpm dev:deps                     # PostgreSQL, Redis, MinIO, Mailpit
pnpm db:migrate
pnpm db:seed                      # first organization, facility and platform admin
pnpm nx serve api                 # http://localhost:3000/api, docs at /api/docs
pnpm nx serve notification-worker
```

Checks (what CI runs):

```bash
pnpm nx sync:check
pnpm format:check
pnpm nx run-many -t lint typecheck test build
pnpm nx run api:test-integration  # needs TEST_DATABASE_URL (a database that may be wiped)
```

The integration tests drop and recreate the `public` schema of
`TEST_DATABASE_URL`. Never point it at a database you care about.

Mailpit (captured email): http://localhost:8025. MinIO console: http://localhost:9001.
