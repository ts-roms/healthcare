# Code Quality and Architecture Audit

Stage A (read-only). Date: 2026-11-02. Branch `release/v1.0.0`. Scope: `docs/audit/SYSTEM-FULL-AUDIT.md` Phases 9, 11-13. No source file was modified.

Environment: local Node v24.21.0, pnpm 10.33.0; `.nvmrc` pins Node 22 (QA-007).

## 1. Established earlier in this session (reused, not re-run)

- `nx run-many -t typecheck`: passed for all projects.
- `nx run-many -t test` (unit): passed for 27 projects.
- `nx run-many -t lint`: failed only in `@healthcare/ui:lint` (diagnosed below).

## 2. `@healthcare/ui:lint` failure (diagnosed)

Command: `pnpm nx run @healthcare/ui:lint --skip-nx-cache`, 2026-11-02, ESLint 9.39.5, Nx 23.2.1. Outcome: ESLint crashed on startup (non-zero exit); no source file was linted.

```
Oops! Something went wrong! :(
ESLint: 9.39.5
Error: Cannot find module 'eslint-plugin-react'
Require stack:
- node_modules/.pnpm/@nx+eslint-plugin@23.2.1_.../dist/src/flat-configs/react-jsx.js
- .../flat-configs/react-tmp.js
- .../@nx/eslint-plugin/dist/src/index.js
```

Root cause: `libs/ui/eslint.config.mjs:6` spreads `nx.configs["flat/react"]`, which `require`s `eslint-plugin-react` from inside `@nx/eslint-plugin`'s pnpm-isolated folder. The package exists only as a transitive dependency of `eslint-config-next` (`pnpm-lock.yaml:19993`), so pnpm's strict layout does not expose it to `@nx/eslint-plugin`.

How it was introduced: commit `db3d1bba chore(deps): remove twelve unused direct dependencies (audit D-01..D-12)` applied row D-10 of `docs/audit/2026-10-20-codebase-audit-report.md:128` ("`eslint-plugin-react` (dev): no config imports it; `eslint-config-next` depends on it"). The static scan missed the implicit consumer (`nx.configs["flat/react"]`). Root `package.json:107` still lists `eslint-plugin-react-hooks` but not `eslint-plugin-react`. D-09, D-11, D-12 (`@eslint/js`, `eslint-plugin-jsx-a11y`, `typescript-eslint`) were removed in the same commit; only the ui failure was observed, other implicit consumers were not checked.

CI impact: `.github/workflows/ci.yml` runs `nx affected -t lint`; any PR affecting `libs/ui` or its dependents fails (QA-001).

## 3. Circular dependency check

Method: `NX_DAEMON=false pnpm nx graph --file=<scratchpad>/graph.json`, then a DFS cycle search over `graph.dependencies` in Node (nothing installed). Result: 30 projects, 0 cycles, 0 projects missing a `type:*` or `scope:*` tag. Caveat: workspace-project level, static imports only; file-level cycles inside a project were not analysed (no madge/dpdm).

## 4. Module boundary rule integrity

`eslint.config.mjs` sets `@nx/enforce-module-boundaries` to `error` with layer constraints (`LAYERS`), scope constraints and `DOMAIN_SCOPES`.

- A domain scope may depend only on its own scope, `scope:shared` and `type:contract`. CLAUDE.md lists no `type:contract` library, so cross-domain imports are effectively blocked by lint and realised through ports plus API adapters, as documented.
- `scope:worker` may use `scope:shared` and `scope:interoperability`; `scope:api` may use all domains; `scope:mobile` only `type:domain`.
- `philhealth` is tagged `scope:interoperability` (same scope as `interoperability`), so the one-way dependency between the two is not lint-enforced.
- `eslint.config.mjs` files turn the rule off (intended).
- Not verified: that the rule actually fires in each project (the ui project could not start; the earlier session lint run passed the others with 0 errors).

## 5. `any`, suppressions and assertions

Method: `grep -rEn` over `apps/` and `libs/` `*.ts`/`*.tsx`, excluding `node_modules`, `dist`, `.next`, `.nx`, `worktrees`.

| Measure                                                             | Count                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `: any` / `as any` as types                                         | 0                              | All 13 raw matches are English prose in comments ("as any of them")                                                                                                                                                                                                                                                                                                                                                                        |
| `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`                     | 0                              |                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `eslint-disable`                                                    | 9 real (10 raw)                | `apps/staff/src/app/(staff)/doctors/[id]/practitioner-editor.tsx:43`, `.../offline/offline-workspace.tsx:104`, `.../patients/[id]/patient-qr-card.tsx:34`, `apps/staff/src/components/offline-banner.tsx:52`, `.../outside-results/report-preview.tsx:65`, `libs/core/src/lib/http/request-augmentation.ts:4`, `libs/interoperability/src/lib/instruments/instrument-messages.ts:72,142,148`, `libs/ui/src/healthcare/lab-worklist.tsx:84` |
| Non-null assertion (`x!` followed by `. ; ) ,`), grep approximation | 449 matches, 112 outside tests | Regex under-counts (`x![0]`, `x!` before other tokens)                                                                                                                                                                                                                                                                                                                                                                                     |
| `no-non-null-assertion` lint warnings                               | 972                            | NOT re-measured; taken from `docs/audit/2026-10-20-codebase-audit-report.md` section 7                                                                                                                                                                                                                                                                                                                                                     |

Type discipline is strong. Example guarded assertions: `libs/interoperability/src/lib/instruments/instrument-links.ts` (around lines 56-57, after length checks).

## 6. Test coverage gaps per library (file counts, not line coverage)

Method: non-test `.ts/.tsx` under `src` vs `*.spec.ts|*.test.ts(x)` (plus `test/`, `tests/`, `*.journey.ts`). Line coverage was NOT measured.

| Project                  | src files | test files | Comment                                                     |
| ------------------------ | --------: | ---------: | ----------------------------------------------------------- |
| libs/billing             |        25 |          1 | 7 billing API integration specs compensate                  |
| libs/inventory           |        18 |          1 | 4 integration specs                                         |
| libs/crm                 |        10 |          1 | `crm-outreach.int.spec.ts`                                  |
| libs/telemedicine        |        13 |          1 | `telemedicine.int.spec.ts`                                  |
| libs/audit               |         5 |          1 |                                                             |
| libs/auth                |        25 |          3 | many integration specs                                      |
| libs/ui                  |        93 |          4 | components rely on Storybook                                |
| libs/organization        |        19 |          2 |                                                             |
| libs/prescription        |        14 |          2 |                                                             |
| libs/care-plan           |         9 |          1 |                                                             |
| apps/notification-worker |         3 |          0 | none                                                        |
| apps/integration-worker  |         3 |          0 | none                                                        |
| apps/staff               |       545 |         56 |                                                             |
| apps/portal              |       131 |         21 |                                                             |
| apps/mobile              |        28 |          5 |                                                             |
| libs/clinic              |        82 |          8 | heavy integration coverage                                  |
| libs/patient             |        72 |         14 |                                                             |
| apps/api                 |        90 |        125 | 117 `*.int.spec.ts`, 869 test cases (grep of `it(`/`test(`) |

## 7. Dead code and the 2026-10-20 audit

- Priority 1 (34 unused directives, 16 unreferenced symbols, C-01 worker health, C-02 SimpleTable): applied. Grep confirms `VitalsDto`, `practitionersAt`, `useLiveQueue`, `patientLine`, `YAKAP_REGISTRATION_LABEL`, `releaseOrder`/`resultHistory`, `useProcedureTypes`, `PATIENT_BOOKING_RULES` no longer exist in `apps/`/`libs/` source. `addPlanItem` remains only in `libs/dental` (backend; intended).
- Priority 3 D-01..D-12 dependency removals: applied in `db3d1bba`; D-10 broke ui lint (QA-001).
- Priority 2 (C-03 `useServerAction`, C-04 core helpers, C-06) and C-10, R-04 (seven `.env.example` keys): not verified; treated as open.
- Priority 4 decisions (keep generator-only packages, knip in CI): `ci.yml` has no knip/jscpd step.

## 8. Other observations

- 135 migration files but 125 distinct numeric prefixes; ten prefixes appear twice (QA-006).
- `libs/reporting` correctly absent (planned, ADR-0011).
- Both Next.js apps declare `next ^16.3.6` (`apps/staff/package.json:20`, `apps/portal/package.json:19`); `pnpm audit` flags it (see AUTOMATED_SECURITY_SCAN_REPORT.md).

## Findings

### QA-001 HIGH `@healthcare/ui:lint` cannot start; CI lint gate broken

- Location: `libs/ui/eslint.config.mjs:6`; root `package.json` (missing devDependency); commit `db3d1bba`.
- Evidence: `Error: Cannot find module 'eslint-plugin-react'` raised from `@nx/eslint-plugin`; package only transitive (`pnpm-lock.yaml:19993`).
- Impact: `nx affected -t lint` fails for ui and dependents; the design system is currently unlinted.
- Recommended fix: re-add `eslint-plugin-react` (and check `eslint-plugin-jsx-a11y`, `@eslint/js`, `typescript-eslint`) as root devDependencies, or drop `nx.configs["flat/react"]` from the ui config.
- Status: Open

### QA-002 MEDIUM Dependency removals not re-validated with full lint

- Location: `docs/audit/2026-10-20-codebase-audit-report.md:127-130`, validation plan section 7.
- Evidence: the plan required lint/typecheck/build after removals; QA-001 shows it was not repeated after `db3d1bba`.
- Impact: tooling regressions slip through.
- Recommended fix: run `nx run-many -t lint typecheck build` on any manifest change; note that knip cannot see Nx flat-config consumers.
- Status: Open

### QA-003 LOW 972 `no-non-null-assertion` warnings

- Location: repo-wide; sample `libs/interoperability/src/lib/instruments/instrument-links.ts` (~56-57).
- Evidence: figure from the 2026-10-20 report (not re-measured).
- Impact: latent `undefined` at runtime; mostly guarded.
- Recommended fix: ratchet with `--max-warnings` in CI, address parsers and money code first.
- Status: Open

### QA-004 MEDIUM Thin unit-test files in billing, inventory, crm, telemedicine, ui; none in two workers

- Location: `libs/billing`, `libs/inventory`, `libs/crm`, `libs/telemedicine`, `libs/ui`, `apps/notification-worker`, `apps/integration-worker`.
- Evidence: section 6 file counts (line coverage unmeasured).
- Impact: money, stock and campaign rules are exercised only by DB-backed integration tests; worker bootstrap/shutdown untested.
- Recommended fix: pure-rule unit specs (invoice totals/VAT, FEFO, segment rules), worker smoke tests, coverage thresholds in CI.
- Status: Open

### QA-005 LOW No dead-code, duplication, dependency-policy or SAST step in CI

- Location: `.github/workflows/ci.yml`.
- Evidence: workflow has sync:check, prettier, lint, typecheck, test, integration, e2e, build, terraform only.
- Impact: earlier audit findings can recur; vulnerable dependencies are not caught.
- Recommended fix: scheduled knip/jscpd/`pnpm audit`/CodeQL jobs.
- Status: Open

### QA-006 LOW Duplicate migration number prefixes

- Location: `database/migrations/` (0052, 0058, 0061, 0067, 0068, 0079, 0080, 0081, 0083, 0084 each twice).
- Evidence: `ls database/migrations | cut -c1-4 | sort | uniq -d`.
- Impact: docs such as "migration 0079" are ambiguous; ordering of same-prefix files depends on filename sort.
- Recommended fix: keep applied files unchanged, add a unique-prefix check to `db:migrate:new`/CI, cite full filenames in docs.
- Status: Open

### QA-007 LOW Local Node differs from `.nvmrc`

- Location: `.nvmrc` (22) vs observed v24.21.0.
- Evidence: `node -v` this session.
- Impact: audit results come from Node 24 and may differ from CI.
- Recommended fix: `nvm use` / `engine-strict` before audits.
- Status: Open

### QA-008 INFO Type safety and architecture hygiene are good

- Evidence: 0 real `any`, 0 `@ts-ignore`, 9 `eslint-disable`, 0 project cycles, all 30 projects tagged.
- Status: Open (informational)
