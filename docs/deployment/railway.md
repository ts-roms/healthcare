# Deploying on Railway

The platform runs on Railway as five services from this one repository, plus Railway's PostgreSQL and Redis. Each
service has a config-as-code file next to its app. In each service's **Settings → Config-as-code**, set the file path.
Keep **Root Directory** empty (the build needs the whole workspace).

The repository root also has a `railway.json` that is a copy of `apps/api/railway.json`. Railway reads it when a service
has no config-as-code path, so a service that misses its path builds and starts the `api` instead of failing in Railpack
on the workspace's two Next.js apps. It is a safety net only: still set the path on every service, and keep the root file
identical to the API's when either changes. `staff`, `portal` and the workers must have their own path (or
`RAILPACK_NX_APP`), because they would otherwise get the API's commands.

| Service               | Config file                              | Public domain | Notes                                                                    |
| --------------------- | ---------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| `api`                 | `/apps/api/railway.json`                 | yes           | Runs migrations before each deploy; health check `/api/v1/health/ready`. |
| `notification-worker` | `/apps/notification-worker/railway.json` | no            | BullMQ consumer, no HTTP port.                                           |
| `integration-worker`  | `/apps/integration-worker/railway.json`  | no            | BullMQ consumer, no HTTP port.                                           |
| `staff`               | `/apps/staff/railway.json`               | yes           | Next.js; calls the API over the private network.                         |
| `portal`              | `/apps/portal/railway.json`              | yes           | Next.js; calls the API over the private network.                         |
| `Postgres`, `Redis`   | Railway templates                        | no            | PostgreSQL 16+ (`btree_gist`, `pg_trgm` are created by migrations).      |

Railpack picks up Node 22 from `.nvmrc` and pnpm 10 from `packageManager`.

## Build notes

- **Backend builds run `typecheck` first, through Nx.** The webpack builds of `api` and the workers read the libraries'
  declaration output (`libs/*/dist`), which only the `typecheck` target (`tsc -b`) produces. The `build` target of each
  backend app therefore depends on its own `typecheck` (which depends on `^typecheck`), declared in the app's
  `package.json`, and `typecheck` declares `dist`/`out-tsc` as outputs in `nx.json` so a cache hit restores them. A plain
  `nx run api:build` works from a clean checkout, so the build command is just that.
- **The Next.js apps listen on `$PORT`.** The `start` scripts in `apps/staff` and `apps/portal` use `${PORT:-3000}` and
  `${PORT:-3001}`: Railway's `$PORT` when set, the local development ports otherwise. The Railway start command also
  passes `--port $PORT` explicitly, so a service still deploys if Railpack falls back to the `start` script.
- `pnpm db:migrate` runs as the API's pre-deploy command. It needs dev dependencies (`@swc-node/register`), so do not
  enable `RAILPACK_PRUNE_DEPS`.

## Deploy triggers

Automatic deploys on push are turned off. Railway keeps this setting in the dashboard, not in `railway.json`
(`watchPatterns` only narrows which changes count). For each of the five app services, in **Settings → Source**, remove
the branch trigger (or disconnect the repository) so pushes do not deploy. To keep automatic deploys but only after
GitHub checks pass, enable **Wait for CI** there instead.

Deploy by hand, from the dashboard (**Deploy** / **Redeploy**) or with `railway up --service <name>`.

- `api` runs `pnpm db:migrate` as its pre-deploy step, so migrations are applied only when you deploy `api`. Deploy `api`
  before the workers, `staff` and `portal` when a release includes a new migration.
- The workers and the Next.js apps do not deploy together with `api`. Deploy each service you changed.

## Variables

Put the settings every backend process reads in **Project → Shared Variables**, then share them with `api`,
`notification-worker` and `integration-worker`. All three processes validate the full configuration at start-up
(`libs/core/src/lib/config/app-config.ts`) and exit if anything is missing.

### Shared (api, notification-worker, integration-worker)

| Variable                                                                                                   | Value                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                                 | `production`                                                                                                                                                                                                               |
| `LOG_LEVEL`                                                                                                | `log`                                                                                                                                                                                                                      |
| `DATABASE_URL`                                                                                             | `${{Postgres.DATABASE_URL}}` (private network)                                                                                                                                                                             |
| `REDIS_URL`                                                                                                | `${{Redis.REDIS_URL}}?family=0`. `family=0` lets ioredis resolve `*.railway.internal` over IPv6 as well as IPv4. Without it, BullMQ connections fail with `ENOTFOUND` in environments whose private network is IPv6-only.  |
| `JWT_ACCESS_SECRET`                                                                                        | New random value, ≥ 32 characters (`openssl rand -base64 48`)                                                                                                                                                              |
| `MFA_ENCRYPTION_KEY`                                                                                       | New 32-byte key (`openssl rand -base64 32`). **Never reuse the sample value from `.env.example`.** Changing it later makes enrolled TOTP secrets unreadable.                                                               |
| `INTEGRATION_PAYLOAD_KEY` (or `…_KEYS` + `…_KEY_ID`)                                                       | Required in production. A new 32-byte key, different from `MFA_ENCRYPTION_KEY` (start-up refuses a reused key). The API and the integration worker must share it. See `docs/runbooks/integration-payload-key-rotation.md`. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | Private bucket for documents, lab reports and images. Use a Railway Bucket or any S3-compatible store. Leave `S3_ENDPOINT` unset for AWS S3. Without credentials, uploads and archived reports fail.                       |
| `SMTP_URL`, `EMAIL_FROM`                                                                                   | Outbound email (notification worker). Railway blocks outbound SMTP on the Free, Trial and Hobby plans. On those plans, use a provider's SMTP relay on an allowed port or upgrade.                                          |
| `PORTAL_BASE_URL`                                                                                          | The patient portal's public address (e.g. `https://myhealth.example.ph`). MyHealth password-reset emails link to it; without it none is sent.                                                                              |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`                                                     | Optional. Without them, online consultations fall back to the callback number.                                                                                                                                             |

### api only

| Variable                                                                       | Value                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                                         | Leave to Railway.                                                                                                                                                                                                 |
| `CORS_ORIGINS`                                                                 | `https://${{staff.RAILWAY_PUBLIC_DOMAIN}},https://${{portal.RAILWAY_PUBLIC_DOMAIN}}`. The staff browser opens the realtime socket to the API's public domain, so an empty list breaks live queue and lab updates. |
| `TRUST_PROXY`                                                                  | `true`. The rightmost `X-Forwarded-For` hop is Railway's edge (public traffic) or the staff/portal server (private network), so rate limits and the audit trail see the real client IP.                           |
| `DATABASE_POOL_MAX`                                                            | Optional (default 10). Keep the sum over replicas below the Postgres connection limit.                                                                                                                            |
| `FHIR_BASE_URL`                                                                | Optional: `https://${{RAILWAY_PUBLIC_DOMAIN}}/api/v1/fhir/r4`.                                                                                                                                                    |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ORG_CODE`, `SEED_ORG_NAME`, … | Only for the one-time seed (below). Remove the password afterwards.                                                                                                                                               |

### staff

| Variable       | Value                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`     | `production` (sets `Secure` session cookies)                                                                                                                   |
| `API_BASE_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}/api/v1`. Set `PORT` explicitly on `api` (e.g. `8080`) so it can be referenced.                           |
| `REALTIME_URL` | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}/realtime`. **Required.** The default derives from `API_BASE_URL`, which is a private address the browser cannot reach. |

### portal

| Variable                   | Value                                                                   |
| -------------------------- | ----------------------------------------------------------------------- |
| `NODE_ENV`                 | `production`                                                            |
| `API_BASE_URL`             | Same as staff.                                                          |
| `PORTAL_ORGANIZATION_CODE` | The organization's `code` (the seed's `SEED_ORG_CODE`, default `demo`). |

## First deploy

1. Create the Postgres and Redis services, then the five app services from this repository, each with its config file.
2. Set the variables above. Generate every secret fresh for this environment.
3. Deploy `api` first. Its pre-deploy step applies `database/migrations`.
4. Seed the first organization and platform administrator once from the API container:
   `railway ssh --service api`, then `pnpm db:seed`. The seed is idempotent.
5. Deploy the workers, `staff` and `portal`. Sign in to the staff app with the seeded administrator and enrol MFA.

In production the API does not serve Swagger (`/api/docs`).

Deploying on Railway does not make the platform compliant with the Data Privacy Act or NPC guidance. Hosting region,
backups, encryption at rest and data-processing agreements must be validated separately before real patient data is
stored.
