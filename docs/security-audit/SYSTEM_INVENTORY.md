# SYSTEM_INVENTORY (Stage A, read-only)

Auditor: inventory agent. Date: 2026-11-02. Method: file listing, grep counts, reading config. Nothing was executed except read-only shell listings and `pnpm audit`. Counts are from `find`/`grep` over `apps/` and `libs/` (excluding `node_modules`); route counts are decorator counts (`@Get|Post|Put|Patch|Delete`) and may include non-route usages.

## 1. Directive vs reality

| Directive assumption (SYSTEM-FULL-AUDIT.md:5-12) | Reality | Evidence |
|---|---|---|
| Frontend: "React" SPA | Next.js 16.3.6 (App Router, server components/actions, `proxy.ts`), React 19, plus an Expo (React Native 0.86) mobile app | `apps/staff/package.json`, `apps/portal/package.json`, `apps/mobile/package.json`, `pnpm-lock.yaml:9801` |
| Single "full-stack web application" | Nx monorepo: 1 API, 2 workers, 1 gateway, 2 Next apps, 1 Expo app, 1 Playwright e2e, 23 libs | `ls apps libs` |
| Browser calls API directly | Staff/portal call the API from the Next.js server; tokens in httpOnly cookies (per CLAUDE.md; cookie flags not re-verified here) | `apps/staff/src/proxy.ts` |
| Generic ORM | Hand-written SQL migrations + Drizzle query builder | `database/migrations/` (135 files, 0001..0135) |
| Deliverables API_INVENTORY.md / DATABASE_INVENTORY.md | Assigned to other auditors, not this file | - |

## 2. Workspace inventory

| Project | Path | Kind | .ts/.tsx files | Controller files | Service files | Test files |
|---|---|---|---|---|---|---|
| api | apps/api | NestJS composition root | 344 | 28 | 6 | 125 (8 in src, 117 in `test/`, mostly `*.int.spec.ts`) |
| notification-worker | apps/notification-worker | BullMQ worker | 6 | 0 | 0 | 0 |
| integration-worker | apps/integration-worker | BullMQ worker | 6 | 0 | 0 | 0 |
| instrument-gateway | apps/instrument-gateway | HL7/ASTM TCP gateway | 10 | 0 | 0 | 1 |
| staff | apps/staff | Next.js | 612 | - | - | 56 |
| portal | apps/portal | Next.js | 163 | - | - | 21 |
| mobile | apps/mobile | Expo | 35 | - | - | 5 |
| e2e | apps/e2e | Playwright | 29 | - | - | 22 journey files + setup |
| 23 libs | libs/* | see MODULE_COVERAGE.md | - | - | - | - |

Totals: 108 `@Controller(` declarations, about 800 route decorators (libs ~686 + apps/api 107), 135 SQL migrations, 130 staff `page.tsx`, 32 portal `page.tsx`, 14 mobile `.tsx`, 26 domain docs (`docs/domains`), 12 architecture docs, 7 runbooks, 7 interoperability docs.

## 3. Runtime topology (as configured)

| Component | Source | Notes |
|---|---|---|
| API | `railway.json:2-24` | RAILPACK builder; pre-deploy `pnpm db:migrate`; health `/api/v1/health/ready`; start `node apps/api/dist/main.js` |
| Workers/gateway | `apps/*/railway.json` | Railway; no Dockerfile anywhere in the repo |
| PostgreSQL 16, Redis 7 | `infrastructure/docker/docker-compose.yml:6,19` (dev); Railway templates in prod | App connects as non-owner `healthcare_app` role (migration 0109) only when `app_database_url` is supplied (see INV-007) |
| Object storage | S3-compatible (`rustfs/rustfs:1.0.0` dev, line 26) | |
| Other dev images | `amazon/aws-cli`, `axllent/mailpit`, `livekit/livekit-server` (lines 38, 51, 58, no tag), `clamav/clamav:1.4` (65) | |
| IaC | `infrastructure/terraform/railway/` | fmt + validate only in CI |
| CI | `.github/workflows/ci.yml`, `release.yml` | see ARCHITECTURE_ASSESSMENT |

## 4. Tech stack actually present

NestJS ^11 on Express, Socket.IO 4.8 + Redis adapter, BullMQ ^5.81, Drizzle ^0.45, pg ^8.23, Zod ^4.6.5 + nestjs-zod ^5.5, `@node-rs/argon2`, otplib ^12 (TOTP), `@simplewebauthn/server` ^14, `@nestjs/jwt` ^11 (HS256, `libs/auth/src/lib/tokens.ts:75,87`), helmet ^8, `@nestjs/throttler` ^6.7, nodemailer ^10.0.12, web-push, pdfkit ^0.20, qrcode, livekit-server-sdk ^2.19, OpenTelemetry 0.222/2.11, AWS SDK v3. Frontend: Next ^16.3.6, React ^19.2, Tailwind 4, Storybook 10, Vitest 4. Mobile: Expo ~57, RN 0.86.3, React 19.2.3. Node >=22 (`.nvmrc` = 22), pnpm 10.33.0, TypeScript ~6.0.3 (backend) / ^5.9 (frontend).

## 5. Entry points and trust boundaries

- Public HTTP: API `/api/v1/*` (45 `@Public()` usages and 16 `@PlatformScope` usages by grep; the authoritative list belongs to the API inventory). Global guards include `RateLimitGuard` (`apps/api/src/app/app.module.ts:313`). Swagger only when `NODE_ENV !== "production"` (`apps/api/src/app/configure-app.ts:27`).
- Public web: staff and portal Next apps (`/forgot-password`, `/activate`, `/outreach/opt-out`, `/help` reachable unauthenticated by design).
- TCP: instrument-gateway MLLP/ASTM listeners (on-site).
- Inbound: PayMongo webhook (`rawBody: true`, `apps/api/src/main.ts:30`), FHIR import `POST /fhir/r4/imports`.
- Background: about 15 in-process timers started in `apps/api/src/main.ts:40-79`.

## Findings

| ID | Sev | Location | Evidence | Impact | Fix | Status |
|---|---|---|---|---|---|---|
| INV-001 | INFO | `docs/audit/SYSTEM-FULL-AUDIT.md:5-12` | Directive says frontend "React"; code is Next.js 16 + Expo | Test plans written for a browser SPA calling the API directly will miss server-side attack surface (server actions, `proxy.ts`, cookie handling) | Adapt the test plan to the Next BFF flow | Open |
| INV-002 | LOW | repo root (no Dockerfile); `railway.json:3-4` | Builds via Railpack with no pinned base image | Build provenance cannot be reviewed from the repo | Pin builder and Node versions in config | Open |
| INV-003 | LOW | `infrastructure/docker/docker-compose.yml:38,51,58` | Three images with no tag (implicit `latest`) | Dev-only supply-chain drift | Pin tags/digests | Open |
| INV-004 | INFO | `git status` | `package.json` modified and `tools/db/new-organization.ts` untracked at audit time | Audited tree contains uncommitted work | Commit before the Stage B baseline | Open |
| INV-005 | LOW | `apps/api/src/main.ts:40-79` | Fifteen schedulers run inside the API process | With more than one API replica each job runs per instance; per-job idempotency is claimed in CLAUDE.md but Not verified | Verify locks/idempotency per job or use a dedicated scheduler | Open |
