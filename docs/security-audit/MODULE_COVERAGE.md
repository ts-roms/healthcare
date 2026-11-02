# MODULE_COVERAGE (Stage A, read-only)

Date 2026-11-02. Existence = directory, controllers, services, migrations and tests found by listing/grep. "Int specs" counts files in `apps/api/test/*.int.spec.ts` whose names match the domain (by filename only; I did not run them and did not read their assertions). "Lib unit" counts `*.spec.ts/*.test.ts` inside the lib. Whether a feature behaves as CLAUDE.md claims is Not verified unless stated. Status vocabulary: Exists / Partial / Missing-vs-claim.

## 1. Backend libraries

| Module | Path | Controllers (files / route decorators) | Services (files) | Lib unit | Int specs (by name) | Domain doc | Staff screens (`page.tsx` dir) | Portal / mobile | Status |
|---|---|---|---|---|---|---|---|---|---|
| core | libs/core | 0 / 0 | 0 | 12 | schema, rls, one-query-per-connection | - | - | - | Exists |
| audit | libs/audit | 1 / 1 | 1 | 1 | 2 (audit, audit-retention) | docs/domains/audit.md | `/admin/audit` | - | Exists |
| organization | libs/organization | 4 / 23 | 4 | 2 | via data-privacy, access | organization.md | `/admin/*` (16 pages) | MyHealth privacy | Exists |
| documents | libs/documents | 3 / 17 | 3 | 3 | 3 (documents, scanning, integrity) | documents.md | `/records/integrity` | portal documents | Exists; scanner needs ClamAV (INV-012) |
| notification | libs/notification | 1 / 5 | 3 | 4 | 3 | notification.md | `/notifications`, `/communications` | notification-settings; mobile `notifications` | Exists |
| auth | libs/auth | 3 / 30 | 6 | 3 | ~10 (auth, mfa-policy, staff-*, role-editing, access) | identity-access.md | `/login`, `/account`, `/admin/users`, `/admin/roles` | - | Exists |
| patient | libs/patient | 12 / 103 | 18 | 14 | ~12 + 20 portal | patient.md, patient-360.md, patient-timeline.md, patient-history.md, patient-messaging.md, records-requests.md | `/patients/*` (15 pages), `/messages`, `/records` (9) | portal (32 pages), mobile sign-in/results/forms/people | Exists |
| clinic | libs/clinic | 11 / 157 | 29 | 8 | ~9 named + clinic-journey etc. | clinic.md, calendar.md, immunizations.md, outside-results.md | `/clinic` (13), `/appointments` (5), `/queue` (4), `/calendar`, `/display` | portal appointments | Exists; unit-light (8 files for 29 services) |
| prescription | libs/prescription | 2 / 12 | 3 | 2 | 2 (dispensing, prescription-list) + journey | prescription.md | `/pharmacy` (2) | portal prescriptions | Exists |
| care-plan | libs/care-plan | 1 / 10 | 1 | 1 | 0 by name; covered only inside clinic-journey, fhir, timeline | care-plan.md | `/clinic/care-plans` | portal `/care-plan` | Partial test coverage (see INV-018) |
| laboratory | libs/laboratory | 5 / 121 | 15 | 6 | 10 | laboratory.md, laboratory-quality.md, laboratory-instruments.md | `/laboratory` (15) | portal results; mobile results | Exists |
| telemedicine | libs/telemedicine | 1 / 12 | 3 | 1 | 1 | telemedicine.md | `/telemedicine` (3) | portal consultations | Exists; LiveKit adapter optional |
| dental | libs/dental | 1 / 36 | 9 | 5 | 7 | dental.md | `/dental` (3) | portal `/dental` (opt-in) | Exists |
| billing | libs/billing | 1 / 51 | 10 | 1 | 7 | billing.md | `/billing` (6) | portal `/billing` | Exists; PayMongo adapter on `PAYMONGO_SECRET_KEY` (7 files reference it) |
| inventory | libs/inventory | 3 / 42 | 6 | 1 | 3 | inventory.md | `/inventory` (10) | - | Exists |
| crm | libs/crm | 2 / 29 | 2 | 1 | 2 (crm-outreach, portal-outreach) | crm.md | `/outreach` (4) | portal opt-out page | Exists; recurring series (`crm_campaign_series`, 3 files) |
| interoperability | libs/interoperability | 5 / 29 | 8 | 11 | 8 (fhir*, doh, exchange-review, instrument) | docs/interoperability/*.md | `/reporting` (3), `/records/imports` | - | Exists; external adapters unconfigured by design |
| philhealth | libs/philhealth | 3 / 15 | 4 | 3 | 3 | philhealth-*.md | invoice claim panel | - | Adapter stub only (claims refused `integration_not_configured`) - matches claim |
| pdf | libs/pdf | 0 / 0 | 0 | 3 | via lab-labels, billing | architecture/printable-documents.md | - | - | Exists |
| reporting | libs/reporting | - | - | - | - | ADR-0011 | - | - | Missing but declared "planned" in CLAUDE.md (consistent) |

## 2. Apps and frontend libraries

| App/lib | Exists | Evidence | Notes |
|---|---|---|---|
| apps/api | Yes | 344 ts files, 28 controllers, `main.ts` | 15 in-process schedulers |
| notification-worker, integration-worker | Yes | 6 ts files each, `railway.json` | 0 unit tests each |
| instrument-gateway | Yes | 10 ts files, 1 test | HL7/ASTM; on-site |
| staff (Next) | Yes | 130 `page.tsx`, 56 test files | CLAUDE.md "partly connected": listing shows dashboards, labs, billing, etc. as real pages; only `/preview/patient-360` is labelled demo |
| portal (Next) | Yes | 32 `page.tsx` incl. activate, results, billing, security, forms, privacy | |
| mobile (Expo) | Partial (as claimed) | 14 tsx: sign-in, activate, results, forms, people, notifications, signature-pad, privacy-cover | Matches the "first slice" claim; no booking, billing, messages screens |
| e2e | Yes | 24 files in `apps/e2e/tests` (journeys 1-25 minus gaps) | Journeys 18-19 absent from listing (numbering gap) |
| libs/ui, domain, web-session | Yes | 110 / 16 / 9 ts files | `libs/domain/fixtures.ts` demo data per CLAUDE.md |

## 3. Claims spot-checked against code (existence only)

| Claim (CLAUDE.md section 0) | Result |
|---|---|
| 135 migrations to 0135 | Verified: `ls database/migrations | wc -l` = 135, last `0135_outreach_recurring.sql` |
| RLS (0111), app role (0109) | Files exist; `apply_rls_policies` referenced in 1 source file; enforcement not tested |
| ClamAV scanner, PayMongo, DOH/RefLab gateway ports, passkeys, service points, QR, e-signatures, Expo push receipts, web push, OTel `NodeSDK` | Each found by symbol grep (1-8 files); behaviour Not verified |
| Test claim "integration tests run the app as `healthcare_app` in enforce" | Not verified (harness not read; tests not run per audit rules) |
| CI "e2e when affected" | Verified in `ci.yml` |

## Findings

| ID | Sev | Location | Evidence | Impact | Fix | Status |
|---|---|---|---|---|---|---|
| INV-016 | MEDIUM | `libs/billing`, `libs/inventory`, `libs/crm`, `libs/telemedicine`, `libs/care-plan` | 1 unit-test file each against 51 / 42 / 29 / 12 / 10 route decorators; money, stock and approval logic is covered mainly by integration specs | Pure rules (discount, VAT, refund, FEFO, approval separation) lack fast regression tests; regressions only surface in DB-backed runs that CI executes only on PRs | Add unit tests for pure rule modules before Stage B changes | Open |
| INV-017 | LOW | `apps/notification-worker`, `apps/integration-worker` | 0 test files each | Worker send/retry/seal logic tested only indirectly | Add worker handler tests | Open |
| INV-018 | LOW | `apps/api/test/` | No `care-plan*` int spec (only incidental mentions in 3 specs) | Care-plan authorization and recall reminder paths may lack direct tests (Not verified inside the 3 specs) | Add a dedicated care-plan int spec | Open |
| INV-019 | INFO | `apps/e2e/tests/` | Journey numbering skips 18-19; 24 files vs 25 numbered | Possibly removed journeys; no impact known | Confirm intentional | Open |
| INV-020 | INFO | `libs/domain/src/fixtures.ts`, `apps/staff` `/preview/patient-360` | Demo fixtures ship in the production bundle and route (labelled "Demo" per CLAUDE.md) | Risk of fixture data being mistaken for patient data; route reachable | Gate `/preview` behind non-production flag (route guard Not verified) | Open |
| INV-021 | INFO | CLAUDE.md section 0 | CLAUDE.md claims many features as built (about 40 subsystems); existence confirmed by symbol/file grep only for those listed above | Behaviour of the remaining claims is unverified in this pass | Other auditors to test per domain | Open |
