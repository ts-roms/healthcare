# Healthcare Platform (Philippines)

Integrated healthcare management platform: Clinic/EMR, Laboratory Information System, Dental, Telemedicine, Patient CRM, Patient Portal, Billing, and Philippine healthcare integrations.

**One patient. One longitudinal health record. One connected care journey.**

- Stack: Nx + pnpm monorepo, Next.js, NestJS (modular monolith), PostgreSQL, Redis/BullMQ, S3-compatible storage, React Native/Expo.
- Engineering rules: [`CLAUDE.md`](./CLAUDE.md)
- Domain rules: `libs/<domain>/CLAUDE.md`
- Documentation: [`docs/`](./docs/README.md)

## Status

Phase 1 (Foundation) is implemented: authentication with MFA, organizations and facilities, RBAC, Patient Master with lookup and duplicate detection, consent, documents, notifications, and an append-only audit trail. See [docs/architecture/overview.md](docs/architecture/overview.md).

## Quick start

```bash
pnpm install
cp .env.example .env        # set SEED_ADMIN_PASSWORD
pnpm dev:deps               # PostgreSQL, Redis, MinIO, Mailpit via Docker
pnpm db:migrate && pnpm db:seed
pnpm nx serve api           # http://localhost:3000/api/docs
```

More: [docs/deployment/local-development.md](docs/deployment/local-development.md).
