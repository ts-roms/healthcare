# ARCHITECTURE_ASSESSMENT (Stage A, read-only)

Date 2026-11-02. Scope: structure, boundaries and security architecture as evidenced in code and config. Only items I opened are marked Verified; control-level testing belongs to other auditors.

## 1. Style

Modular monolith (NestJS) plus two BullMQ workers and a TCP gateway, matching CLAUDE.md section 2. Domain libraries depend on `core`, `audit`, `organization` and a few peers only (dependency lists in each `libs/*/package.json`): `libs/clinic` -> core, audit, organization, notification, documents, pdf; `libs/patient` -> auth, documents, pdf; `libs/philhealth` -> interoperability. No domain-to-domain dependencies among clinic, laboratory, billing, dental, prescription, inventory (Verified from package.json only; the import graph and the `@nx/enforce-module-boundaries` rules were not evaluated - Not verified).

## 2. Security architecture as built

| Control | Status | Evidence |
|---|---|---|
| Global rate-limit guard | Verified wired | `apps/api/src/app/app.module.ts:185,313` |
| JWT HS256 pinned, issuer and audience checked, `typ` claim checked | Verified secure (code read) | `libs/auth/src/lib/tokens.ts:73-96` |
| JWT secret minimum length 32 | Verified | `libs/core/src/lib/config/app-config.ts:53` (entropy not checked) |
| One symmetric secret for staff, portal, MFA-challenge and realtime tokens; separated only by `aud`/`typ` | Verified | `tokens.ts:73-96` |
| Access TTL 900 s default, range 60-3600 | Verified | `app-config.ts:54` |
| Helmet on API; CORS allow-list with credentials | Verified | `apps/api/src/app/configure-app.ts:18-19` |
| Swagger off in production | Verified | `configure-app.ts:27` |
| JSON body limit 1 MB | Verified | `configure-app.ts:23` |
| DB least-privilege role and RLS | Implemented in migrations; RLS default mode is `observe` | `app-config.ts:51`; no `DATABASE_RLS_MODE` in `infrastructure/terraform/railway/*.tf` |
| Restricted DB role optional in IaC | Verified | `infrastructure/terraform/railway/main.tf:28` |
| Malware scanning of uploads | Implemented (ClamAV port), not provisioned by IaC; unconfigured means `not_scanned` | `apps/api/src/main.ts:84-89`; `CLAMAV_HOST` only mentioned in a doc string at `terraform/railway/variables.tf:81` |
| Security headers / CSP on staff and portal | Not found | grep for `content-security-policy|x-frame-options|frame-ancestors|strict-transport` in `apps/staff` and `apps/portal` (ts, tsx, json, mjs) returned no files; `apps/staff/next.config.ts` and `apps/portal/next.config.ts` define no `headers()` |
| `dangerouslySetInnerHTML` | 4 sites, all injecting a server-generated QR SVG | `libs/ui/src/healthcare/app-download.tsx:41`; `apps/portal/src/app/(portal)/qr/page.tsx:31`; `apps/portal/src/app/(portal)/security/mfa-section.tsx:198`; `apps/staff/src/app/(staff)/account/account-forms.tsx:194` |
| Markdown renderer | `react-markdown` ^10, no `rehype-raw` in deps | `libs/ui/package.json`, `libs/ui/src/primitives/markdown.tsx` |
| Observability | OpenTelemetry + JSON logs | `apps/api/src/main.ts:90` (PHI-in-log review belongs to the privacy auditor) |

## 3. Data and tenancy architecture

Organization scoping happens in services (`actor.organizationId`) and in RLS policies (migration `0111`, `ContextPool`). With the default `observe` mode a query without organization context runs and only logs `db.context_missing` (per CLAUDE.md; default confirmed at `app-config.ts:51`). Whether the owner role is subject to RLS (FORCE ROW LEVEL SECURITY) is Not verified (migration body not read).

## 4. CI/CD and supply chain

| Item | Evidence |
|---|---|
| CI runs only on `pull_request`; `push: main` is commented out | `.github/workflows/ci.yml:8-10` |
| Stages: sync check, prettier, lint, typecheck, unit, integration (Postgres + Redis), e2e, build, terraform fmt/validate | `ci.yml:62-140` |
| No dependency audit, CodeQL/SAST, secret scan, SBOM or Dependabot/Renovate | `.github/` contains only `ci.yml` and `release.yml`; grep "audit" in both returned nothing |
| Actions pinned by tag, versions inconsistent | `ci.yml:59,131` (`checkout@v7`), `release.yml:17` (`checkout@v4`) |
| Workflow-level `permissions: contents: read` (good); release job has `contents: write` | `ci.yml:16-18`, `release.yml:10` |

## 5. Reliability

Outbox plus BullMQ with idempotent handlers (claimed). Health `/api/v1/health/ready` checks DB (required), Redis and object storage (degrade). Rate limiting fails open when Redis is down (CLAUDE.md). A backup runbook exists (`docs/runbooks/backup-and-restore.md`); restore drills Not verified.

## Findings

| ID | Sev | Location | Evidence | Impact | Fix | Status |
|---|---|---|---|---|---|---|
| INV-006 | HIGH | `libs/core/src/lib/config/app-config.ts:51`; `infrastructure/terraform/railway/main.tf` (no `DATABASE_RLS_MODE`) | RLS mode defaults to `observe`; IaC never sets `enforce` | In production the tenant-isolation policies are log-only: a code path that misses the organization context silently runs unscoped, so a cross-tenant bug is not stopped by the database | Set `DATABASE_RLS_MODE=enforce` in Terraform for api and both workers once `db.context_missing` is clean; consider enforce as the production default | Open |
| INV-007 | MEDIUM | `infrastructure/terraform/railway/main.tf:28` | App uses the owner `DATABASE_URL` unless `app_database_url` is provided | Without the restricted role the 0109 revokes (append-only protections) and RLS semantics for non-owners do not apply to the app | Require `app_database_url` for production via a validation block | Open |
| INV-008 | MEDIUM | `apps/staff/next.config.ts`, `apps/portal/next.config.ts`, `apps/*/src/proxy.ts` | No CSP, frame-ancestors/X-Frame-Options, HSTS, Referrer-Policy or Permissions-Policy emitted by the Next apps; helmet covers only the API. Edge headers Not verified | Staff and portal pages (clinical data, session cookies) lack clickjacking and XSS defence in depth | Add `headers()` with CSP (nonce), `frame-ancestors 'none'`, HSTS, nosniff, referrer-policy | Open |
| INV-009 | MEDIUM | `.github/workflows/ci.yml`, `release.yml` | No dependency audit, SAST, secret scanning, SBOM or update bot | Vulnerable dependencies (see DEPENDENCY_INVENTORY, 6 critical) reach `main` unnoticed | Add `pnpm audit` gate, CodeQL, gitleaks, Dependabot | Open |
| INV-010 | LOW | `ci.yml:8-10` | CI only on pull requests | Direct pushes to `main` and tag pushes are untested if branch protection is not enforced (GitHub settings Not verified) | Re-enable `push: main` or enforce branch protection | Open |
| INV-011 | LOW | `ci.yml:59,131`; `release.yml:17` | Third-party actions pinned by mutable tag (`nrwl/nx-set-shas@v5`, `hashicorp/setup-terraform@v3`, `pnpm/action-setup@v6`) | Tag re-pointing supply-chain risk | Pin to commit SHAs | Open |
| INV-012 | MEDIUM | `apps/api/src/main.ts:84-89`; `infrastructure/terraform/railway/variables.tf:81` | ClamAV not provisioned by IaC; only a startup warning when `CLAMAV_HOST` is unset in production | Production may run with every upload recorded `not_scanned` (clinical files, patient uploads, outside results) | Provision clamd and require `CLAMAV_HOST` in production config validation | Open |
| INV-013 | LOW | `libs/auth/src/lib/tokens.ts:73-96` | One HS256 secret signs every token class; no `kid` rotation seen | Secret compromise forges all token classes; rotation forces global logout | Separate secrets per audience or asymmetric keys with `kid` | Open |
| INV-014 | LOW | `app-config.ts:53` | Only length >= 32 is enforced on the JWT secret | A long but weak secret is accepted | Require 32 random bytes (base64) in production | Open |
| INV-015 | INFO | the four `dangerouslySetInnerHTML` sites above | Input is SVG from `qrcode` on the Next server; patient-QR content can be a `portal_link` | Safe as long as the SVG never contains unescaped user text (Not verified) | Prefer `<img src="data:image/svg+xml...">` | Open |
