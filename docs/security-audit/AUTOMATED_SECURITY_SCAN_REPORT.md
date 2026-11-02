# Automated Security Scan Report

Stage A (read-only). Date: 2026-11-02. Host: Windows 11, Git Bash, Node v24.21.0, pnpm 10.33.0. No dependency was installed or changed; no database or application was started.

## 1. Tool availability and execution status

| Tool | Installed? | Executed? | Evidence / reason |
|---|---|---|---|
| OWASP ZAP | No | Not executed | `which zap.sh zap-cli` and `where.exe zap` found nothing; needs a running target and Java/Docker |
| Semgrep | No | Not executed | `which semgrep` / `where.exe semgrep` not found; `pip list` shows no semgrep or bandit |
| Gitleaks | No | Not executed | not on PATH (`which`, `where.exe`) |
| Trivy | No | Not executed | not on PATH |
| Burp Suite | No | Not executed | not on PATH; a commercial GUI tool needing manual operation |
| Docker images | Docker CLI present, daemon NOT running | Not executed | `docker images` -> "failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine"; no local images could be listed, so no containerised scanner could be confirmed or run |
| `pnpm audit` | Yes (pnpm 10.33.0) | Executed | network worked; results below |
| ESLint security rules | n/a | Not executed | none configured (see section 4) |
| Ad hoc secret regex grep (substitute for Gitleaks, NOT equivalent) | n/a | Executed | section 3 |

Nothing in this report is a DAST, SAST or container result. Section 6 gives the commands to run the missing tools.

## 2. Dependency audit (`pnpm audit`)

Commands (2026-11-02, read-only, registry advisories as returned that day):

- `pnpm audit --json` (all dependencies; exit code 1 because vulnerabilities exist). 2,411 dependencies. Counts: critical 6, high 33, moderate 45, low 10 (total 94).
- `pnpm audit --prod --json`: critical 3, high 15, moderate 20, low 7 (total 45).

Production-relevant highlights (from `--prod`, path shown by pnpm):

| Severity | Package (path) | Issue | Patched in |
|---|---|---|---|
| critical (2) | `next` (apps/portal; `apps/staff` declares the same `^16.3.6`, installed 16.3.6) | Unauthenticated RCE in Image Optimization API with SVG; unauthenticated RCE in `use cache` functions returning typed arrays | >=16.4.1 |
| high (1) + moderate (5) + low (1) | `next` | Server Actions DoS, image-optimization SSRF, ISR/SSG cache poisoning, metadata image info disclosure | >=16.3.8 / 16.4.1 |
| high | `multer` (`@nestjs/platform-express`) | DoS via pending async fileFilter after teardown | >=2.5.0 (installed 2.4.0) |
| high | `body-parser` (express under platform-express) | DoS via trailing bytes after compressed body | >=2.4.0 / 1.20.9 |
| high | `zod` (root; installed 4.6.5) | Memory exhaustion validating oversized constrained collections (API validation library) | >=4.6.6 |
| moderate x5 | `nodemailer` (installed 10.0.12) | address-parser header/recipient confusion; SMTP AUTH regex DoS | >=10.1.4 |
| moderate | `qs` (express) | `stringify` comma-array DoS | >=6.16.1 |
| high x6, moderate x3, low x3 | `node-forge` (apps/mobile via expo CLI; dev tooling) | PKCS#12, X.509, TLS, PEM issues | >=1.4.1 |
| critical | `shell-quote` (apps/mobile react-native devtools) | `quote()` command injection | >=1.11.0 |
| high | `sharp` (apps/portal via next) | librsvg dependency CVE | >=0.35.5 |
| moderate/high | `decode-uri-component`, `uuid`, `fast-uri`, `minimatch`, `glob`, `source-map-js` | DoS / parsing issues, mostly mobile or build tooling | various |

Dev/build-only items (full audit, not in `--prod`): `handlebars` (critical x2, via `ts-jest`), `storybook` (critical + high, dev server, fixed >=10.6.2), `shell-quote` via webpack-dev-server (critical), `vite`/`launch-editor` (high), `axios` (many high via `nx`), `smol-toml`, `brace-expansion`, `follow-redirects`, `@vitest/mocker`. These run on developer/CI machines, not in the deployed API.

Triage notes: the two Next.js criticals matter if the staff or portal image optimizer or `use cache` is exposed in production; confirm with `next.config` (not inspected in depth) and upgrade to >=16.4.1 regardless. `pnpm-workspace.yaml:16-17` already uses `overrides` for selected transitive fixes, which is the mechanism to patch `multer`, `body-parser`, `qs` where the parent has not moved. Reachability of each advisory was not assessed.

## 3. Secret scan substitute (ad hoc, not Gitleaks)

Command: `git ls-files -z | xargs -0 grep -nIE "AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY|ghp_[A-Za-z0-9]{30,}|sk_live_[A-Za-z0-9]+|xox[bap]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|pk_live_"` over tracked files only (working tree, current HEAD content; git history NOT scanned).

- One match: `apps/api/src/app/adapters/paymongo-payment-gateway.spec.ts:102` (a `sk_live_...` string inside a unit test, evidently a fixture for the live-key code path; value not reproduced here). Not verified to be non-functional; recommend confirming it is a dummy.
- Tracked env files: `.env.example`, `apps/mobile/.env.example` only (no real `.env` tracked).
- Tracked key/cert files (`*.pem|*.key|*.p12|*.jks|*.keystore`): none.
- Limitations: pattern list is narrow (no generic high-entropy, JWT, DB URL with password, Slack/Stripe-test patterns); history (772 commits) unscanned.

## 4. ESLint security rules

`eslint.config.mjs` extends `nx.configs["flat/base|typescript|javascript"]`, enforces `@nx/enforce-module-boundaries` and `@typescript-eslint/no-unused-vars`, then `eslint-config-prettier`. No `eslint-plugin-security`, `eslint-plugin-no-unsanitized` or `eslint-plugin-sonarjs` is configured. `@healthcare/ui` lint cannot start at all (see CODE_QUALITY_ARCHITECTURE_AUDIT.md QA-001), so no security-relevant rule was executed for that project.

## 5. CI security coverage

`.github/workflows/ci.yml` and `release.yml` contain no `pnpm audit`, CodeQL, Semgrep, Gitleaks, Trivy, ZAP or Dependabot/Renovate configuration (grep for these names in `.github/` returned nothing; no `dependabot.yml`, `renovate.json`, `.gitleaks.toml` or `.semgrep*` at the repo root).

## 6. Commands a maintainer should run for the rest

Run against a disposable environment, never production.

```
# Secrets, including full history
gitleaks detect --source . --log-opts="--all" --redact --report-format json --report-path gitleaks.json

# SAST (TypeScript/NestJS/Next)
semgrep scan --config p/typescript --config p/nodejs --config p/owasp-top-ten --config p/jwt --json -o semgrep.json apps libs

# Filesystem + dependency + IaC + Dockerfile scan
trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --format json -o trivy-fs.json .
trivy config infrastructure/

# DAST baseline (needs API running with a seeded, throw-away DB and OpenAPI at /api/docs, non-production only)
docker run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-api-scan.py -t http://host.docker.internal:3333/api/docs-json -f openapi -r zap-api.html
docker run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t http://host.docker.internal:3000 -r zap-staff.html
docker run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t http://host.docker.internal:3001 -r zap-portal.html

# Dependency audit with fix guidance
pnpm audit --prod
pnpm why next multer body-parser zod nodemailer
```

Burp Suite: manual authenticated testing of staff and MyHealth sessions (refresh-token flow, `X-Acting-For` proxy access, FHIR endpoints, signed document URLs). The OpenAPI document is served at `/api/docs` only when `NODE_ENV !== "production"` (`apps/api/src/app/configure-app.ts:34`), so DAST must run against a non-production profile.

## Findings

(Security scanning IDs are not part of the QA/PERF series; items that are quality or reliability issues are numbered QA-/PERF-. Items below use the QA series for continuity with the functional/quality files.)

### QA-101 CRITICAL Next.js versions in staff and portal have critical RCE advisories
- Location: `apps/staff/package.json:20`, `apps/portal/package.json:19` (`next ^16.3.6`, installed 16.3.6).
- Evidence: `pnpm audit --prod --json` 2026-11-02: two critical advisories (RCE in Image Optimization with SVG; RCE in `use cache` returning typed arrays), patched >=16.4.1; further high/moderate (Server Actions DoS, SSRF in image optimization, cache poisoning) patched >=16.3.8.
- Impact: unauthenticated remote code execution on the servers that hold session cookies for staff and patients, if the affected features are enabled/reachable. Reachability not tested.
- Recommended fix: upgrade `next` to >=16.4.1 in both apps; disable SVG in `images` config and unused image optimization until upgraded.
- Status: Open

### QA-102 HIGH Backend runtime dependencies with known DoS advisories
- Location: root `package.json` (`zod ^4.6.5` line 78, `nodemailer ^10.0.12` line 70), transitive `multer 2.4.0`, `body-parser`, `qs` via `@nestjs/platform-express`.
- Evidence: `pnpm audit --prod`: zod high (<4.6.6), multer high (<2.5.0), body-parser high, nodemailer moderate x5, qs moderate.
- Impact: request-triggered resource exhaustion on the API; nodemailer address-parser flaws can mis-address messages containing patient notices.
- Recommended fix: bump `zod`/`nodemailer`; add `pnpm-workspace.yaml` `overrides` for `multer`, `body-parser`, `qs` until `@nestjs/platform-express` updates.
- Status: Open

### QA-103 MEDIUM No security automation in CI or repository
- Location: `.github/workflows/ci.yml`, `.github/workflows/release.yml`; no `dependabot.yml`/`renovate.json`/gitleaks/semgrep config.
- Evidence: grep of `.github/` and repo root.
- Impact: advisories like QA-101/102 are not surfaced automatically; secrets are not scanned on push.
- Recommended fix: add `pnpm audit --prod --audit-level=high` (non-blocking first), CodeQL, Gitleaks and Dependabot; run ZAP baseline against a staging build.
- Status: Open

### QA-104 MEDIUM Dev/build tooling criticals (handlebars, storybook, shell-quote, vite/launch-editor, axios via nx)
- Location: `ts-jest`, `libs/ui` (`storybook`), `webpack-dev-server`, `nx`.
- Evidence: full `pnpm audit`: 6 critical, 33 high total; items not present in `--prod`.
- Impact: developer-machine and CI-runner exposure (Storybook dev server code injection from local network, `launch-editor` command execution on Windows).
- Recommended fix: upgrade Storybook >=10.6.2, `ts-jest`/handlebars >=4.7.10, nx's axios >=1.20.0; do not expose dev servers on shared networks.
- Status: Open

### QA-105 LOW Live-key-shaped string in a test fixture
- Location: `apps/api/src/app/adapters/paymongo-payment-gateway.spec.ts:102`.
- Evidence: regex match `sk_live_...`; value intentionally not reproduced.
- Impact: if real, a leaked payment key; if dummy, scanner noise.
- Recommended fix: confirm dummy; rename to an obviously fake value or build the string at runtime; add the file to the secret scanner allowlist.
- Status: Open

### QA-106 INFO No DAST/SAST/container results exist
- Evidence: section 1 (none of ZAP, Semgrep, Gitleaks, Trivy, Burp installed; Docker daemon not running).
- Impact: residual risk is unmeasured. Not tested.
- Recommended fix: run section 6 commands.
- Status: Open
