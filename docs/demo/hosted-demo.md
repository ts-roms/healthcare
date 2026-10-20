# Hosted demo: checklist

A public demo is a normal deployment of the platform with the demo data on it — nothing in the code is demo-specific.
This page lists what is needed and what stays the organization's decision; `docs/deployment/railway.md` and
`docs/runbooks/railway-terraform.md` describe the deployment itself.

## What exists

- Config-as-code for Railway (`railway.json` per app) and Terraform for the project, its five services (`api`,
  `notification-worker`, `integration-worker`, `staff`, `portal`), variables and domains
  (`infrastructure/terraform/railway/`, ADR-0010). PostgreSQL and Redis come from Railway templates; object storage from
  any S3-compatible bucket.
- `pnpm db:seed:demo`, which fills a deployment through its public API ([walkthrough](walkthrough.md)).
- The existing Railway project `cliniq` in the same workspace is **another application** (`ts-roms/cliniq`, with `web`,
  `api` and `ai-service` services); this platform has no Railway project yet.

## The demo environment (created 2026-10-20)

Railway project **healthcare-demo** (`700105a8-4f8b-4882-b871-42060b79b082`, workspace "Rom Cena's Projects"),
environment `production`, region `sfo` (bucket in `sin`):

| Service               | Id                                           | Public address                                  |
| --------------------- | -------------------------------------------- | ----------------------------------------------- |
| `api`                 | `28d2be66-5934-4d39-81d4-0a56efb24c59`       | `https://api-production-1eb6.up.railway.app`    |
| `staff`               | `12ab7e4b-ac32-458b-bb1b-3a836c9d05ef`       | `https://staff-production-28d9.up.railway.app`  |
| `portal` (MyHealth)   | `53874cb8-0cfd-4436-ba4d-e015e791bcc9`       | `https://portal-production-c1a4.up.railway.app` |
| `notification-worker` | `25b4d453-e1c5-4d90-b757-2436307fde18`       | —                                               |
| `integration-worker`  | `e9f21dab-c43f-487a-a870-aa3362177bc5`       | —                                               |
| `Postgres`, `Redis`   | Railway templates (PostgreSQL 18, Redis 8.2) | —                                               |
| bucket `documents`    | `d8ecc176-ed29-47dd-ba77-e4925b1a9d8e`       | referenced as `${{documents.*}}`                |

What is set: every variable of `docs/deployment/railway.md` for a demo — generated `JWT_ACCESS_SECRET`,
`MFA_ENCRYPTION_KEY`, `INTEGRATION_PAYLOAD_KEY` and VAPID keys (never written to the repository; read them in the
dashboard), database, Redis and bucket references, the public addresses, `CORS_ORIGINS`, `TRUST_PROXY`, the seed
variables (`SEED_ORG_CODE=demo`, administrator `admin@demo.healthcare.ph` with a generated password held in the `api`
service's variables), `PORTAL_ORGANIZATION_CODE=demo`, `STAFF_IDLE_MINUTES=20`; and each service's build, start,
health check, pre-deploy (`pnpm db:migrate` on `api`) and restart settings, applied directly because Railway now
refuses the config-as-code path for new services (the `railway.json` files stay the reference).

Not set: SMTP (no email: password resets and notices by email do not go out), LiveKit (no video), ClamAV
(uploads "not scanned"), PayMongo, OTLP. The database is used as its owner (no restricted role: acceptable for a demo
that holds no real patient data, not for a real deployment).

**Pending**: no service has a source yet. Connect each of the five services to `ts-roms/healthcare` on the branch to
demo (deploys start at once: `api` first, then the rest), run `pnpm db:seed` and `pnpm db:seed:demo` against the API
with its `SEED_*` values, change `DEMO_PASSWORD`, and turn deploy-on-push off per service.

## Steps

1. **Repository and branch.** Railway deploys from GitHub: push the branch to deploy (for a demo, a `demo` branch that
   tracks `main`) and connect the five services to it.
2. **Project and services.** Apply the Terraform in `infrastructure/terraform/railway/` with a Railway token, or create
   the project by hand following `docs/deployment/railway.md`; add the Postgres and Redis templates; create a bucket.
3. **Secrets.** Generate `JWT_ACCESS_SECRET`, `MFA_ENCRYPTION_KEY`, `INTEGRATION_PAYLOAD_KEY`, VAPID keys; set `DATABASE_URL`,
   `REDIS_URL`, the `S3_*` variables, `PORTAL_BASE_URL`, `STAFF_BASE_URL`, `PORTAL_ORGANIZATION_CODE`; leave the provider
   keys (SMTP, LiveKit, PayMongo, ClamAV) unset for a demo unless the tour needs them (video consultations need LiveKit).
4. **Database.** The pre-deploy command runs the migrations; create the restricted login role as
   `docs/runbooks/database-roles.md` describes, then run `pnpm db:seed` against the deployed database (`SEED_*`) and
   `pnpm db:seed:demo` with `API_BASE_URL` set to the deployed API.
5. **Accounts.** Change `DEMO_PASSWORD` for a public demo, turn on staff two-step verification for the administrator,
   and give the demo accounts facility-scoped roles only.
6. **Reset.** A public demo collects whatever visitors type. Schedule a reset (drop and recreate the database, re-run the
   migrations and both seeds) daily, and say so on the sign-in page (the organization's own wording).

## What a public demo must not hold

- No real patient data, ever: the demo patients are invented, and the register of consents, the audit trail and the
  breach register all refer to them.
- No production secrets or provider accounts shared with a live deployment.
- The privacy notice, consent wording and compliance reviews on the demo are placeholders, not the organization's.
