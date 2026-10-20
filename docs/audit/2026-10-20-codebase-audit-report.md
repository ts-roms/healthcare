# Codebase audit — unused code, dependencies and duplicate implementations

Run on 2026-10-20 against `main` at `2e4e996` following `docs/audit/SYSTEM-AUDIT.md`. Findings first (nothing changed while
they were gathered); the cleanup actually applied, and its validation, are in the change summary at the end.

## How the audit was run

| Step         | Tool / method                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Baseline     | `nx run-many -t lint typecheck` (all 30 projects, cache skipped); `nx run-many -t test` (all projects)                                                                         |
| Unused code  | knip 5 (`pnpm dlx`, not added to the repo) over the pnpm workspace, twice: default, and with `ignoreExportsUsedInFile` to separate "never referenced" from "only used in file" |
| Dependencies | knip's dependency pass, then every flagged package checked by grep over source, CSS, configs, scripts and CI, and `pnpm why` for transitive paths                              |
| Duplicates   | jscpd 4 (`pnpm dlx`) over `apps/` and `libs/` (≥ 10 lines / 80 tokens, tests and stories excluded), every clone pair read and classified                                       |
| Env vars     | every key in `.env.example` grepped for a reader; every key the config schema reads checked against `.env.example`                                                             |
| Markers      | grep for `@deprecated`, `TODO`, `FIXME`, `HACK`, `legacy`, commented-out code                                                                                                  |

The nested worktrees under `.claude/worktrees/` (git-ignored) were excluded from every search. The analysis tools were run with
`pnpm dlx`; no dependency was added, no lockfile touched.

## 1. Executive summary

**Health.** The codebase is in good shape for its size (≈1,550 TypeScript files, ≈219k lines, 30 projects). The baseline
lint and typecheck pass on every project with 0 errors. ESLint already fails the build on unused variables and imports
(`@typescript-eslint/no-unused-vars` as an error) and the backend tsconfig sets `noUnusedLocals`, so the classic "unused
import / unused local" category is empty by construction. No `TODO`/`FIXME`/`@deprecated` markers and no commented-out code
were found. Every key in `.env.example` has a reader. Copy-paste duplication measured by jscpd is 0.64 % of lines.

**Findings by category**

| Category                                                                   |                         Count | Acted on in this pass                    |
| -------------------------------------------------------------------------- | ----------------------------: | ---------------------------------------- |
| Unused `eslint-disable` directives (lint-verified)                         |                            34 | yes                                      |
| Exports never referenced anywhere (values)                                 |                            10 | yes                                      |
| Exported types never referenced anywhere                                   |                             6 | yes                                      |
| Dead alias (same value exported twice, old name unused)                    |                             1 | yes                                      |
| Symbols exported but used only inside their own file (style, no dead code) |                         ≈ 300 | no — churn without behavioral value      |
| Unused files                                                               |   0 (41 flagged, all tooling) | —                                        |
| Direct dependency declarations with no importer                            |        12 removable, 4 "keep" | no — manifest/lockfile change, see §6 P3 |
| Duplicate implementations (69 clone pairs → 12 findings)                   | 3 consolidated, 9 recommended | partly                                   |
| Lint warnings `no-non-null-assertion`                                      |                           972 | no — style rule, not dead code           |

**High-risk items needing investigation:** none. Nothing found touches authorization, audit, billing or clinical rules.

**Main limitations.** Unreachable branches and always-false conditions were not hunted by hand across 219k lines; the
type-checker and ESLint's `no-unreachable`/`no-constant-condition` are the only coverage. Dynamic usage (NestJS DI,
Next.js file routes, server actions, Playwright `testMatch`, service workers) is why knip's "unused files" list is all
false positives; every export it flagged was re-checked by grep before being listed. Integration and E2E tests were not run
as part of the baseline (they need PostgreSQL/Redis and a browser; the cleanup touches nothing they cover that unit tests,
typecheck and builds do not).

## 2. Unused code inventory

Confidence: **Confirmed** = flagged by the tool and a word-boundary grep over `apps`, `libs`, `tools` (tests included)
finds only the definition. Risk is Low for every row (no behavior; removal fails typecheck/lint if a reference was missed).

### 2a. Unused `eslint-disable` directives (34) — Confirmed, Remove

ESLint reports each as "Unused eslint-disable directive (no problems were reported)": the rule it silences no longer fires
on that line, so the comment is dead.

| Where                                                                                                                                                                                                                                                                                                | Directive                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `jest.config.cts` in `apps/api` (+ `jest.integration.config.cts`), `apps/instrument-gateway`, and `libs/{audit,auth,billing,care-plan,clinic,core,crm,dental,documents,interoperability,inventory,laboratory,notification,organization,patient,pdf,philhealth,prescription,telemedicine}` — 22 files | `/* eslint-disable */` on line 1 (Nx scaffold)                      |
| `libs/interoperability/src/lib/fhir/{fhir,history,immunization,procedures}.spec.ts`, `libs/interoperability/src/lib/fhir-import/{inbound,inbound-history,inbound-immunization}.spec.ts`, `apps/api/test/{fhir,fhir-dental,fhir-external,lab-labels-archive,patient-history}.int.spec.ts` — 12 files  | `// eslint-disable-next-line @typescript-eslint/no-require-imports` |

### 2b. Exports never referenced (Confirmed, Remove)

| ID   | File                                                                       | Symbol                                                   | Evidence                                                                                                                                                                                                                                          |
| ---- | -------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U-01 | `libs/clinic/src/lib/clinic.dto.ts:256`                                    | `class VitalsDto`                                        | No controller or service references it; `vitalsSchema` itself stays (used by `recordVitalsSchema`, `checkInSchema`, `VitalsInput`).                                                                                                               |
| U-02 | `apps/portal/src/lib/booking.ts:63`                                        | `practitionersAt()`                                      | Not called by any page, component or test since the booking screens were built (commit `3a4c461`).                                                                                                                                                |
| U-03 | `apps/staff/src/components/live-queue.tsx:104`                             | `useLiveQueue()`                                         | Superseded by `useQueueUpdates()` in the same file; its last caller went in `c557cee` (lab realtime).                                                                                                                                             |
| U-04 | `apps/staff/src/lib/lab-mapping.ts:156`                                    | `patientLine()`                                          | No caller, no test.                                                                                                                                                                                                                               |
| U-05 | `apps/staff/src/lib/demo-data.ts`                                          | `getPatients()`, `getLabWorklist()`, `getAppointments()` | The only remaining demo screen (`/preview/patient-360`) calls `getPatientChart` (and through it `getPatient`). The three were left behind when the dashboard, worklist and appointments screens were connected to the API (`5385c61`, `29d5b2d`). |
| U-06 | `apps/staff/src/components/yakap-registration-badge.tsx:12`                | `YAKAP_REGISTRATION_LABEL`                               | Derived from `STATUS` but never read; the badge reads `STATUS` directly.                                                                                                                                                                          |
| U-07 | `apps/staff/src/app/(staff)/dental/actions.ts:159`                         | server action `addPlanItem()`                            | No form calls it (plans are created with their items; `createTreatmentPlan`).                                                                                                                                                                     |
| U-08 | `apps/staff/src/app/(staff)/laboratory/actions.ts:129,152`                 | server actions `releaseOrder()`, `resultHistory()`       | No screen calls them (release goes through `signResult(step: "release")`; history is loaded server-side on the patient record). The API routes they wrap stay.                                                                                    |
| U-09 | `apps/staff/src/app/(staff)/dental/patients/[id]/procedure-fields.tsx:117` | `useProcedureTypes()`                                    | No component uses it.                                                                                                                                                                                                                             |
| U-10 | `libs/clinic/src/lib/domain/patient-booking.ts:117`                        | `PATIENT_BOOKING_RULES` (= `DEFAULT_BOOKING_RULES`)      | Kept "for callers that only need the platform's defaults" — there are none in `apps`, `libs` or tests.                                                                                                                                            |

### 2c. Exported types never referenced (Confirmed, Remove)

| ID   | File                                                                           | Type                         | Note                                                                   |
| ---- | ------------------------------------------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------- |
| U-11 | `apps/api/src/app/management-dashboard/management-dashboard.definitions.ts:48` | `MetricKey`                  |                                                                        |
| U-12 | `apps/api/src/app/management-dashboard/management-report.schema.ts:62`         | `ManagementReportFileRecord` | the other `$inferSelect` aliases in the file are used; this one is not |
| U-13 | `apps/staff/src/lib/api/types.ts:11`                                           | `ApiErrorBody`               | a stale copy; the one in `@healthcare/web-session` is the one in use   |
| U-14 | `apps/staff/src/lib/patient-edit.ts:221`                                       | `PreferenceKey`              |                                                                        |
| U-15 | `apps/staff/src/lib/allergy-form.ts:32`                                        | `AllergyPayload`             | `AllergyForm` (the input side) is what the form uses                   |
| U-16 | `apps/staff/src/lib/offline/outbox.ts:11`                                      | `OfflineActionKind`          | the union is restated inline on each payload type                      |

### 2d. Not unused — knip false positives, verified and kept (Intentional)

| What knip flagged                                                                                            | Why it is used                                                                                           |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 24 `jest.config.cts` / `jest.integration.config.cts`, `jest.preset.js`                                       | picked up by `@nx/jest/plugin` and the Jest preset                                                       |
| 4 `webpack.config.js`                                                                                        | `@nx/webpack/plugin` (knip's webpack plugin had to be disabled: it cannot evaluate the Nx app plugin)    |
| `apps/api/test/one-query-per-connection.ts`                                                                  | `setupFiles` of the integration Jest config                                                              |
| `apps/e2e/support/*.ts`, `apps/e2e/tests/*.journey.ts`, `setup.setup.ts` and the exports of `support/env.ts` | Playwright `testDir`/`testMatch`; the env exports are imported by the journeys and the database preparer |
| `apps/staff/public/sw.js`, `apps/portal/public/sw.js`                                                        | registered at runtime by URL (`navigator.serviceWorker.register("/sw.js")`)                              |
| `apps/staff/src/lib/demo-data.ts` as a whole, `@healthcare/domain/fixtures`                                  | the labelled design demo at `/preview/patient-360` and the Storybook stories (CLAUDE.md)                 |

### 2e. Exported but used only in their own file (≈ 300 symbols) — Keep

Mostly Zod schemas exported next to the `createZodDto` class built from them, constants and view types. Dropping the
`export` keyword is a style change with no behavioral value and large churn; a few DTO schemas are also exported on purpose
for tests. Not acted on. (Full list available from knip's default run.)

## 3. Dependency audit

Verification for every row: grep for `from "<pkg>"`/`require("<pkg>")`/`@import "<pkg>"` across the project's source,
CSS and configs; `pnpm why` for the transitive path; scripts, CI (`.github/workflows/ci.yml`), `railway.json` and
`nx.json` plugins checked.

### 3a. Declared but not imported by the declaring project — Remove (Confirmed; Low risk)

| ID   | Manifest                                | Package                        | Purpose / evidence                                                                                                                                      |
| ---- | --------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | `apps/staff/package.json`               | `date-fns`                     | no import in `apps/staff/src`; the design system (`libs/ui`) uses and declares its own                                                                  |
| D-02 | `apps/portal/package.json`              | `date-fns`                     | same as D-01                                                                                                                                            |
| D-03 | `apps/staff/package.json`               | `@fontsource-variable/inter`   | the app's `globals.css` imports only Plus Jakarta Sans and sets `--font-sans-face` to it; Inter is imported only by Storybook (`libs/ui` devDependency) |
| D-04 | `apps/portal/package.json`              | `@fontsource-variable/inter`   | same as D-03                                                                                                                                            |
| D-05 | `apps/integration-worker/package.json`  | `@healthcare/audit`            | nothing in `apps/integration-worker/src` imports it; `@healthcare/interoperability` declares it for itself                                              |
| D-06 | `apps/integration-worker/package.json`  | `@nestjs/testing` (dev)        | the worker has no spec files                                                                                                                            |
| D-07 | `apps/notification-worker/package.json` | `@nestjs/testing` (dev)        | the worker has no spec files                                                                                                                            |
| D-08 | root `package.json`                     | `jest-util` (dev)              | imported by nothing; only reached transitively through Jest                                                                                             |
| D-09 | root `package.json`                     | `@eslint/js` (dev)             | no config imports it; `eslint` depends on it itself                                                                                                     |
| D-10 | root `package.json`                     | `eslint-plugin-react` (dev)    | no config imports it; `eslint-config-next` depends on it itself (`libs/ui` imports `eslint-plugin-react-hooks`, which stays)                            |
| D-11 | root `package.json`                     | `eslint-plugin-jsx-a11y` (dev) | same as D-10                                                                                                                                            |
| D-12 | root `package.json`                     | `typescript-eslint` (dev)      | no config imports it (`@nx/eslint-plugin` brings its own `@typescript-eslint/*`); `eslint-config-next` depends on it itself                             |

Removal risk is low for all twelve, but each removal changes `pnpm-lock.yaml`, so they are left for a separate, reviewable
commit (§6, Priority 3): edit the manifests, run `pnpm install` with the pinned pnpm 10.33.0, then lint, typecheck, build
and Storybook.

### 3b. Flagged by the tool but required — Keep (Intentional)

| Manifest                             | Package                                                 | Why it stays                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| api, workers, gateway                | `tslib`                                                 | `importHelpers: true` in `tsconfig.node.json`: emitted code requires it at runtime                                                                |
| `apps/api`                           | `pdfkit`                                                | webpack `ExternalsPlugin` keeps it out of the bundle; it must resolve from `apps/api/node_modules` at runtime (documented in `webpack.config.js`) |
| root                                 | `@swc/helpers`, `@swc/jest`                             | `.spec.swcrc` sets `externalHelpers: true`; `@swc/jest` is the transform in every `jest.config.cts`                                               |
| root                                 | `ts-node`, `jest-environment-node`                      | Jest loads the root `jest.config.ts` through ts-node; the environment is the Nx convention                                                        |
| root                                 | `@nx/nest`, `@nx/node`, `@nx/web`, `@nestjs/schematics` | generator-only packages (no runtime or CI use). Keeping them is a team decision; listed under Priority 4                                          |
| staff, portal, ui                    | `tailwindcss`, `tw-animate-css` (ui)                    | `@import "tailwindcss"` / `@import "tw-animate-css"` in CSS, which knip does not parse                                                            |
| `apps/mobile`                        | `react-native-worklets`, `@react-native/metro-config`   | peer dependencies of `react-native-reanimated` 4 and `react-native` 0.86 (the lockfile resolves RN against it)                                    |
| `apps/e2e`                           | `pg`, `@types/pg`, `otplib`, `@node-rs/argon2`          | imported by `support/*.ts` (knip missed the Playwright entries)                                                                                   |
| staff, portal (`postcss.config.mjs`) | `postcss` "unlisted"                                    | Next.js bundles PostCSS; nothing to add                                                                                                           |

No duplicated or overlapping libraries were found (one HTTP client, one validation library, one date library, one ORM).
Package upgrades were out of scope and none were made.

## 4. Duplicate implementation inventory

jscpd found 69 exact clone pairs. Read and grouped:

| ID   | Duplicated implementation                                                                                                                                                                                                                                                                                                       | Locations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Behavioral differences                                                                                                                                                                                                                                                                                                        | Classification / canonical                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | `startWorkerHealth()` — `/live` + `/ready` on `HEALTH_PORT` for a queue worker                                                                                                                                                                                                                                                  | `apps/notification-worker/src/health.ts`, `apps/integration-worker/src/health.ts` (27 lines, byte-identical)                                                                                                                                                                                                                                                                                                                                                                                                                                                        | none                                                                                                                                                                                                                                                                                                                          | **Confirmed — consolidated** into `libs/core` next to `startHealthServer` (both workers already depend on core)                                                                                                                           |
| C-02 | `SimpleTable` and `Figure` presentational components                                                                                                                                                                                                                                                                            | `apps/staff/.../inventory/valuation/page.tsx`, `.../laboratory/reagents/page.tsx`, `.../management/page.tsx` (SimpleTable ×3, Figure ×2 identical; management's `Figure` is a richer variant)                                                                                                                                                                                                                                                                                                                                                                       | management's `SimpleTable` keys headers by `${h}-${i}`; the others by `h`                                                                                                                                                                                                                                                     | **Confirmed — consolidated** into `apps/staff/src/components/simple-table.tsx` (the safer key kept); management keeps its own `Figure`                                                                                                    |
| C-03 | "run a server action, toast the outcome, refresh" hook (`useRun`/`useSubmit`/`useAction`/inline `act`)                                                                                                                                                                                                                          | 20 named copies in the staff app (`schedule-forms`, `patient-account`, `billing-profile`, `billing-settings`, `inventory-catalog`, `compliance-forms`, `lab-catalog`, `reference-labs`, `instrument-register`, `qc-workspace`, `quality-ui` (exported), `send-outs`, `workbench-detail`, `edit-forms`, `review-actions`, `integrity-forms`, `retention-forms`, `reporting-settings`, `history-panels`, `invoice-action`) + 6 inline closures (`philhealth-eligibility`, `case-review`, `dental-settings`, `supply-settings`, `supply-templates`, `allergies-panel`) | 4 variants: (a) refresh on success only vs always; (b) `onChanged()` callback instead of `router.refresh()` (lab workbench, send-outs); (c) field errors / error state instead of a toast (`edit-forms`, `history-panels`); (d) extras: invoice context update (`invoice-action`), `onFailure` interceptor (`review-actions`) | **Probable — recommend** one `useServerAction({ onSuccess, refresh })` in `apps/staff/src/lib/` covering (a) and (b), used by ≈ 22 files; (c) and (d) stay local. Not done here: 26 files, UI behavior to compare per screen (Priority 2) |
| C-04 | `found()`, `assertVersion()`, `publicView()`/`strip()`                                                                                                                                                                                                                                                                          | `libs/{billing,clinic,dental,inventory,laboratory}/src/lib/*-support.ts` (identical bodies; `dental`/`inventory` name the view helper `strip`)                                                                                                                                                                                                                                                                                                                                                                                                                      | none                                                                                                                                                                                                                                                                                                                          | **Probable — recommend** moving the three to `libs/core` (`errors` already holds the error classes they throw) and importing from `@healthcare/core`; ≈ 60 importing files, so a separate mechanical commit (Priority 2)                  |
| C-05 | Web Push helpers `urlBase64ToUint8Array`, `bytesToBase64Url`, `pushSupport`; `PushDevices` component                                                                                                                                                                                                                            | `apps/staff/src/lib/push.ts` ↔ `apps/portal/src/lib/push.ts`; `apps/staff/.../notifications/push-devices.tsx` ↔ `apps/portal/.../notification-settings/push-devices.tsx`                                                                                                                                                                                                                                                                                                                                                                                            | only the user-facing wording of `pushMessage` (staff vs patient) and the server actions each app calls                                                                                                                                                                                                                        | **Needs investigation — recommend** sharing the three pure helpers (and possibly a headless hook) from a shared frontend library; which one (`libs/ui` is React UI, `libs/web-session` is server-side) is a design decision               |
| C-06 | Inventory supply adapters `AppDentalSupplies` ↔ `AppProcedureSupplies`                                                                                                                                                                                                                                                          | `apps/api/src/app/adapters/dental-adapters.ts:63-87`, `.../immunization-adapters.ts:73-97`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | only the source constant, categories and port interface                                                                                                                                                                                                                                                                       | **Probable — recommend** a small shared base in `apps/api/src/app/adapters/` (Priority 2)                                                                                                                                                 |
| C-07 | Supply-use services `ProcedureSuppliesService` ↔ `DentalSuppliesService`                                                                                                                                                                                                                                                        | `libs/clinic/src/lib/procedures/procedure-supplies.service.ts`, `libs/dental/src/lib/supplies/dental-supplies.service.ts` (6 clone blocks, 12–36 lines)                                                                                                                                                                                                                                                                                                                                                                                                             | each lib owns its own tables and port                                                                                                                                                                                                                                                                                         | **Intentional** — domain boundary (clinic and dental never import each other); the pure rules are already shared in `libs/core/supplies/supply-use.ts` (documented in CLAUDE.md). Further extraction only if a third domain appears       |
| C-08 | `RELATIONSHIP_LABEL` (family-history relative labels)                                                                                                                                                                                                                                                                           | `apps/staff/src/lib/history-form.ts:26-48` ↔ `libs/clinic/src/lib/history/history.rules.ts:72-94`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | none                                                                                                                                                                                                                                                                                                                          | **Intentional (boundary)** — the staff app may not import backend libraries; the only shared home would be `libs/domain`, which no backend library imports today. Keep in sync by review (Priority 4)                                     |
| C-09 | Session gate `proxy()` and the "service busy" page                                                                                                                                                                                                                                                                              | `apps/staff/src/proxy.ts` ↔ `apps/portal/src/proxy.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | different public paths, the portal's acting-for redirect, different wording                                                                                                                                                                                                                                                   | **Intentional** — documented as "same model as the staff app"; the shared pieces (`refreshTokens`, `forwardedHeaders`) already live in `@healthcare/web-session`                                                                          |
| C-10 | Small date/file helpers: `addDays`+`daysBetween`; `fileSize`; `previousDay`                                                                                                                                                                                                                                                     | `apps/staff/src/lib/communications.ts` ↔ `prescription-list.ts`; `apps/portal/src/lib/conversations.ts` ↔ `apps/staff/src/lib/messaging-mapping.ts`; `libs/billing/src/lib/billing-support.ts`                                                                                                                                                                                                                                                                                                                                                                      | none                                                                                                                                                                                                                                                                                                                          | **Probable — recommend** (Priority 3): `addDays`/`daysBetween` into `apps/staff/src/lib/clinic-mapping.ts` beside `shiftDate`; `fileSize` into `@healthcare/ui`                                                                           |
| C-11 | Page scaffolds: patient sub-page headers (`immunizations`, `history`, `procedures`, `timeline`), inventory list/detail pages' facility guard, the Nx-style catalog tables (`procedure-catalog` ↔ `vaccine-catalog`), waitlist tables, pagination nav (`communications` ↔ `admin/audit`), `new-conversation-form` ↔ `reply-form` | staff and portal screens, 12–24 lines each                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | each renders a different screen; the matching lines are JSX layout                                                                                                                                                                                                                                                            | **Intentional** — presentational repetition the design system already keeps consistent; extracting per-screen wrappers would not make the screens clearer                                                                                 |
| C-12 | Drizzle table shapes (`lab_panel` ↔ `lab_test`, dental supply-use ↔ clinic supply-use tables, perio rows), repeated `select … where organization/facility/id` finders                                                                                                                                                           | `libs/laboratory/src/lib/laboratory.schema.ts`, `libs/dental/src/lib/dental.schema.ts` ↔ `libs/clinic/src/lib/procedures/procedure.schema.ts`, `inventory-queries.ts` ↔ `inventory-stock.service.ts`, `purchase-order.service.ts` ↔ `supplier-invoice.service.ts`, `doh-reports.service.ts` ↔ `reference-lab-submissions.service.ts`, `portal-consents.service.ts` (self)                                                                                                                                                                                           | different tables / resources                                                                                                                                                                                                                                                                                                  | **Intentional** — "each library mirrors only its own tables" (CLAUDE.md); the query finders differ by table and lock                                                                                                                      |

No repeated **business rule** across frontend and backend was found beyond C-08 (display labels). The frontend
drug–allergy class map is a labelled demo and the server check is authoritative, as CLAUDE.md records.

## 5. Dead code and redundant logic

| ID   | Finding                                                                                                                                                                                                                                 | Classification                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | 34 `eslint-disable` comments that silence nothing (§2a)                                                                                                                                                                                 | Confirmed — removed                                                                                                                       |
| R-02 | `PATIENT_BOOKING_RULES` alias kept for "old" callers that no longer exist (U-10)                                                                                                                                                        | Confirmed — removed                                                                                                                       |
| R-03 | `YAKAP_REGISTRATION_LABEL` derived from `STATUS` and never read (U-06)                                                                                                                                                                  | Confirmed — removed                                                                                                                       |
| R-04 | Seven config keys the app reads are not listed in `.env.example`: `AUDIT_RETENTION_MONTHS`, `CLAMAV_TIMEOUT_MS`, `DATABASE_POOL_MAX`, `DATABASE_RLS_MODE`, `FHIR_CODE_SYSTEMS`, `PAYMONGO_API_BASE` (`NODE_ENV` is set by the platform) | Not dead code — a documentation gap. Recommend adding them (commented) to `.env.example` so operators can find them (Priority 3)          |
| R-05 | Unreachable branches, always-false conditions, obsolete feature flags, duplicate routes                                                                                                                                                 | None found by the compiler, ESLint or review of the clone pairs. No feature-flag system exists; configuration switches are all documented |
| R-06 | 972 `no-non-null-assertion` warnings (mostly tests)                                                                                                                                                                                     | Style, not dead code; out of this audit's scope                                                                                           |

## 6. Prioritized cleanup plan

**Priority 1 — safe, high-confidence (done in this pass, see the change summary)**

1. Remove the 34 unused `eslint-disable` directives (R-01).
2. Remove the 10 unreferenced exported values and 6 unreferenced types (U-01 … U-16), including the dead alias.
3. Consolidate the byte-identical worker health file into `libs/core` (C-01).
4. Consolidate `SimpleTable`/`Figure` in the staff app (C-02).

**Priority 2 — duplicate logic consolidation (recommended, not done here)**

1. C-03: one `useServerAction` hook for the staff app (≈ 22 of 26 sites), screen by screen with a visual check.
2. C-04: `found`/`assertVersion`/`publicView` into `libs/core`; mechanical import rewrite in five libraries.
3. C-06: shared base for the two inventory supply adapters.
4. C-05: shared Web Push helpers once their home is decided.

**Priority 3 — dependency and architectural cleanup (recommended, one reviewable commit)**

1. D-01 … D-12: remove the twelve unused direct declarations, `pnpm install` with pnpm 10.33.0, then lint/typecheck/build/`build-storybook`.
2. C-10: the small date and file-size helpers.
3. R-04: document the seven missing keys in `.env.example`.

**Priority 4 — needs a decision**

1. Generator-only packages (`@nx/nest`, `@nx/node`, `@nx/web`, `@nestjs/schematics`): keep for scaffolding or drop.
2. C-08: whether `libs/domain` should become importable by backend libraries so display labels are shared; today it is not.
3. The ≈ 300 in-file-only exports (§2e): a lint rule (`import/no-unused-modules` or knip in CI) if the team wants them policed.

## 7. Validation plan

Baseline (before any change, cache skipped): `nx run-many -t lint typecheck` → 30 projects, 0 errors (998 warnings: 972
non-null assertions, 34 unused directives, before the removal); `nx run-many -t test` → recorded in the change summary.

After each cleanup group: `nx run-many -t lint typecheck` (expect 0 errors and exactly 34 fewer warnings), `nx run-many -t
test` (same pass/fail set as the baseline), `nx sync:check`, `prettier --check`, and `nx run-many -t build` for the
deployables the changes reach (`api`, `notification-worker`, `integration-worker`, `instrument-gateway` for the core change;
`staff` for the component change). Integration tests and E2E are unaffected by these changes (no route, schema, migration
or workflow changed) and were not run.

Bundle size: not measured. The removed code is tree-shaken or unused at runtime, so no change is expected.

## 8. Change summary (Priority 1 applied)

Everything below is in the working tree, **uncommitted**, for review. Nothing else in the tree was touched (the only
pre-existing untracked path, `docs/audit/`, holds the prompt and this report).

### Totals

| Measure                                   | Count                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Findings discovered                       | 34 directives + 16 unreferenced symbols + 1 dead alias + 12 removable dependencies + 12 duplicate groups + 1 env-doc gap = 76 |
| Findings resolved                         | 54 (34 directives, 17 symbols/alias, 3 duplicate groups: C-01, C-02 and the dead-alias duplicate)                             |
| Findings deferred (recommended, not done) | 22 (12 dependency rows, 9 duplicate groups, 1 env-doc gap)                                                                    |
| Unused imports / variables removed        | 1 import (`React` in `procedure-fields.tsx`, orphaned by U-09); none elsewhere — lint already forbids them                    |
| Functions / constants / types removed     | 9 functions (incl. 3 server actions, 2 hooks), 2 constants, 1 DTO class, 6 types                                              |
| Files removed                             | 2 (`apps/notification-worker/src/health.ts`, `apps/integration-worker/src/health.ts`)                                         |
| Files added                               | 2 (`libs/core/src/lib/health/worker-health.ts`, `apps/staff/src/components/simple-table.tsx`) + this report                   |
| Duplicate implementations consolidated    | 2 (worker health → `libs/core`; `SimpleTable`/`Figure` → one staff component)                                                 |
| Dependencies removed                      | 0 (12 recommended; manifest and lockfile left untouched on purpose)                                                           |
| Files modified                            | 59 tracked files, +10 / −310 lines (34 of them a single deleted comment line); 1 doc line updated                             |

### Files changed, by group

- **Unused `eslint-disable` directives (34 files, 1 line each):** the 22 Jest configs and 12 spec files listed in §2a.
- **Unreferenced exports (U-01 … U-16):** `libs/clinic/src/lib/clinic.dto.ts`, `libs/clinic/src/lib/domain/patient-booking.ts`,
  `apps/portal/src/lib/booking.ts`, `apps/staff/src/components/live-queue.tsx`, `apps/staff/src/lib/lab-mapping.ts`,
  `apps/staff/src/lib/demo-data.ts`, `apps/staff/src/components/yakap-registration-badge.tsx`,
  `apps/staff/src/app/(staff)/dental/actions.ts`, `apps/staff/src/app/(staff)/laboratory/actions.ts`,
  `apps/staff/src/app/(staff)/dental/patients/[id]/procedure-fields.tsx`,
  `apps/api/src/app/management-dashboard/management-dashboard.definitions.ts`,
  `apps/api/src/app/management-dashboard/management-report.schema.ts`, `apps/staff/src/lib/api/types.ts`,
  `apps/staff/src/lib/patient-edit.ts`, `apps/staff/src/lib/allergy-form.ts`, `apps/staff/src/lib/offline/outbox.ts`.
- **C-01 worker health:** new `libs/core/src/lib/health/worker-health.ts` (the former file verbatim, imports made relative),
  exported from `libs/core/src/index.ts`; both `main.ts` files import `startWorkerHealth` from `@healthcare/core`; the two
  copies deleted; `docs/architecture/observability.md` names the new home.
- **C-02 table/figure:** new `apps/staff/src/components/simple-table.tsx`; `inventory/valuation/page.tsx`,
  `laboratory/reagents/page.tsx` and `management/page.tsx` import it and drop their local copies and now-unused imports.
  The shared `SimpleTable` keys header cells by text and position (the management page's safer variant).

### Validation executed (after all changes, Nx cache skipped)

| Check                                                                                                | Baseline (before)                   | After                                                                                           |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `nx run-many -t lint typecheck` (30 projects)                                                        | 0 errors, 1006 warnings             | 0 errors, **972 warnings** (exactly the 34 directives fewer)                                    |
| `nx run-many -t test` (27 projects with tests)                                                       | Jest 605/605, Vitest 453/453 passed | Jest 605/605, Vitest 453/453 passed                                                             |
| `nx run-many -t build -p api notification-worker integration-worker instrument-gateway staff portal` | not measured                        | 6 projects + 23 dependent tasks succeeded; both Next.js apps compiled and generated their pages |
| `nx sync:check`                                                                                      | —                                   | up to date                                                                                      |
| `prettier --check` on every changed file                                                             | —                                   | clean                                                                                           |
| Integration tests, E2E, Storybook build                                                              | not run                             | not run — no route, schema, migration, workflow or story changed                                |

Bundle size was not measured; the removed code was unreferenced, so no change is expected.

### Remaining risks and limitations

- Server actions `releaseOrder`, `resultHistory` and `addPlanItem` were removed from the staff app because no screen calls
  them. The API endpoints behind them are unchanged, so restoring any of them is a few lines if a screen needs one.
- The working copy mixes CRLF and LF files; each edited file kept its own ending and git normalizes on commit, so the
  committed diff is as listed. Running `prettier --check .` repo-wide on this Windows checkout may report pre-existing
  CRLF files unrelated to this change.
- Unreachable branches and always-false conditions were not hunted by hand (see §1, limitations).

### Recommended follow-up (not implemented)

1. **Priority 2 — `useServerAction` hook** for the staff app (C-03): 20 named copies and 6 inline closures of the same
   "call action → toast → refresh" pattern. One hook in `apps/staff/src/lib/` with `{ refresh?: () => void }` covers ≈ 22
   sites; the two field-error variants and the invoice-context variant stay local. Do it screen by screen with a visual check.
2. **Priority 3 — dependencies** (D-01 … D-12): remove the twelve unused declarations in one commit with `pnpm install`
   (pnpm 10.33.0), then lint, typecheck, `build` and `build-storybook`.
3. **Priority 2 — `found`/`assertVersion`/`publicView` into `libs/core`** (C-04), a mechanical import rewrite across five
   libraries, and a shared base for the two inventory supply adapters (C-06).
4. **Priority 3 — small helpers** (C-10) and the seven config keys missing from `.env.example` (R-04).
5. **Priority 4 decisions:** keep or drop the generator-only Nx/Nest packages; whether backend libraries may import
   `libs/domain` so display labels (C-08) can be shared; whether to police in-file-only exports with knip in CI.
