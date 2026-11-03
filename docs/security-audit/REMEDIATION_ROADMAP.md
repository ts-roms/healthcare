# Remediation roadmap (proposal, not started)

Nothing here has been implemented. Stage B starts only on explicit approval. Register IDs refer to `VULNERABILITY_REGISTER.md`. Every fix needs: reproduction, unit + integration + security-regression test, relevant existing tests, review, documentation update. Database changes only as new forward migrations.

## Batch 1 — Critical

| ID    | Root cause    | Proposed solution                                                                                                                                                                             | Modules                 | Dependencies      | Regression risk            | Required tests                                | Priority |
| ----- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------- | -------------------------- | --------------------------------------------- | -------- |
| VR-01 | `next` 16.3.6 | Upgrade staff and portal to >= 16.4.1 (re-check the Next.js docs in `node_modules/next/dist/docs` for breaking changes); meanwhile disable SVG and unused image optimization in `next.config` | apps/staff, apps/portal | lockfile, `sharp` | Medium (framework upgrade) | typecheck, vitest, Playwright journeys, build | P0       |

## Batch 2 — High and sensitive data exposure

| ID           | Root cause                                           | Proposed solution                                                                                                                                                | Modules                       | Dependencies                       | Regression risk                  | Required tests                                                            | Priority        |
| ------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------- | -------------------------------- | ------------------------------------------------------------------------- | --------------- |
| VR-02        | No privilege-containment rule in user administration | An actor may only act on members whose effective permissions and scopes are a subset of their own; platform admins excepted                                      | libs/auth users.service       | none                               | Medium (changes admin workflows) | integration: lower admin vs higher account for reset/suspend/revoke/grant | P0              |
| VR-03, VR-24 | Restricted role optional                             | Fail start-up (or readiness) in production when connected as owner/superuser or when `healthcare_app` privileges are absent; make the role required in Terraform | libs/core database, terraform | operator action to create the role | Medium (deployment)              | start-up test; runbook                                                    | P0              |
| VR-04        | `observe` default                                    | Move production to `enforce` once `db.context_missing` is clean for 30 days (already the plan in docs); set explicitly in Terraform and `.env.example`           | libs/core, terraform          | VR-03                              | High if premature                | int tests already run in enforce                                          | P1              |
| VR-05        | Raw exception stack logged                           | Log error class, message with parameters stripped, and a request id; verify what drizzle includes                                                                | libs/core exception filter    | none                               | Low                              | unit: PHI sentinel in params never reaches log                            | P0              |
| VR-06, VR-26 | Vulnerable transitive/direct versions                | Upgrade zod >= 4.6.6, multer, body-parser, nodemailer; use `pnpm-workspace.yaml` overrides where parents lag                                                     | root                          | lockfile                           | Low-Medium                       | full unit + integration                                                   | P1              |
| VR-07        | No pool `error` listener                             | Attach an `error` handler (log, no crash) in `DatabaseModule`/`ContextPool`                                                                                      | libs/core                     | none                               | Low                              | unit with emitted pool error                                              | P0              |
| VR-08        | Missing `eslint-plugin-react`                        | Re-add as direct devDependency (or drop `flat/react` from libs/ui config)                                                                                        | libs/ui, root                 | lockfile                           | Low                              | `nx lint @healthcare/ui`                                                  | P0 (CI blocker) |

## Batch 3 — Authentication, authorization, encryption, validation

VR-09 (scope-contained grants, no self-grant), VR-10 (facility filters on id-scoped reads and patient master), VR-11 (offer required MFA for administrators by default), VR-21 (reject placeholder secrets in production validation and Terraform), VR-22 (per-purpose keys with key ids; bind TOTP ciphertext to account via AAD; versioned format with migration of existing secrets), VR-28 (token-tampering tests), VR-12 (decide fail-open vs fail-closed for credential routes; at least per-process fallback limiter on login), VR-13 (validate push endpoints against known push-service hosts, block private ranges, no redirects), VR-14 (magic-byte check; require scanner in production or surface `not_scanned` to users), VR-18 (mask identifiers server-side unless the caller needs the full value), VR-19 (log destinations only in a test mailbox, never reset links), VR-18/19 low regression risk; VR-09/10/22 medium to high (token and authorization behavior) and need an explicit rollout plan. Dependencies: VR-22 needs a data migration plan before any key change.

## Batch 4 — Medium vulnerabilities and functional defects

VR-15 (purge expired idempotency rows; shorten or encrypt bodies), VR-16 (move audit-partition removal behind a separate privileged role), VR-17 (add RLS to child tables; restrict shared-role writes; add immutability triggers), VR-23 (CSP, HSTS, frame-ancestors, nosniff in both Next.js apps), VR-25 (CI: dependency audit, secret scanning, SAST, run on push to protected branches), VR-27 (pool timeouts, bounded concurrency, MLLP buffer cap, graceful shutdown), VR-29 (billing E2E, pagination and concurrency tests), VR-20 (scheduled backup, a restore drill and recorded RTO/RPO).

## Batch 5 — Low, performance, architecture, debt

Low/INFO items listed in the register (UUID validation on 22 handlers, GET state change, service-worker cache and URL handling, Android backup flag, fixture string, thin test coverage in five libraries, 972 non-null-assertion warnings, scanner tooling to be installed and run: Semgrep, Gitleaks, Trivy, ZAP).

## Suggested order

1. VR-08 and VR-07 (small, unblock CI and crash risk), VR-05 (small, PHI), VR-01 (dependency upgrade).
2. VR-02 and VR-03/24, then the RLS enforcement plan VR-04.
3. Batch 3 items, each behind its own tests.
4. Batches 4 and 5.

Then re-test: run the full unit, integration (isolated database) and E2E suites, install and run the scanners, and only then mark findings Verified Fixed.
