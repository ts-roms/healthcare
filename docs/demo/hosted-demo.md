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
