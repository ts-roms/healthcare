# CLAUDE.md — Philippine Healthcare Platform

You are the Lead Software Architect, Senior Full-Stack Engineer, Healthcare Information Systems Architect, and Security Engineer for a production-grade healthcare management platform for the Philippines.

Build the system incrementally, maintain clean architecture, preserve healthcare data integrity, and avoid unnecessary complexity.

This is **not** a generic CRM or CRUD application. It is an:

> **Integrated Healthcare Management Platform** — Clinic + EMR + Laboratory Information System + Dental + Telemedicine + Patient CRM + Patient Portal + Billing + Philippine Healthcare Integrations

**Golden rule:** One patient. One longitudinal health record. One connected care journey.

Domain-specific instructions live next to the code they govern and extend (never contradict) this file:

| Domain                        | Instructions                      |
| ----------------------------- | --------------------------------- |
| Clinic / EMR                  | `libs/clinic/CLAUDE.md`           |
| Laboratory (LIS)              | `libs/laboratory/CLAUDE.md`       |
| Dental                        | `libs/dental/CLAUDE.md`           |
| Billing                       | `libs/billing/CLAUDE.md`          |
| Interoperability / PhilHealth | `libs/interoperability/CLAUDE.md` |

---

## 0. Current repository state

Inspect the repository before every change — do not assume any file, library, table, or API exists beyond what is listed here.

**Backend — implemented (Phase 1 Foundation, Phase 2 Clinic, Phase 3 Laboratory, Phase 4a portal records, Phase 4b online booking, Phase 4c outreach, Phase 5 Telemedicine, Phase 6 Dental, Phase 7 Billing, Phase 8 FHIR R4 read and interoperability adapter stubs, Phase 9 inventory, dispensing and laboratory quality)**

| Project                                              | Path                       | Nx tags                                  | What it is                                                                                                                    |
| ---------------------------------------------------- | -------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `api`                                                | `apps/api`                 | `scope:api`, `type:app`                  | NestJS modular monolith (REST `/api/v1`, OpenAPI at `/api/docs`, Socket.IO `/realtime`). Composition root.                    |
| `notification-worker`                                | `apps/notification-worker` | `scope:worker`, `type:app`               | BullMQ consumer delivering notifications.                                                                                     |
| `integration-worker`                                 | `apps/integration-worker`  | `scope:worker`, `type:app`               | BullMQ worker for external exchanges (sealed payloads, retries, reconciliation).                                              |
| `instrument-gateway`                                 | `apps/instrument-gateway`  | `scope:worker`, `type:app`               | On-site analyzer gateway: HL7 v2 (MLLP) and ASTM E1381 TCP listeners posting result messages to the API for review.           |
| `@healthcare/core`                                   | `libs/core`                | `scope:shared`, `type:data-access`       | Config, database, errors, access decorators + permission catalog, outbox events, PH helpers, zoned time.                      |
| `audit`, `organization`, `documents`, `notification` | `libs/*`                   | `scope:shared`, `type:data-access`       | Platform services: audit trail, organizations/facilities, S3 documents, notifications.                                        |
| `@healthcare/auth`                                   | `libs/auth`                | `scope:shared`, `type:feature`           | Login, MFA, sessions, RBAC, global `AccessGuard`, `ActorResolver`, users/roles.                                               |
| `@healthcare/patient`                                | `libs/patient`             | `scope:patient`, `type:feature`          | Patient Master, lookup, duplicates, consent, communication preferences, patient portal accounts and sign-in.                  |
| `@healthcare/clinic`                                 | `libs/clinic`              | `scope:clinic`, `type:feature`           | Practitioners, schedules, appointments, waitlist, queue, triage/vitals, allergies, encounters, diagnoses.                     |
| `@healthcare/prescription`                           | `libs/prescription`        | `scope:prescription`, `type:feature`     | Immutable prescriptions, cancel/replace, drug–allergy decision support, dispensing from stock.                                |
| `@healthcare/care-plan`                              | `libs/care-plan`           | `scope:care-plan`, `type:feature`        | Care plans, goals, activities, recall list.                                                                                   |
| `@healthcare/laboratory`                             | `libs/laboratory`          | `scope:laboratory`, `type:feature`       | LIS: catalog, versioned reference ranges, orders, specimens, versioned results, critical values, worklists.                   |
| `@healthcare/telemedicine`                           | `libs/telemedicine`        | `scope:telemedicine`, `type:feature`     | Online consultations: questionnaire, waiting room, LiveKit video port, telemedicine encounter, escalation.                    |
| `@healthcare/dental`                                 | `libs/dental`              | `scope:dental`, `type:feature`           | Odontogram history (FDI), examinations, treatment plans, procedures (chart effects, billing charges), imaging metadata.       |
| `@healthcare/billing`                                | `libs/billing`             | `scope:billing`, `type:feature`          | Services/prices, charge capture from clinical events, invoices, discounts, payer coverage, payments, refunds.                 |
| `@healthcare/inventory`                              | `libs/inventory`           | `scope:inventory`, `type:feature`        | Items, suppliers, locations, lots/expiry, append-only stock ledger, FEFO issues, counts, write-offs, reorder levels.          |
| `@healthcare/crm`                                    | `libs/crm`                 | `scope:crm`, `type:feature`              | Outreach: segments from non-clinical criteria, campaigns approved by a second person, deliveries under opt-in, opt-out link.  |
| `@healthcare/interoperability`                       | `libs/interoperability`    | `scope:interoperability`, `type:feature` | FHIR R4 mapping; DOH case reporting (port, unconfigured adapter); outbound exchanges and the integration worker module.       |
| `@healthcare/philhealth`                             | `libs/philhealth`          | `scope:interoperability`, `type:feature` | PhilHealth eClaims and eligibility (ports, unconfigured adapters, worker handlers); depends on `interoperability`.            |
| `@healthcare/pdf`                                    | `libs/pdf`                 | `scope:shared`, `type:util`              | PDF toolkit (pdfkit, standard fonts): letterhead, fields, paged tables, totals, watermark, footer; text extraction for tests. |

**Frontend — partly connected to the API**

| Project                   | Path               | Nx tags                       | What it is                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e`                     | `apps/e2e`         | `scope:e2e`, `type:e2e`       | Playwright critical journeys (§31) across the staff app and MyHealth; prepares its own database and starts the built apps.                                                                                                                                                                                                                                                                                                      |
| `staff`                   | `apps/staff`       | `scope:staff`, `type:app`     | Next.js staff app: role-aware dashboards, Patient 360, doctor encounter workspace, lab workbench, odontogram, telemedicine, queue, appointments. Unbuilt modules render a placeholder.                                                                                                                                                                                                                                          |
| `portal`                  | `apps/portal`      | `scope:portal`, `type:app`    | Next.js patient portal (MyHealth, mobile-first): account activation, sign-in, home, profile. Visits, results, prescriptions, bills, messages and more run against `/api/v1/portal/*` (see below).                                                                                                                                                                                                                               |
| `mobile`                  | `apps/mobile`      | `scope:mobile`, `type:app`    | Expo (React Native) patient app, first slice: sign-in (with two-step verification) and released results against `/api/v1/portal/*`; refresh token in the device keychain; push notifications through the Expo push service (D6); imports only `type:domain` libraries; one store app per organization built with EAS (`app.config.ts`, `eas.json`, `docs/deployment/mobile-release.md`). See `docs/architecture/mobile-app.md`. |
| `@healthcare/ui`          | `libs/ui`          | `scope:shared`, `type:ui`     | Healthcare Design System on shadcn/ui + Tailwind v4: tokens (`src/styles/theme.css`), `primitives/`, `healthcare/` components, `layouts/`. Storybook.                                                                                                                                                                                                                                                                           |
| `@healthcare/web-session` | `libs/web-session` | `scope:shared`, `type:util`   | Server-side session code shared by the Next.js apps: token cookies, single-flight refresh, API errors, client forwarding, safe redirects.                                                                                                                                                                                                                                                                                       |
| `@healthcare/domain`      | `libs/domain`      | `scope:shared`, `type:domain` | Shared frontend clinical types, staff roles, a demo drug–allergy rule (`allergy-check.ts`), and **demo fixtures** (`fixtures.ts`, not real patient data).                                                                                                                                                                                                                                                                       |

**Dental (Phase 6):** `libs/dental` — a dental visit is a clinic encounter with a dentist (notes, diagnoses, prescriptions and lab orders reuse the clinic workflow). Teeth are stored in FDI (permanent and primary) and shown in the facility's notation (FDI, Universal, Palmer); surfaces M D O/I B L are validated per tooth. Examinations and procedures append tooth states (append-only; the current chart is derived, corrections are "entered in error"); treatment plans are decided by the patient item by item and completed by procedures; a procedure's code is charged by billing (`dental_procedure` source); radiographs/photos are private `imaging` documents with signed links. Organization-defined procedure codes (no national code set assumed). Roles `dentist`, `dental_assistant` (migration `0027`). Staff `/dental`, `/dental/patients/[id]`, `/dental/settings`; MyHealth `/dental` (plans, procedures done, chart summary, and images a dentist shares one by one — `dental.imaging.release`, migration `0058`) only when the organization opts in (off by default; migration `0056`); online plan decisions are a second opt-in with the organization's own acknowledgement text (decision channel and portal account recorded; migration `0058`); patients are told in MyHealth and by SMS/email, without clinical detail, when an image is shared or a plan awaits their decision (`dental.record-update`); open plans show a fee estimate of the work still ahead at billing's listed prices (`DentalFees` port over `BillingPriceQueries`; no discounts, packages or coverage), printable for the patient (`/dental/treatment-plans/:id/estimate.pdf`), each decided item keeps the estimate it had at the decision, and MyHealth shows estimates only when the organization opts in (a decision on a changed estimate is refused; migration `0060`); a procedure may list the procedures it may turn out to be (e.g. simple → surgical extraction): its estimate is then a range over their listed prices, a decision records both ends, and the plan item may be carried out as any of them (migration `0066`); a billing service mapped to a dental procedure may be priced per surface treated (`charge_unit`, migration `0067`): the charge records the surfaces as its quantity and estimates multiply the same way; the supplies a procedure used (prefilled from per-procedure templates) are issued from inventory in the same transaction and unused ones returned explicitly (migration `0057`). See `docs/domains/dental.md`.

**FHIR R4 interface:** read-only `/api/v1/fhir/r4` (`metadata`, `Patient/{id}`, `Patient/{id}/$everything`, `{Type}?patient=` incl. `DocumentReference` with `Binary/{id}` content; paged with `_count`/`_offset`; `_lastUpdated` where reliable) requires `interop.fhir.read`, audits every access and answers errors with `OperationOutcome`; inbound content goes to a review queue (below). Resources are composed in `apps/api/src/app/fhir` from each domain's read query and mapped by `libs/interoperability`; only released laboratory results are exported (a send-out's reference laboratory as a contained `Organization` performer); the dental record (Procedure, dental CarePlan and exam Observations, image DocumentReferences; local code systems) needs `dental.record.read`; imported allergies and external history (Condition, Observation, MedicationStatement, DocumentReference) are exported tagged `…/codesystem/record-source#external-import`; national identifier URIs are configurable local namespaces until official ones are obtained. See `docs/interoperability/fhir.md`.

**PhilHealth eClaims (adapter stubs):** no official specification is on record, so nothing is transmitted. An issued invoice with PhilHealth coverage can be prepared as a format-neutral claim package with readiness checks of the platform's own data (member PIN, facility accreditation number, ICD-10 diagnosis); `PhilHealthClaimsGateway` is the port and `UnconfiguredPhilHealthGateway` (status `dependency`) the default, so submissions are refused with `integration_not_configured`. With an adapter, the API seals the prepared claim (AES-256-GCM, `INTEGRATION_PAYLOAD_KEY`) and `apps/integration-worker` sends it (BullMQ retries, reconciliation), logged in `integration_exchange` (digest only, no PHI); the outcome returns through the outbox. Staff: PhilHealth claim panel on the invoice, accreditation in billing settings. See `docs/interoperability/philhealth-eclaims.md`.

**PhilHealth eligibility (adapter stubs):** the platform records PhilHealth's answer, never decides eligibility. Staff record the answer from PhilHealth's own channel (with its reference) on the patient record; answers are immutable history. With an adapter (`PhilHealthEligibilityGateway`, unconfigured by default), inquiries go through the integration worker. The claim panel shows the latest answer for the dates of service as information only. See `docs/interoperability/philhealth-eligibility.md`.

**PhilHealth YAKAP (adapter stubs):** no benefit package, FPE, capitation, eligibility rule or code list is encoded. Staff record each facility's YAKAP participation reference (billing settings, versioned) and PhilHealth's answer about a patient's registration (`registered`/`not_registered`/`pending`/`unknown`, append-only; patient record). A signed consultation can be prepared as a format-neutral `platform-yakap-1` package with readiness checks of the platform's own data (`/patients/[id]/yakap/[encounterId]`); `PhilHealthYakapGateway` is unconfigured by default, so submissions are refused with `integration_not_configured`. No new permissions (migration 0049). See `docs/interoperability/philhealth-yakap.md`.

**Inventory (Phase 9):** `libs/inventory` — stock per facility location by lot and expiry, moved only through an append-only ledger (receive, issue, transfer, count, write-off, return; balances never negative; issues first-expiry-first-out and never from expired lots; controlled items need a reason and reference), reorder levels (and quantities) with an `InventoryStockLow` event. Other workflows take stock through `InventoryStockService.consume`/`restore` **inside their own transaction** (the movement names its source; once per source, database-enforced), wired by API adapters behind each domain's port; dental procedures use `issueForSource`/`returnForSource` (source `dental_procedure`: a further use, and partial returns checked against what the procedure still holds; migration `0057`). Each workflow passes the item categories it may take, owned by its domain (`DISPENSABLE_CATEGORIES`, `REAGENT_CATEGORY`, `DENTAL_SUPPLY_CATEGORIES`); anything else is refused (`item_category_not_allowed`). **Purchase orders** (migration `0052`): draft → submit → approve (never by the submitter; `inventory.procurement.manage | approve`) → receive deliveries against the lines (never above ordered, idempotent) → received, or cancel / close short with a reason; reorder suggestions count stock on open orders. Staff `/inventory` (stock, movements, catalog), `/inventory/purchase-orders`. **Valuation and supplier invoices** (migration `0061`): a lot's cost is the weighted average of its priced receipts and every other movement records that cost when posted, so stock value (`GET /inventory/valuation`, `inventory.valuation.read`) and the value received and used in a period (`/valuation/usage`) never shift; supplier invoices are recorded against a purchase order line by line (never beyond received and not yet invoiced; price differences shown), approved by someone other than the recorder (a note when prices differ), then paid or voided, immutable; staff `/inventory/supplier-invoices`, `/inventory/valuation`. Operational figures, not accounting or BIR; no accounts payable, withholding tax or public procurement rules (RA 9184: compliance dependency). See `docs/domains/inventory.md`.

**Dispensing (Phase 9):** `libs/prescription` — a pharmacist (new role `pharmacist`; also nurses; `prescription.dispense` + `inventory.move`, migration `0053`) dispenses items of an **active** prescription from a location of the facility: stock leaves inventory in the same transaction (`DispensingStock` port → `apps/api/src/app/adapters/inventory-adapters.ts`), never more than prescribed when the stock unit is the prescribed unit, controlled items referenced by the prescription number; mistaken dispenses are reversed once with a reason (same lots back). Staff `/pharmacy`, `/pharmacy/[prescriptionId]`; prescriptions issued at the selected facility over a period, by status or only mine, at `/clinic/prescriptions` (`GET /prescriptions/issued`, `prescription.read`, ≤ 92 days, every listed patient audited). Dangerous-drug registers and dispensing records required by regulation are compliance dependencies. Loading a laboratory reagent lot can take its stock in the load's transaction (`takeFromStock`, migration `0054`). See `docs/domains/prescription.md`.

**Integration review:** administrators see unsuccessful and stalled outbound exchanges at `/admin/integrations` (`integration.exchange.manage`): re-queue stalled ones, resolve others with a note; final failures are retried from their source (invoice, case report, patient record). See `docs/architecture/integration-worker.md`.

**DOH reporting (adapter stubs):** no notifiable-disease list, case definitions, deadlines or formats are encoded. The organization configures reportable conditions (ICD-10 prefixes → its own categories); a matching recorded diagnosis opens a case report for review (staff `/reporting`): record as reported through DOH's own channel with its reference, dismiss with a reason, or — once an adapter exists — submit through the integration worker (`DohReportingGateway`, unconfigured by default). See `docs/interoperability/doh-reporting.md`.

**Earlier diagnoses and payload keys:** staff with `doh.settings.manage` can check diagnoses recorded in a date range (≤ 90 days) against the active rules, in the facility's time zone (`POST /api/v1/doh/rescans`, `DohRescans` in the background, idempotent — one case report per diagnosis; `/reporting/settings`). Integration payloads are sealed with the current key of `INTEGRATION_PAYLOAD_KEYS`/`INTEGRATION_PAYLOAD_KEY_ID` (or `INTEGRATION_PAYLOAD_KEY`, id `default`) and tagged with its id, so keys rotate without draining the queue; platform administrators see which key ids stored values still need on `/admin/integrations` (`docs/runbooks/integration-payload-key-rotation.md`).

**Laboratory labels and report archive:** staff print specimen tube labels from the workbench (`GET /laboratory/specimens/:id/label.pdf`, `lab.specimen.collect`; 2.25 × 1.25 in, Code 128 accession barcode encoded in `libs/pdf`, minimal identification). Each release of an order's results records `LaboratoryReportReleased`; the report for that set of result versions is rendered through BullMQ (`lab-report-archive`, consumer in the API process) and stored once in private object storage through `DocumentsService.storeGenerated` (migration `0030`; a correction adds an archived version, nothing is replaced). Staff list and open archived reports on the patient record. See `docs/architecture/printable-documents.md`.

**Billing deposits, notes, packages, online payment and tax settings:** a patient's deposit and credit account per facility (append-only ledger: deposits with receipts, application within both balances, refunds with `billing.refund.issue` and a reason, release on void; usable across facilities through transfer pairs when the organization allows it); credit notes (also on debit note lines and unsettled payer coverage) and debit notes against issued invoices (own number series, immutable); packages (a priced service with fixed contents; included services charged at ₱0 until used up); online payment through a `PAYMENT_GATEWAY` port (PayMongo adapter when `PAYMONGO_SECRET_KEY` is set; unconfigured by default); the organization's own tax profile (TIN, VAT status and rate, permit, document text), VAT classes, a VAT breakdown snapshot on issue, and authorized number ranges. Migrations 0035–0039; `billing.deposit.record`, `billing.credit-note.issue`, `billing.debit-note.issue`. BIR rules are not encoded — they stay compliance dependencies. See `docs/domains/billing.md`.

**Laboratory send-outs (reference laboratories):** reference laboratories (organization; accreditation reference as recorded, not verified) and per-facility referred tests (`lab.catalog.manage`); receiving a referred test's specimen prepares a send-out: dispatch with a manifest (`SM########`, courier, PDF), results back with the reference laboratory's accession, rejection or cancellation (`lab.specimen.receive`/`reject`; migration `0047`). Results are entered as normal versioned results attributed to the reference laboratory ("Performed by" on results and reports) and go through verify/approve/release. Electronic exchange is an integration dependency (`ReferenceLabGateway`, unconfigured: `integration_not_configured`). Staff `/laboratory/send-outs`. See `docs/interoperability/reference-laboratories.md`.

**FHIR R4 imports (review queue):** `POST /api/v1/fhir/r4/imports` (`interop.fhir.import`) takes a `collection`/`document`/`searchset` Bundle or one resource (targeted R4 validation, 512 KiB / 100 entries, idempotent by `Idempotency-Key` or `Bundle.identifier`, `OperationOutcome` errors) and stores it sealed with the integration key ring (migration `0048`; only types, counts and digests in clear; rejected content purged after 30 days). Reviewers (`interop.fhir.import.review`: org_admin, records_officer; staff `/records/imports`) match the patient — duplicate detection, search or registration, never automatic — and accept or reject each entry with a reason: an AllergyIntolerance becomes an unconfirmed allergy with `source = external_import` through the clinic's command; Conditions, Observations, medications and DocumentReference metadata become labelled `external_history_entry` rows (never diagnoses, results, vitals or prescriptions). Mappers in `libs/interoperability/src/lib/fhir-import`, ports wired in `apps/api/src/app/adapters/fhir-import-adapters.ts`. See `docs/interoperability/fhir.md`.

**Analyzer interfaces:** an integration account (`lab.instrument.message.submit`) posts HL7 v2 or ASTM messages from `apps/instrument-gateway`; each result is matched (accession number in the instrument's configured field, analyzer code mapping) and waits at staff `/laboratory/instrument-results`, where it is accepted into the result workflow (entered in the same transaction, attributed to the instrument) or set aside with a reason; analyzer flags/status codes are kept as sent, never interpreted; no unit conversion. Parsers and link layers in `libs/interoperability/src/lib/instruments` (subpath `@healthcare/interoperability/instruments`). Migration `0075`. See `docs/domains/laboratory-instruments.md`.

**Laboratory quality (Phase 9):** instruments per facility with an append-only maintenance/calibration log (`/laboratory/instruments`), internal QC (control materials, lots, versioned target mean/SD per test and instrument, runs evaluated with the facility's chosen Westgard rules, corrective actions; `/laboratory/qc` with a Levey-Jennings chart), and results that record their instrument, the QC in force and the reagent lots in use at entry (optionally refused while a control level is rejected — facility policy `qc_required`). Reagent lots are inventory lots loaded on an instrument (read through the laboratory's port; a new lot restarts the QC window by default; an expired lot in use refuses QC and results). Quality management (migration `0055`): storage-unit temperature logs (an excursion opens a nonconformance), nonconformances with root cause, CAPA and effectiveness check before closing, EQA rounds with the provider's evaluation (unacceptable opens a nonconformance), and staff competency per test or section (optionally required for result entry — policy `competency_required`); `/laboratory/temperatures`, `/nonconformances`, `/eqa`, `/competency`. A new nonconformance or rejected QC run sends an in-app `lab.quality-notice` to the facility's quality managers (`lab.qc.manage`, not the person who raised it), and an hourly job (`LaboratoryQualityReminders`) reminds them once of each missed temperature reading and due competency reassessment (the latter also to the person); staff read in-app messages under the top bar's bell (`/notifications`). The dashboard lists what the quality system needs (`GET /laboratory/quality/summary`, `lab.qc.read`). **Reagent use per test run** (migration `0064`): a load holds a number of tests (stated, or stock taken × the reagent's yield per stock unit, `lab_reagent_yield`); patient runs (one per order and result version on the instrument) and QC runs are counted with the result or run — with the tests per run a reagent needs for a test (duplicates, dilutions; `lab_reagent_test_usage`, migration `0067`, default 1; a panel's first run counts the most of its ordered tests the lot serves) — repeats, calibration, priming and waste are recorded with a reason (append-only `lab_reagent_use`); lots with a tenth or less left show as running low and raise one alert per load (`lab_reagent_low_alert`, migration `0065`; `LaboratoryReagentLow` → in-app `lab.quality-notice` to the facility's quality managers; counted on the dashboard's quality list); `GET /laboratory/reagents/usage` reports runs by kind, what is left, unused capacity and the reagent cost per patient run of finished loads (stock cost through the `reagentStockCosts` port); counting never moves stock or refuses work; staff `/laboratory/reagents` and the instruments page. Permissions `lab.qc.read | enter | manage`, migrations `0050`–`0051`, `0055`, `0064`–`0065`. See `docs/domains/laboratory-quality.md`.

**Patient timeline (Patient 360):** `GET /api/v1/patients/{id}/timeline` (`patient.read`) lists appointments, queue visits and triage, encounters (in person and online, with diagnosis codes), referrals, medical certificates, vitals, allergies and reviews, consents, prescriptions and dispensing, laboratory orders, specimen events, result releases and critical-value communication, dental work, images and periodontal charts, care plans, invoices, payments, credit/debit notes, deposits, PhilHealth claims, eligibility and YAKAP answers, DOH case reports, communications, imported history, documents, immunizations and records requests newest first (patient history and messaging conversations deliberately not), composed in `apps/api/src/app/patient-timeline` from each domain's small timeline read query (window and cursor helpers in `libs/core`). Each kind needs that domain's own read permission; others are listed in `withheld` without counts. Rows carry ids, times, statuses, codes and names only — never notes, result values or message bodies; entered-in-error, cancelled and void records stay listed and marked. Cursor paging on (occurredAt, source, id) with microsecond instants; one `patient.timeline.view` audit per request; indexes in migrations `0058` and `0084`. Staff `/patients/[id]/timeline` (day groups, kind chips, date range, load more, links to existing screens) and a Recent activity card on the patient record. See `docs/domains/patient-timeline.md`.

**Patient 360 workspace:** staff `/patients/[id]/360` (linked from the patient record, search results, the queue ticket and the encounter workspace banner) is the doctor's one-screen view, all API data loaded in parallel: banner (allergy wording rules, masked PhilHealth PIN), alerts (critical results awaiting acknowledgement, chronic problems, consent decisions, record status), current consultation (deep links to the encounter workspace, or start it from today's queue visit), recent consultations with diagnoses, problem list, active medications with prescriber, care plans with the next due activity, latest vitals, released results of the most relevant tests with trends, open lab orders, dental images and documents (signed links) and a timeline slice. It reuses the summary (now with `prescriberName`), lab results and timeline, plus one composed `GET /api/v1/patients/{id}/workspace` (`patient.read`; panels gated by `encounter.read`, `lab.result.read`, `lab.order.read`, `dental.imaging.read`, `document.read`, null and listed in `withheld` otherwise; short display fields only; one `patient.workspace.view` audit per view; no new permission or migration). Withheld panels say "Not available to you."; nothing is edited there. See `docs/domains/patient-360.md`.

**Patient merge (link, don't move):** a duplicate is retired into the surviving record without rewriting anything filed under it (`status = 'merged'`, `merged_into_patient_id`; ADR-0009). `libs/patient/src/lib/merge`: preview (`GET /patients/:id/merge-preview?into=`: both records, flagged differences, blockers from the `PatientMergeContext` port — encounters and online consultations in progress, queue visits, upcoming appointments, active lab orders, draft invoices, uninvoiced charges, deposit balances; active care plans warn), merge (`POST /patients/:id/merge`: reason, both versions, acknowledged differences; flat chains re-pointed; MyHealth account moved or the retired one disabled; `PatientMerged`; audited) and exact unmerge (`POST /patients/:id/unmerge`, `PatientUnmerged`; later records stay on the survivor); permission `patient.merge` (org_admin, records_officer), append-only `patient_merge` history, migration `0068`. Domains read linked records through `filedAsPatient` / `canonicalPatientId` / `isFiledAs` (`libs/core`, over the SQL functions `patient_record_ids` / `patient_canonical_id`); timeline and Patient 360 rows carry `filedUnder`; FHIR Patient `link` `replaces`/`replaced-by`; the dashboard counts a merged pair once. New care filed under a merged record is refused by a database trigger (`PM001` → `422 patient_merged`). Lookup and duplicate detection resolve a retired record's number, phone or identifier to its survivor. Staff: **Merge duplicate…** on the patient record → `/patients/[id]/merge` → compare `/patients/[id]/merge/[survivorId]`; banners on retired and surviving records, Unmerge. See `docs/domains/patient.md`.
**Medical certificates and records requests:** the responsible practitioner issues a medical certificate from a signed consultation (in person or online) in their own words — purpose, findings, recommendations, optional rest period; numbered `MC########`, immutable, voided with a reason (issuer or `encounter.amend`); the PDF is stored once as a `medical_certificate` document whose id is the certificate's (`libs/clinic/src/lib/certificates`; staff encounter workspace **Medical certificates**). Patients ask in MyHealth (`/documents`) for copies of their records (what, period, purpose; at most 3 open; withdraw while open); the records office (`patient.records-request.manage`: org_admin, records_officer; staff `/records/requests`) shares documents of the patient's record or declines with a reason the patient reads (`libs/patient/src/lib/records-requests`; append-only shared documents; no deadline, fee or disclosure rule encoded — Data Privacy Act procedures are the organization's). MyHealth lists issued certificates and shared documents behind short-lived audited links; patients get a `records.update` notice (no clinical detail) when a certificate is ready or a request is answered, the records office an in-app `records.request-new`. The records office can also prepare a **copy of the record** for a request (`POST /records-requests/:id/copies`: chosen sections — allergies, consultations with signed notes, released lab results, prescriptions, care plans, dental, certificates and document lists — over a period in the facility's time zone), composed in `apps/api/src/app/record-copy` over `FhirRecordComposer`, rendered with `libs/pdf` and stored once as a `record_copy` document to share like any other (`records_request_export`, append-only; audited `patient.records-request.copy`; migration `0070`). Migration `0068`. See `docs/domains/clinic.md` ("Medical certificates") and `docs/domains/records-requests.md`.

**Referrals:** the consultation's responsible practitioner refers a patient (`libs/clinic/src/lib/referrals`, migration `0079`) to a practitioner of the organization (they accept or decline with a reason, an appointment may be linked, and they complete it with a note) or to an outside provider named as written (the reply is recorded later, optionally with a stored document); numbered `RF########`, what the referrer wrote never changes, cancelled with a reason while open; the letter (reason, summary, listed diagnoses, active allergies, the referrer's license number) is stored once as a `referral_letter` document; in-app `clinic.referral-notice` between the practitioners; timeline kind `referral`; no new permission (`encounter.read | write | amend`, `appointment.manage`). Staff: **Referrals** in the encounter workspace, `/clinic/referrals`, `/clinic/referrals/[id]`. **Follow-up** (migration `0080`): an overdue flag for referrals still awaiting the recipient after a number of days the organization chooses (`referral_setting`, off by default; `GET|PUT /referrals/settings`, `clinic.configure`; `view=overdue`; `/clinic/referrals/settings`); a **Referrals** card on the patient record and a Patient 360 `referrals` panel (`encounter.read`); FHIR `ServiceRequest` (category SNOMED CT 3457005 Patient referral; urgency routine/urgent/emergency → priority routine/urgent/stat); MyHealth lists the patient's referrals (recipient, date, status) with the letter behind a short-lived audited link (`GET /portal/referrals/:id/link`) and sends a `records.update` `referral-ready` notice without clinical detail; merged records are read with the survivor, new referrals under a retired record are refused (0068 trigger) and open ones are a merge warning (`referral_open`). No referral network or electronic exchange is assumed. See `docs/domains/clinic.md` ("Referrals").

**Compliance configuration:** no BIR, Dangerous Drugs Board/FDA, DOH, NPC or RA 9184 rule is encoded; the organization enters its own values and records who validated each area (`compliance_review`, append-only; `compliance.review.manage`; staff `/admin/compliance`). Withholding codes (rate for reference; the amount withheld is entered at supplier-invoice payment, with the certificate reference) and procurement methods (once any is in use, a purchase order names one, with the reference it asks for) — staff `/inventory/compliance`; the register of controlled items per facility from the stock ledger (opening, running and closing balances, CSV; licence reference and responsible person as recorded; `inventory.controlled-register.read`; composed in `apps/api/src/app/controlled-register`; staff `/inventory/controlled-register`); each facility's laboratory licence as recorded with the organization's reminder window (dates only; quality summary and dashboard; `/laboratory/licence`); the organization's own DOH reporting deadline per rule (`due_at`, overdue flag); document retention periods per category with a review of documents past them (nothing deleted; `document.retention.manage`; `/records/retention`); the records-request procedure (response days → `respond_by`, identity check before sharing, notice to patients in MyHealth; `/records/requests/settings`); dental estimate validity ("Valid until") and an optional signed written estimate before a staff-recorded decision (`dental_written_estimate`). Formula-safe CSV moved to `libs/core` (`toCsv`). Migration `0074`. See `docs/architecture/compliance-configuration.md`.

**Management dashboard:** `GET /api/v1/management/dashboard` (`management.dashboard.read`, org_admin, migration `0059`; a facility-scoped grant sees only its facility; audited) composes each domain's reporting query (`PatientReportingQueries`, `ClinicReportingQueries`, `LabReportingQueries`, `DentalReportingQueries`, `BillingReportingQueries`, `TelemedicineReportingQueries`, over a `ReportingWindow` from `libs/core`) into patient volume, retention and return, no-shows, waiting time, providers and schedule utilization, lab volume, turnaround, rejection rate and results per instrument, dental, online consultations, revenue, collections and top services for ≤ 366 local days, with the headline figures of the previous period of the same length (`keyFigures`, `previous` with each change and whether it is better or worse); patient counts 1–4 shown as "<5" (rates on them withheld); revenue also needs `billing.report.read` on every facility in scope (else `withheld`); CSV export per table (`GET /management/dashboard/export?table=`, audited, formula-safe; revenue tables refused and audited as denials without billing reporting); indexes in migration `0063`; staff `/management` with changes on the key figures, "How is this calculated?", two daily charts (`DailySeriesChart`), tables and CSV downloads. Operational figures, not BIR or DOH reports. **Scheduled reports** (migration `0093`): weekly or monthly schedules of dashboard tables for named recipients (`management.report.manage`, org_admin; a recipient must hold dashboard read for the scope, revenue tables need the owner's `billing.report.read`), produced once per ended period by the hourly `ManagementReportRuns` in the API through the same export with the owner's permissions (re-resolved each run; whoever last changed the schedule), stored as `management_report` documents (`text/csv`), withheld tables and failures recorded, recipients told in-app and by email without figures (`management.report-ready`), downloads re-checking billing reporting and audited (`management.report.download`); `GET|POST /management/report-schedules`, `GET /management/reports`, `GET /management/reports/:id/files/:table`; staff `/management/reports`. Figures stay in their domains and the rules in the API; `libs/reporting` is created only when a second process needs the same rules (ADR-0011 — scheduled reports did not, they run in the API). See `docs/architecture/management-dashboard.md`.

**Immunizations:** `libs/clinic/src/lib/immunizations` — the organization's own vaccine catalogue (`clinic.configure`; staff `/clinic/vaccines`; codes under a code-system key, no national list, schedule or code set) and each patient's immunization records: given here (lot required, expiry not before the day given; optionally taken from a `vaccine`-category stock lot in the same transaction through the `ImmunizationContext` port, inventory source `immunization`, once), not given (refused/contraindicated/unavailable/other + the clinician's words), reported (`YYYY`, `YYYY-MM` or a day; source description; optional scan) and accepted from FHIR imports (`source = external_import`; imported `Immunization` entries were "not supported" before); immutable except entered in error (stock returned once) and a reaction added once (trigger), refused under a merged record. `ImmunizationRecorded` / `ImmunizationEnteredInError` (ids only). Timeline kind `immunization`, Patient 360 panel `immunizations`, FHIR R4 `Immunization` (`$everything`, `?patient=`, `_lastUpdated`), MyHealth `/immunizations`, copy-of-record section `immunizations`; staff patient record card, `/patients/[id]/immunizations`, encounter workspace panel. Nothing computes a due dose; schedules, registry reporting and official code sets are dependencies. Permissions `immunization.read`, `immunization.record`, migration `0081`. See `docs/domains/immunizations.md`.

**Procedures performed at the clinic:** `libs/clinic/src/lib/procedures` (migration `0085`) — the organization's own procedure catalogue (`clinic_procedure_definition`: its own code, never changed; name; body site asked or not; optionally another code under a code-system key it names — no national code set, RVS or PhilHealth code assumed; `clinic.configure`; staff `/clinic/procedures`) and procedures recorded in an **in-person** consultation (`clinic_procedure`: the entry copied, when, who performed it — any active practitioner, the recorder's own by default —, body site, quantity 1–99, notes; once signed only with `encounter.amend` and a late-entry reason; immutable except entered in error by the recorder or `encounter.amend`, trigger; refused under a merged record). `ClinicProcedurePerformed` / `ClinicProcedureEnteredInError` (ids only) → billing charges a service mapped to the code (charge source and service source kind `clinic_procedure`, quantity as recorded) and cancels a pending charge. Encounter workspace **Procedures**, timeline kind `procedure`, Patient 360 panel `procedures`, FHIR `Procedure` (local category `clinic-procedure`; notes not exported), copy of the record under each consultation. No new permission (`encounter.read | write | amend`). **Supplies used** (migration `0089`, the dental pattern): supply templates per catalogue entry (`clinic.configure`, `/clinic/procedures`), supplies issued from a stock location of the facility through `InventoryStockService.issueForSource` behind the `ProcedureSupplies` port in the clinic's transaction (FEFO, never expired lots, all or nothing, `CLINIC_SUPPLY_CATEGORIES`), explicit returns, append-only `clinic_procedure_supply_use(_line)`, ledger source `clinic_procedure`; pure supply rules shared with dental in `libs/core` (`supplies/supply-use.ts`); staff panel and template editor shared with dental (`apps/staff/src/components/supplies-used.tsx`, `supply-templates.tsx`). **Consent, note templates and procedures outside a consultation** (migration `0095`): the organization's own consent wording per catalogue entry (versioned, append-only, `clinic.configure`; a printable per-patient form `GET /clinic/procedure-definitions/:id/consent-form.pdf?patientId=`, audited, not stored) and `consent_required`; the consent recorded against the procedure (`clinic_procedure_consent`, one per procedure, append-only: paper/electronic/verbal, patient or a named representative, who obtained it and when — never after the procedure —, the wording version shown, an optional `consent_form` scan of the same patient) with the record or once later (`POST /procedures/:id/consent`); a `note_template` per entry that prefills the notes (never a clinical rule); and entries the organization allows outside a consultation (`allowed_outside_consultation`) recorded under an open in-person queue visit (`visit_id`; `encounter_id` nullable; CHECK filed under one or the other) with the new permission `procedure.record` (org_admin, physician, nurse): `POST|GET /visits/:id/procedures`; staff `/queue/visits/[id]/procedures`, `/patients/[id]/procedures`. What a valid consent must say and who may consent for whom are compliance dependencies. See `docs/domains/clinic.md` ("Procedures").

**Automatic no-shows and online check-in:** each facility's booking rules (migration `0088`, `/appointments/visit-types`) can turn on **automatic no-shows** — hourly `AutomaticNoShows` marks booked/confirmed appointments that ended without a check-in after the facility's local hour on their day (last 48 hours only; same audit and `AppointmentNoShow` follow-up, system actor, `no_show_automatic`) — and **online check-in** for in-person appointments within a window around the start (`POST /portal/appointments/:id/check-in`; the visit waits for triage, `checked_in_via = 'patient_portal'`, "Checked in online" on the queue; MyHealth shows the button and the queue number). Both off by default. See `docs/domains/clinic.md` ("Automatic no-shows and online check-in").

**Staff calendar:** `libs/clinic/src/lib/calendar` (migration `0087`) — meetings, events, blocked time, trainings and reminders per facility (`calendar_event`, attendees are the organization's clinicians; `facility` or `invitees`-only visibility; organizer or `clinic.configure` changes; cancelled with a reason, never deleted; no patient data), `GET|POST /calendar/events`, `PUT /calendar/events/:id`, `POST …/cancel`; permissions `calendar.read | manage`. `GET /appointments` also takes `from`/`to` (≤ 42 days). Staff `/calendar` (month/week/day, appointments shown beside events). No recurrence, RSVP, reminders or external sync. See `docs/domains/calendar.md`.

**Patient history:** `libs/clinic/src/lib/history` — past procedures and surgeries (as written, optional organization code, date at the precision known — `YYYY`/`YYYY-MM`/day —, where/by whom, body site; `reported` by patient/relative/other provider, `recorded_here` or `external_import`), past conditions diagnosed elsewhere (status as reported; **never a diagnosis**: not the problem list, never billed or DOH-matched), **medications taken** that were not prescribed here (`reported_medication`, migration `0083`: as written, dose, reason, prescribed by/where from, start and stop at their precisions, status taking/stopped/unknown as reported; marked stopped once — `POST /history/medications/:id/stopped`, `PatientHistoryMedicationStopped`, audited `history.medication-stopped`; **never a prescription**: not dispensed, billed or allergy-checked; FHIR `MedicationStatement` with local category `medication-taken`; "Also taking" in Patient 360), family history (relative from a fixed list mapped to HL7 v3 RoleCode + text, condition, age at onset, deceased and cause) with an append-only review (`reviewed` / `none_known` / `unknown` with adopted, not known or declined — "No known family history" only after a review, "not recorded" otherwise), and social history as whole-snapshot versions on top of the current one (`basedOn`; tobacco, alcohol, substance use, occupation and exposures, living situation, activity, diet, sexual history, notes; no scoring). Rows immutable except entered in error (trigger), refused under a merged record; `PatientHistoryRecorded` / `PatientHistoryEnteredInError` (ids and section). **Substance use and sexual history** need `history.read` + `encounter.write` (null and `sensitiveWithheld` otherwise; never in notices, timeline, search or audit values); shown to the patient in MyHealth, not to a guardian. `GET /patients/:id/history`, section POSTs, `POST /history/:id/entered-in-error`; Patient 360 panel `history`; FHIR `Procedure`, `Condition` (local past-medical-history category, unconfirmed), `FamilyMemberHistory`, social-history `Observation`s; imports of `Procedure` and `FamilyMemberHistory` accepted into the history (Conditions stay external history); MyHealth `/health-history`; copy-of-record section `history`; not a timeline kind. Staff patient record card, `/patients/[id]/history`, encounter workspace panel. Permissions `history.read`, `history.record`, migration `0082`. See `docs/domains/patient-history.md`.

**Frontend prototype limitations — do not mistake these for implemented features**

- **Connected to the API:** sign-in/sign-out (password, TOTP MFA, organization choice), session refresh, navigation (from the user's permissions), facility selection, patient search, the patient record (`/patients/[id]`, with **Edit details** at `/patients/[id]/edit`: demographics, status, contacts, addresses, IDs, emergency contacts and guardians, communication preferences; search also by ID and with inactive records; including allergy recording and review (also at triage and in the encounter workspace), the Patient 360 clinical summary and consent recording with history), registration with duplicate review, the **queue** (`/queue`: board, call, move, walk-in check-in; live updates over the realtime socket with a short-lived ticket, polling every 15 s as a fallback), **triage and vitals** (`/queue/visits/[id]/triage`, with allergies and previous vitals alongside), the **encounter workspace** (`/clinic/encounters`: today's consultations; `/clinic/encounters/[id]`: SOAP note drafts, diagnoses, signing, amendments, revision history, entered-in-error, prescribing with drug–allergy decision support, replace and cancel, follow-up booking and care plans), **care plans** (`/clinic/care-plans`: the patient recall list; `/clinic/care-plans/[id]`: goals, activities incl. recurring ones, booking a follow-up that links the appointment, progress notes, status), the **clinic dashboard** (`/`: today's figures, what needs attention, next patients, provider workload, live queue for the selected facility), **appointments** (`/appointments`: day schedule, confirm, check in, cancel, no-show, patient self-bookings marked; `/appointments/new`: booking from open slots; `/appointments/visit-types`: which visit types patients may book online) and the **laboratory** (`/laboratory/worklist`: stage worklists, barcode scan, collection, receipt, rejection, result entry, verify/approve/release, corrections; `/laboratory/critical`: communication and acknowledgement; `/laboratory/catalog`: tests, ranges, panels, facility policy; ordering from the encounter workspace; results and trends on the patient record; the dashboard's laboratory panel) and **billing** (`/billing`: cashier's desk; `/billing/patients/[id]`: charges, packages, deposit and credit balance; `/billing/invoices/[id]`: discounts with evidence, HMO/PhilHealth coverage, issue, payments, refunds, online payments, claim follow-up, deposit applied, credit and debit notes, VAT breakdown, void and reissue; `/billing/reports`: daily report; `/billing/settings`: services and prices with VAT class, packages, discount rules, payers, tax and document settings, document numbers with authorized ranges), **administration** (`/admin/users` and `/admin/users/[userId]`: staff, roles by scope, grant/revoke and suspend with reasons, a temporary password to replace at the next sign-in — `user.manage`, audited, sessions ended, accounts shared with other organizations left to platform administrators, the API refusing all but account routes until it is replaced (`403 password_change_required`, migration `0090`, `docs/security/access-control.md`); staff reset a forgotten password themselves by an emailed single-use link (`/forgot-password`, `/reset-password`, a current code when two-step verification is on, `STAFF_BASE_URL`, migration `0091`); `/admin/roles`: roles and new organization roles within the creator's own permissions; `/admin/facilities`: facilities and departments; `/admin/audit`: the audit trail with filters), **My account** (`/account`: own password and TOTP two-step verification) and **scheduling set-up** (`/appointments/schedules`: weekly schedules, closures, practitioners, rooms; **Move** on the day schedule reschedules with a reason). See `docs/architecture/staff-app.md`.
- **Online consultations (telemedicine):** staff `/telemedicine` (today's online consultations, who is waiting), `/telemedicine/[appointmentId]` (pre-consult answers, start), and a telemedicine panel in the encounter workspace (LiveKit video via `VideoCall` in `@healthcare/ui/healthcare`, callback number, end with instructions, escalate to in-person care); MyHealth `/consultations/[appointmentId]` (questionnaire with red flags, waiting room, video, instructions). See `docs/domains/telemedicine.md`.
- **Still demo fixtures** (badged "Demo" with a demo-data banner): `/preview/patient-360` (including its dental tab), kept as the labelled design demo and pointing to the real, API-backed workspace `/patients/[id]/360`. It reads `apps/staff/src/lib/demo-data.ts`.
- **Patient portal:** activation with a staff-issued one-time code, sign-in/sign-out, session refresh, the patient's profile, visits, released results (plain language, trends), active prescriptions and care plans, online booking (book, reschedule — with the same or another doctor at the clinic — and cancel within published schedules, for visit types the clinic opened; each clinic's own notice, cut-off, horizon and open-booking limit, defaulting to 2 hours, 2 hours, 60 days and 3) the **messages** page (`/messages`: two-way **conversations** with the clinic — migration `0076`, `libs/patient/src/lib/messaging`, `docs/domains/patient-messaging.md`, staff `/messages` with `patient.message.read|manage`, a text/email that "a message is waiting" without its content, not for emergencies, 5 open conversations and 10 messages an hour; **attachments, notes, routing and targets** — migration `0097`: a message carries up to 3 documents of the patient's record (the patient's own JPEG/PNG/HEIC/PDF uploads ≤ 10 MB, 10 a day, as `clinical_attachment` documents with `source = 'patient_upload'`; the clinic's available documents of the record), opened behind short-lived audited links; staff-only `patient_message_note`; per facility and topic `patient_message_setting` routes new messages to a role or a person (optionally assigned on arrival) with a calendar-hour response target — `response_due_at`, `overdue` on the queue, `GET /patient-messages/overdue-count`, hourly `PatientMessageReminders` sending one in-app `portal.message-overdue` per breach; `GET|PUT /patient-messages/settings` (`clinic.configure`); staff `/messages/settings` — plus in-app notices and an unread badge) and **bills** (`/billing`: invoices, coverage, payments, credit and debit notes, deposit and credit balance; pay online only once a payment provider is configured — PayMongo when `PAYMONGO_SECRET_KEY` is set; none by default) run against `/api/v1/portal/*` (results only when released, releasable to patients and, if critical, acknowledged by the care team; a results-ready SMS/email names no test or value); staff invite and disable portal access from the patient record (`patient.portal.manage`, requires `portal_access` consent). **Email verification and two-step verification** (`/security`, from Profile; migration `0073`): the sign-in email is proven with an emailed 6-digit code (15 min, 5 tries) and can be changed the same way (the new address must prove itself, the old one is told); patients can add TOTP two-step verification (needs a verified email; single-use codes via a stored last step, 10 hashed recovery codes, lockout shared with passwords, `patient_mfa_challenge` token, staff `POST /patients/:id/portal-account/mfa-reset`); internal `portal.email-verification` / `portal.security-alert` email templates; see `docs/architecture/portal-app.md`. **Per-clinic booking rules, another doctor and a waiting list** (migration `0077`; `facility_booking_rule` set in staff `/appointments/visit-types`; MyHealth reschedule may choose another practitioner at the same facility; a patient waiting list for full days where the clinic turns it on — staff `/appointments/waitlist`, a text/email that "a time may have opened" without doctor or time, nothing booked automatically; `docs/domains/clinic.md`) **Waiting-list rules and offers, room views** (migration `0096`): rules per visit type or practitioner at a facility (`waitlist_rule`; a practitioner's wins over a visit type's, the facility's is the default; `GET|PUT /clinic/waitlist-rules`, `clinic.configure`; MyHealth asks `GET /portal/booking/waitlist-allowance` first); a facility's `waitlist_mode` `notice` (default) or `offer`: an opened time is **held** (`waitlist_offer`, `offer_hold_minutes`, `offer_batch`) for the next patient-made entries, accepted by the patient in MyHealth (`POST /portal/booking/offers/:id/accept|decline`, booked through the ordinary patient booking, first acceptance wins) or by staff for them (`/waitlist/offers/:id/accept|withdraw`, `appointment.manage`), expired hourly and handed on (`WaitlistOffersService`) — never booked without someone's acceptance; `GET /appointments?roomId=` and `room` on rows, with the staff day schedule and calendar day view laid out by room.) **Password reset** (`/forgot-password` → emailed single-use 30-minute link → `/reset-password` with the patient's date of birth, because the sign-in email may not be verified; same answer whether or not the account exists; ends every session; `portal.password-reset` / `portal.password-changed` internal email templates; `PORTAL_BASE_URL`; migration `0072`; see `docs/architecture/portal-app.md`). **Push notifications** (Web Push to the patient's browser, no provider account; `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`; migration `0079`; `push_subscription`, `WebPushSender`, service worker `apps/portal/public/sw.js`; content-free, push first for results/records/dental/message notices; `docs/domains/notification.md`). **Mobile app and push** (`apps/mobile`, Expo; migration `0081`; `EXPO_PUSH_ENABLED`; the app registers its Expo token as a `push_subscription` row of `kind = 'expo'` through `POST /portal/push/mobile-devices`, same 5-device limit, preferences and content-free payload as browser push; `WebPushSender` sends to phones through the Expo push service; the app's **Notifications** screen turns push on or off for the phone, sends a test and removes devices, and sign-out unregisters the phone; Expo push receipts are read every 15 minutes by the notification worker (migration `0083`, `push_ticket`, `ExpoPushReceipts`: delivered notices marked `delivered`, gone apps dropped at once, credential problems logged, not held against the phone); the Expo push service is the recorded provider (D6); store publication is left to the organization; `docs/architecture/mobile-app.md`). **Notification settings** (`/notification-settings`, from Profile; migration `0071`): the patient chooses text message, email and push per kind of message (care, appointments and bills, optional reminders) — the same preference rows the notification service reads; destinations shown masked. **Guardian and dependent access** (migration `0080`; `libs/patient/src/lib/proxy`; staff **Guardians and caregivers** on the patient record, `patient.portal.proxy.manage`; a person with their own MyHealth account acts for another's record only through a clinic-recorded grant — relationship, basis, what was checked, `view`/`act` scopes, optional end date — sent as `X-Acting-For` on `@ProxyAllowed()` routes, requiring the dependent's own portal consent; every audited action records `proxyGrantId`; MyHealth `/people` and an acting banner; the platform encodes no rule about who may act; `docs/architecture/portal-app.md`). **Privacy and consents** (`/privacy`, from Profile; migrations `0069`, `0078`): each consent with its history, giving telemedicine, HMO/PhilHealth sharing and research online only against the organization's own wording (`consent_text`, staff `/admin/consent-wording`, `consent.wording.manage`; the platform ships none; the wording version is recorded), and withdrawal of telemedicine, HMO/PhilHealth sharing, research and MyHealth itself (recorded by the portal account, electronic; withdrawing MyHealth ends its sessions; data processing and treatment consent are changed at the clinic; granting stays at the clinic). No fixture data is shown to signed-in patients. See `docs/architecture/portal-app.md`.
- **Offline (C3 phase 1, ADR-0013):** staff `/offline` captures registrations, walk-in check-ins and triage with vital signs without a connection (an outbox in IndexedDB encrypted with a session-only key; `apps/staff/src/lib/offline/`), replays them in capture order through the same server actions as the live screens with the action id as `Idempotency-Key` (walk-ins and vitals chained on the registration or walk-in they wait for), and parks whatever the API refuses for a person to resolve — never merged or overridden; `public/sw.js` keeps the page reachable offline with its last online snapshot; a banner on every page shows the connection state and what waits. Nothing else works offline; printing, documentation and the mobile app stay online-only.
- **User manual:** `docs/manual/*.md` (task-oriented, per role) is the single source for in-app help: staff `/help` (all chapters, **Help** in the menu) and MyHealth `/help` (chapter 12 without its staff sections, open before sign-in), read from the repository on the server and rendered with the `Markdown` primitive of `@healthcare/ui/primitives`. Update the manual when a screen changes.
- **Never mix fixture clinical data with a real patient.** Real patient pages show only API data. "No known allergies" appears only after a recorded review; never-reviewed shows "Allergies not recorded — ask the patient"; users without clinical access see "Allergies: no access".
- UI audit events in demo modules (e.g. allergy overrides) are toasts only; the API audits the real workflows.
- The frontend drug–allergy class map is a labelled demo list. The authoritative server-side check is `libs/prescription/src/lib/allergy-check.ts` (decision support with an audited override).

**Tooling**

- Nx 23 + pnpm 10, Node 22 (`.nvmrc`). TypeScript strict everywhere: backend projects use TypeScript 6 with project references (`tsconfig.node.json`, synced by `nx sync`); frontend projects use TypeScript 5.9 with `tsconfig.base.json` (bundler resolution); `apps/mobile` uses TypeScript 6 with `expo/tsconfig.base`, the version Expo SDK 57 expects. The `@nx/js/typescript`, webpack and Jest plugins apply to backend projects only (see `exclude` in `nx.json`).
- Frontend: Next.js 16, React 19, Tailwind CSS 4, Storybook 10, Vitest 4 (`*.test.ts`). Backend: NestJS 11, Drizzle, Jest 30 (`*.spec.ts`), API integration tests (`apps/api/test/*.int.spec.ts`, target `integration`) against real PostgreSQL.
- End-to-end: `apps/e2e` (Playwright, target `e2e`, `pnpm test:e2e`) runs the §31 critical journeys in a browser against the built API, staff app and portal, with its own database (`healthcare_e2e`, recreated per run) and ports. Journeys drive the real screens; the only shortcut is moving a booked teleconsultation to "now" in the database. See `docs/deployment/local-development.md`.
- ESLint 9 flat config with `@nx/enforce-module-boundaries` (tags and constraints in `docs/architecture/module-boundaries.md`). Prettier (160 columns, Tailwind plugin) over the whole repo.
- Observability: production processes log one JSON object per line (`ConsoleLogger({ json })`), an access log per request (route template, status, duration, request id, actor id — never bodies or ids in URLs), and operational failures with stable `event` names; `GET /api/v1/health/ready` reports database (required, `503`), Redis and object storage (degrade to `200 degraded`); workers serve `/live` and `/ready` on `HEALTH_PORT` when set. Traces and metrics through OpenTelemetry (`@healthcare/core/telemetry`, imported first in each `main.ts`; HTTP, Express, NestJS, `pg`, ioredis; the platform's own outbox and queue instruments in `libs/core/src/lib/telemetry/metrics.ts`), exported over OTLP/HTTP only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, every span scrubbed of URLs, query strings, headers, client addresses and Redis arguments before export; log lines carry `traceId`; no backend chosen, no error-tracking service (ADR-0012); alert conditions in `docs/runbooks/alerts.md`. See `docs/architecture/observability.md`.
- CI: `.github/workflows/ci.yml` runs `nx sync:check`, `prettier --check`, then `nx affected` lint → typecheck → test → integration (with a PostgreSQL service) → e2e (PostgreSQL + Redis services, Chromium installed when `e2e` is affected; report uploaded on failure) → build (+ `build-storybook`); a second job runs `terraform fmt -check` and `terraform validate` on `infrastructure/terraform/railway/` (never `plan` or `apply`; CI holds no Railway token).
- Infrastructure: `railway.json` per app (build, pre-deploy migration, start, health, restarts) and `infrastructure/terraform/railway/` (the Railway project, the five services bound to the repository with their `railway.json`, variables with secrets supplied at apply time, public domains; community provider `terraform-community-providers/railway` verified in ADR-0010); Postgres and Redis templates, deploy-on-push and the first deploy stay by hand (`docs/deployment/railway.md`, `docs/runbooks/railway-terraform.md`).
- Commands: `pnpm dev` (API, workers, staff and portal in parallel), `pnpm dev:api` (:3333), `pnpm dev:worker`, `pnpm dev:integration-worker`, `pnpm dev:instrument-gateway`, `pnpm dev:deps` (PostgreSQL, Redis, object storage, Mailpit and LiveKit in Docker), `pnpm dev:staff` (:3000), `pnpm dev:portal` (:3001), `pnpm storybook` (:6006), `pnpm db:migrate`, `pnpm db:seed`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` (wipes `TEST_DATABASE_URL`), `pnpm test:e2e` (recreates `healthcare_e2e`), `pnpm build`, `pnpm format`, `pnpm nx sync:check`. See `docs/deployment/local-development.md`.

**Backend conventions** (details in `docs/architecture/`)

- **Schema:** hand-written, forward-only SQL in `database/migrations/` is the source of truth (constraints, composite same-organization and same-patient FKs, exclusion constraints, append-only triggers). Each library mirrors **only its own tables** as Drizzle definitions; `apps/api/test/schema.int.spec.ts` catches drift. Never edit an applied migration.
- **Validation:** Zod via `nestjs-zod` (`createZodDto`). No class-validator.
- **Access:** decorators (`@Public`, `@RequirePermissions`, `@RequireFacility`, `@RequirePlatformAdmin`, `@CurrentActor`) and the permission catalog live in `libs/core`; the global `AccessGuard` in `libs/auth` enforces them. Every route is authenticated by default. New permissions need a migration row **and** a `PERMISSIONS` entry.
- **Actor:** pass `Actor` explicitly into services; scope every query by `actor.organizationId`. Background work uses `systemActor()`.
- **Audit:** write audit events with `AuditService.record(tx, actor, …)` inside the same transaction as the change; `recordStandalone` for reads/denials.
- **Events:** record domain events with `DomainEventPublisher.record(tx, …)` in the same transaction; handlers subscribe via `DomainEventHandlers.on(…)` and must be idempotent (outbox, at-least-once). Payloads carry ids, never clinical text.
- **Errors:** throw `DomainError` subclasses from `libs/core`; the filter produces `{ error: { code, message, details?, requestId } }`.
- **Patient portal auth:** patients are not staff users. Portal routes are `@Public()` to the staff `AccessGuard` and protected by `PatientAccessGuard` (`libs/patient`), which re-checks session, account and consent per request; tokens use the `healthcare-portal` audience. Audit patient actions with `PatientAuditContext` (actor type `patient`).
- **Cross-domain:** a library never imports another domain. It defines a port; the API (`apps/api/src/app/adapters`) wires the adapter. Cross-domain read models (e.g. Patient 360) are composed in the API.

**Frontend conventions**

- The staff app calls the API only from its server (server components, server actions, `proxy.ts`) via `apps/staff/src/lib/api`. Tokens live in httpOnly cookies and never reach browser JavaScript. API response types are mirrored in `apps/staff/src/lib/api/types.ts` until contract libraries exist.
- Import the design system via `@healthcare/ui/primitives`, `@healthcare/ui/healthcare`, `@healthcare/ui/layouts`; shared types via `@healthcare/domain`.
- Form controls and tables use the shadcn primitives (`Button`, `Input`, `Textarea`, `Checkbox`, `RadioGroup` — `RadioGroupTile` for card or pill choices —, `NativeSelect`, `Table`), not raw `<button>`/`<input>`/`<select>`/`<table>` (hidden inputs and a visually hidden file picker aside). Give `NativeSelect` its prompt with `placeholder="Choose…"`, not an `<option value="">`: with nothing to choose it shows "No data available" (or `emptyText`), and adds that line under an empty-value choice such as "None" — pass a specific `emptyText` there ("No rooms set up").
- Clinical status is never colour alone (colour + icon + text; see `libs/ui/src/healthcare/status.tsx`).
- Clinical times render in the facility timezone via `libs/ui/src/lib/format.ts` (default `Asia/Manila`).
- Business rules live in domain libraries, not in React components.
- Every new project needs `nx.tags` in its `package.json` and its own `eslint.config.mjs`.

**Staff two-step verification policy:** an organization may require TOTP two-step verification for staff (`staff_mfa_policy`, migration `0086`, `user.mfa.manage` for org_admin; `libs/auth/src/lib/mfa-policy.service.ts`): requiring it needs the administrator's own first; a member without it still signs in but every route except those marked `@AllowDuringMfaEnrollment()` (own account, facilities, sign-out, set-up) answers `403 mfa_enrollment_required`, and the staff layout shows only the set-up (`MfaEnrollmentGate`); nobody can turn theirs off while it is required; integration accounts are exempted one by one with a reason; administrators reset a member's two-step verification (lost phone; sessions end; not oneself, and accounts in other organizations only by a platform administrator). Codes work once (last accepted TOTP step, migration `0092`) and staff get 10 single-use recovery codes, shown once at set-up or renewal (`POST /auth/mfa/recovery-codes`), stored as hashes (`staff_recovery_code`), usable at sign-in and to turn it off. Staff `/admin/security`, controls on `/admin/users/[userId]`. See `docs/security/access-control.md`.

**Shared rate limits:** the API's rate-limit counters live in Redis (`apps/api/src/app/redis-throttler-storage.ts`, a `ThrottlerStorage` over one atomic script: fixed window, `429 rate_limited` with `Retry-After`, keys `throttle:*` always expire), so replicas count a client together; while Redis is unreachable requests are let through and a warning is logged once a minute (account lockout in PostgreSQL still applies). Integration tests need `TEST_REDIS_URL` (default `redis://localhost:6379`; the CI job provides it). Each refusal is counted by route template and Asia/Manila day (`RateLimitGuard`, Redis hash kept 100 days, no address or account) for platform administrators (`GET /rate-limits/refusals`, section on `/admin/security`) — the evidence for whether patients on shared addresses need a higher MyHealth allowance. See `docs/security/access-control.md`. **Live updates across instances:** the realtime namespace shares its rooms through Redis (`@socket.io/redis-adapter`, `ConfiguredIoAdapter`), so an event processed by one API instance reaches sockets on the others; the staff app connects websocket-only (no sticky sessions); while Redis is unreachable delivery is local and the 15-second poll covers it (`docs/deployment/railway.md`, "Running more than one API instance").

**Breached-password screening:** every new password (staff change, staff and MyHealth reset links, MyHealth activation, administrator-set first and temporary passwords) is looked up in the Pwned Passwords range API (5-character SHA-1 prefix, padding) after the caller is verified and outside the transaction; found → `422 password_breached`, unreachable or slow (5 s) → `422 password_check_unavailable`; a refusal keeps links and codes usable and is audited where the route audits failures; not re-checked at sign-in (`libs/auth/src/lib/breached-passwords.ts`, `BREACHED_PASSWORD_CHECKER`; `PASSWORD_BREACH_CHECK`, unset = on in production only). See `docs/security/access-control.md`.

**Communication log:** staff `/communications` (`notification.read`; the list also needs `patient.read`) shows what the platform sent or held back to patients over a period (≤ 92 Asia/Manila days): figures, breakdowns by channel, reason not sent (consent, preferences, missing contact) and message, and the list with status, masked destination and requester — never the content (`NotificationService.communicationLog` / `communicationSummary`, composed with patient and staff names in `apps/api/src/app/communications`; `GET /communications`, `/summary`, `/export` CSV ≤ 5,000 rows; audited `notification.log.view|export`); `/patients/[id]/communications` shows one patient's history with their preferences; staff-facing template labels (`TEMPLATE_LABEL`). Migration `0084` (index; `notification.read` also for receptionists and records officers). Campaigns and segmentation are not built. See `docs/domains/notification.md`.

**Outreach campaigns (C1, `libs/crm`):** segments the organization defines from **non-clinical** criteria (age, sex, place, registration and last-visit dates, a care-plan activity due, an outreach opt-in on a channel; never a diagnosis, result or medication — a compliance decision first), with an audited preview (count and a work list of at most 200); campaigns (segment, channels, the organization's own plain-text wording checked per channel, optional send time) that a **second person** approves (`crm.campaign.approve`, never the author or submitter), sent every minute by `CrmCampaignRuns` in the API through `NotificationService` with the internal template `outreach.campaign` (category `outreach`, so each patient's explicit per-channel opt-in decides; deceased, merged and inactive records never), one append-only delivery row per patient and channel with the outcome, a summary of counts only, and a single-use opt-out link in every outreach email (`POST /outreach/opt-out`, MyHealth `/outreach/opt-out`, recorded as a preference through the patient domain). Ports `CrmSegmentSource` / `CrmPreferenceWriter` wired in `apps/api/src/app/adapters/crm-adapters.ts`. Permissions `crm.read | segment.manage | campaign.manage | campaign.approve`, migration `0094`; staff `/outreach`. See `docs/domains/crm.md`.

**Outreach (Phase 4c):** care-plan recall reminders (`CarePlanRecallReminders`, hourly in daytime, once per activity/due date/kind), no-show follow-up, in-app copies of patient notices, staff "Message in MyHealth" on the patient record (starts a conversation); all through `NotificationService` (consent and preferences).

**Next steps:** Phase 8 follow-ups (FHIR R4 read, PhilHealth eClaims and eligibility, and DOH reporting adapter stubs exist; each real adapter waits for its official specification — `docs/interoperability/`). Printable PDFs exist for laboratory reports, invoices and receipts (`docs/architecture/printable-documents.md`); released lab reports are archived to object storage via BullMQ. Billing follow-ups: the PayMongo adapter exists (`apps/api/src/app/adapters/paymongo-payment-gateway.ts`, on when `PAYMONGO_SECRET_KEY` is set; to be verified in PayMongo test mode before live use), and validation of the configured BIR documents and VAT treatment with the organization's accountant. Phase 3 follow-ups done: result attachments (laboratory-managed documents, frozen from verification) and realtime lab status (`lab.updated`). Dental follow-ups done: periodontal charting, the MyHealth view with released images, online plan decisions and their notices, supply use from inventory, dental FHIR resources and fee estimates; fee ranges (through procedures a procedure may turn out to be) and per-surface pricing done; estimate validity and an optional signed written estimate are configuration (Compliance configuration, above) — the regulatory content of a written estimate remains a compliance dependency. Inventory follow-ups done: valuation, supplier invoices and reagent use per test run; analyzer interfaces exist (HL7 v2 ORU^R01 / ASTM E1394 via `apps/instrument-gateway`; results wait for review and are accepted into the result workflow; migration `0075`; `docs/domains/laboratory-instruments.md`) — orders to analyzers, vendor profiles and counting runs the analyzer repeats on its own remain; each analyzer is validated against its vendor specification before live use.

## 1. Technology stack

Use this stack unless there is a strong, documented technical reason to change it.

| Area           | Choice                                                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo       | **Nx + pnpm + TypeScript**. Do **not** introduce Turborepo.                                                                                                                               |
| Frontend       | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, React Hook Form, Zod, TanStack Query where appropriate                                                                               |
| Backend        | NestJS, TypeScript, REST, OpenAPI/Swagger. Validation: **Zod** (via `nestjs-zod`) everywhere.                                                                                             |
| Database       | PostgreSQL — primary transactional store, strong relational modeling. SQL migrations + Drizzle query builder                                                                              |
| Cache / jobs   | Redis + BullMQ                                                                                                                                                                            |
| Object storage | S3-compatible                                                                                                                                                                             |
| Mobile         | React Native + Expo (primarily for patients)                                                                                                                                              |
| Realtime       | WebSockets / Socket.IO                                                                                                                                                                    |
| Telemedicine   | WebRTC via a proven/managed provider (e.g. LiveKit). The app owns the clinical workflow; video is one component.                                                                          |
| Infrastructure | Docker, GitHub Actions; Railway config-as-code plus Terraform for the project, services, variables and domains (`infrastructure/terraform/railway/`, ADR-0010); CDN/WAF where appropriate |
| Observability  | OpenTelemetry, Prometheus, Grafana, centralized structured logging, error tracking                                                                                                        |

**PostgreSQL:** do not store the healthcare system as arbitrary JSON. Use JSONB only where genuinely appropriate (configurable forms, structured extension fields, specialty-specific data).

**Background jobs (BullMQ)** for: notifications, SMS, email, PDF generation, report generation, long-running integrations, data synchronization, scheduled patient outreach, and laboratory processing where appropriate.

**Object storage** for: medical documents, lab reports, dental images, X-rays, patient/consultation attachments, medical certificates, consent documents, generated PDFs. Never store large binaries in PostgreSQL.

**Realtime** for: queue updates, lab status, notifications, telemedicine waiting room, operational dashboards.

---

## 2. Architectural principle — modular monolith

Start with a **modular monolith**. Do **not** start with microservices.

The NestJS API is one deployable application with strict domain boundaries. Extract a domain into a separate service only with a demonstrated requirement: independent scaling, isolated deployment, external integration requirements, workload characteristics, security isolation, or operational necessity. Never create microservices because they sound more enterprise-grade.

---

## 3. Nx monorepo structure

```
apps/
  staff/                Next.js — clinic, lab, dental, billing, admin staff      [exists]
  portal/               Next.js — patients                                       [exists]
  mobile/               Expo — patients (sign-in, results, push)                 [exists]
  api/                  NestJS modular monolith                                  [exists]
  notification-worker/  BullMQ worker                                            [exists]
  integration-worker/   BullMQ worker for external systems                       [exists]
  e2e/                  Playwright critical journeys (§31)                       [exists]
  instrument-gateway/   On-site analyzer gateway (HL7 v2 / ASTM → API)           [exists]

libs/
  ui/ domain/                                                                    [exist, frontend shared]
  core/ audit/ organization/ auth/ documents/ notification/                      [exist, backend platform]
  patient/ clinic/ prescription/ care-plan/ laboratory/ telemedicine/ billing/    [exist, backend domains]
  inventory/ dental/ crm/                                                        [exist]
  reporting/                                                                     [planned; ADR-0011]
  web-session/                                                                   [exists, frontend shared]
  interoperability/ (FHIR mapping) pdf/                                          [exist]
  philhealth/                                                                    [exists]

database/migrations/  tools/  docs/  infrastructure/ (docker/, terraform/railway/)
nx.json  package.json  pnpm-workspace.yaml  tsconfig.base.json (frontend)  tsconfig.node.json (backend)
```

`libs/ui` is the shared Healthcare Design System; `libs/domain` holds shared frontend clinical types. Appointments, queue and encounters live together in `libs/clinic` (their lifecycle is transactionally coupled — see `docs/architecture/decisions.md` ADR-0007); prescriptions and care plans are separate domain libraries.

Prefer domain-oriented libraries. Do not create hundreds of tiny libraries.

---

## 4. Architectural boundaries

Domains must not depend on each other's internal implementation.

```
BAD:  Dental  → directly modifies Laboratory tables
      Billing → directly accesses Clinic repositories
      Patient Portal → directly accesses Lab database implementation

GOOD: Clinic → Laboratory Order API (contract) → Laboratory
      Dental → Application contract → Core domain / integration
```

Use domain services, application services, commands, queries, events, contracts, DTOs, and repository interfaces where appropriate. Enforce boundaries with **Nx tags and `@nx/enforce-module-boundaries`**.

---

## 5. Core healthcare domain

The patient is the center of the system. There is exactly **one canonical Patient identity** — never separate patients for clinic, dental, laboratory, or telemedicine. Domains own domain-specific records linked to that identity.

```
Patient
├── Appointments        ├── Care Plans            ├── Referrals
├── Encounters          ├── Laboratory Orders     ├── Documents
├── Diagnoses           ├── Laboratory Results    ├── Billing
├── Medications         ├── Dental Records        └── Communications
├── Prescriptions       ├── Telemedicine Encounters
└── Vital Signs
```

---

## 6. Patient management

Registration, lookup, search, profile, demographics, contact information, emergency contacts, family relationships, dependents, allergies, medical/surgical/family/social history, medication history, immunization history, insurance/HMO, PhilHealth information, documents, consent, privacy preferences, duplicate detection, patient merge, patient status, and patient timeline.

The **patient timeline** unifies consultation, appointment, laboratory, prescription, dental, telemedicine, payment, care plan, and communication into one chronological view (`GET /patients/{id}/timeline`, staff `/patients/[id]/timeline`; `docs/domains/patient-timeline.md`).

## 7. Patient lookup

Fast lookup by patient number, name, date of birth, contact number, and other configured identifiers. Support duplicate detection. Do not expose sensitive information unnecessarily in search results.

## 8. Clinic module

See `libs/clinic/CLAUDE.md`. Covers registration (walk-in, appointment, check-in, triage, queue, visit type, provider assignment), appointments (doctor/clinic/room schedules, online booking, recurring, reschedule, cancel, waitlist, no-show, confirmation, reminder, online check-in), triage, consultation (SOAP-style without one rigid template), configurable diagnosis coding, and prescriptions.

## 9. Care plan

A first-class domain: goals, problems, interventions, medications, laboratory monitoring, follow-up appointments, referrals, patient tasks, provider tasks, target dates, status, progress. Care plans connect to appointments and laboratory orders.

```
Diabetes Care Plan: Diagnosis → HbA1c → Medication → Diet/lifestyle → Follow-up → Repeat labs
```

## 10. Telemedicine / online checkup

A complete clinical workflow, not a video-call button.

```
Patient: Book → Pre-consult questionnaire → Payment (if required) → Waiting room
         → Video consultation → Clinical encounter → Diagnosis → Prescription → Lab order → Follow-up
```

Doctor: online queue, patient history, previous encounters, lab history, available vitals, video, notes, diagnosis, prescription, lab order, referral, follow-up. Support medical certificates, digital documents, patient instructions, follow-up scheduling.

Do not imply every condition is suitable for telemedicine. Providers must be able to **escalate to in-person care**.

## 11. Dental

See `libs/dental/CLAUDE.md`. Same Patient Master — never a second patient database.

## 12–15. Laboratory (LIS, QC, inventory, trends)

See `libs/laboratory/CLAUDE.md`. Treat it as a serious LIS. **Never silently overwrite a released result.**

## 16. Healthcare CRM

Patient communication (SMS, email, push, in-app), appointment/follow-up/lab-result reminders, outreach, recall, no-show follow-up, chronic care follow-up, preventive-care reminders, campaigns, segmentation, communication history.

The CRM is subordinate to legitimate healthcare workflows and privacy requirements. Never implement marketing features that expose sensitive health information improperly. Respect consent and communication preferences.

## 17. Patient portal

Registration, authentication, appointment booking/management, online checkup, lab results, prescriptions, care plans, billing, payments, documents, messages, notifications, medical record requests, consent management.

Only release records/results that are **authorized for patient access**.

## 18. Billing

See `libs/billing/CLAUDE.md`. Keep billing logic separate from clinical logic.

## 19–20. PhilHealth, Philippine integrations, FHIR

See `libs/interoperability/CLAUDE.md`. A dedicated interoperability layer with replaceable adapters. Internal domain model and external interoperability model are separate concerns.

---

## 21. Security

First-class requirement: RBAC; organization-, facility-, and department-level access; provider, lab, billing, and patient permissions; MFA; secure sessions; rate limiting; encryption in transit and at rest where appropriate; secure file access via signed/private URLs; audit trail; access logging; data retention; backup; disaster recovery; secure secrets management.

Never expose healthcare records through uncontrolled APIs.

## 22. Audit trail

Every sensitive healthcare action is auditable. Record: who, what, when, which patient, which resource, which facility, what action, before/after where appropriate, reason where required, source/device where appropriate.

Examples: doctor viewed patient record; lab technician entered result; pathologist approved result; doctor modified encounter; patient accessed lab report; administrator changed permission; billing staff issued refund.

Audit events are append-only. Never silently overwrite important clinical history.

## 23. Core entities

```
Organization Facility Department User Role Permission Practitioner
Patient PatientIdentifier PatientContact PatientRelationship PatientConsent
Appointment QueueEntry
Encounter VitalSign Diagnosis Procedure ClinicalNote Prescription Medication
CarePlan CarePlanGoal CarePlanTask
LaboratoryOrder LaboratoryOrderItem Specimen SpecimenEvent
LaboratoryResult LaboratoryResultComponent LaboratoryApproval
DentalRecord DentalChart DentalProcedure
Invoice InvoiceItem Payment Claim
Document Communication Notification AuditEvent
```

Use proper foreign keys and constraints.

## 24. Database rules

The database enforces important invariants — never rely on frontend validation alone. Use foreign keys, unique constraints, check constraints, transactions, optimistic locking where useful, idempotency for external operations, and soft deletion only where appropriate.

Healthcare records are not casually deleted. Prefer statuses, archival, amendments, and audit history.

## 25. API design

REST + OpenAPI, versioned under `/api/v1`:

```
/api/v1/patients              /api/v1/laboratory/results
/api/v1/appointments          /api/v1/prescriptions
/api/v1/encounters            /api/v1/care-plans
/api/v1/laboratory/orders     /api/v1/billing/invoices
/api/v1/laboratory/specimens
```

Consistent pagination, filtering, sorting, error format, request IDs, idempotency keys where appropriate, and server-side authorization on every endpoint. Never return more patient information than the caller needs.

## 26. Events

Domain/application events for decoupling, e.g. `PatientRegistered`, `AppointmentBooked`, `AppointmentCheckedIn`, `EncounterCompleted`, `PrescriptionIssued`, `LaboratoryOrderCreated`, `SpecimenCollected`, `LaboratoryResultEntered`, `LaboratoryResultVerified`, `LaboratoryResultApproved`, `LaboratoryResultReleased`, `CarePlanCreated`, `FollowUpDue`, `PaymentCompleted`.

```
LaboratoryResultApproved → Audit | Notify → Patient Portal | Timeline
```

Not every event is asynchronous. Use synchronous transactions where immediate consistency is required.

## 27. Notification architecture

One `NotificationService` abstraction over SMS, email, push, and in-app channels, delivered through queues. Track sent, delivered (where supported), failed, retried, cancelled, template, recipient, and consent/communication preference.

## 28. Dashboards

- **Clinic:** today's appointments, waiting patients, queue, online consultations, no-shows, follow-ups, pending and critical lab results, provider workload.
- **Laboratory:** orders, specimens, pending tests, rejected specimens, results awaiting verification, critical results, turnaround time, workload, QC, equipment, inventory.
- **Management:** patient volume, revenue, services, provider and lab utilization, no-show rate, waiting time, lab TAT, patient retention, operational metrics.

## 29. UX principles

Users are healthcare workers under time pressure — no unnecessarily complicated workflows. Do not force all users into the same UI.

- **Doctors:** patient-centric "Patient 360" workspace — demographics, allergies, medications, alerts; current encounter (SOAP, diagnosis, orders, prescription); history (encounters, lab trends, imaging, care plan).
- **Laboratory staff:** a workbench optimized for throughput.
- **Reception:** a fast workflow.
- **Patients:** a simple mobile experience.

## 30. Offline-first consideration

Design for eventual offline support (registration, queue, vitals, selected documentation, printing, local encrypted temporary storage, sync after reconnect). Never implement unsafe synchronization — healthcare data conflicts need explicit resolution rules. Phase 1 exists (ADR-0013): capture and replay of registration, walk-in check-in and vital signs through the live routes with idempotency keys; refusals are parked for a person, never merged.

## 31. Testing

- **Unit:** domain logic, validation, calculations, authorization, clinical workflow rules.
- **Integration:** PostgreSQL, Redis, object storage, external integrations.
- **API:** authentication, authorization, validation, contracts.
- **E2E critical journeys:**
  - Registration → Appointment → Check-in → Consultation → Lab order → Specimen collection → Result → Approval → Patient portal
  - Online booking → Telemedicine → Prescription → Lab order → Follow-up

Never rely solely on frontend tests.

## 32. CI/CD

Every pull request runs, using Nx affected commands: lint → typecheck → affected unit tests → affected integration tests → affected E2E → build. Protect `main`; require passing CI.

## 33. Documentation

Maintain `docs/` (`architecture/`, `domains/`, `database/`, `api/`, `security/`, `interoperability/`, `deployment/`, `runbooks/`). Every major domain documents its purpose, entities, commands, queries, events, permissions, API, database relationships, and integration points. Use `docs/domains/_template.md`. Do not let undocumented business logic accumulate.

## 34. Coding standards

TypeScript strict mode, ESLint, Prettier, consistent naming, explicit domain boundaries, small cohesive modules, dependency inversion where appropriate, strong typing, no unnecessary `any`, no hidden global state, no duplicated business rules. Do not prematurely abstract. Prefer simple, readable code over clever code.

## 35. Healthcare safety principles

The software assists healthcare professionals; it must not pretend to independently diagnose patients. Any clinical decision support must be clearly labeled as decision support, show supporting information, avoid presenting suggestions as definitive diagnoses, allow provider override, log important interactions, use configurable rules, and warn about uncertainty. Never build autonomous medical decisions into ordinary CRUD workflows.

## 36. Philippine context

Design with consideration for the Data Privacy Act and National Privacy Commission guidance, DOH requirements, PhilHealth workflows (eClaims, YAKAP where applicable), facility licensing and clinical laboratory regulations, Philippine healthcare terminology, currency (PHP), address formats, mobile numbers, local date/time (Asia/Manila), and holidays where relevant.

- Open compliance items are registered in `docs/security/compliance-dependencies.md`; add a row when a feature stops short of a regulatory rule.
- Do not claim regulatory compliance merely because a feature exists. Compliance must be validated against current official requirements before production certification or deployment.
- **Never invent government APIs, regulatory requirements, or certification rules.** If a government integration is required but documentation is unavailable, mark it as an integration dependency instead of inventing an implementation.

## 37. Development process

Before a major feature: understand the domain → inspect the repository → identify existing patterns → check boundaries → design the data model → define API contracts → define permissions → define events → implement backend/domain → implement frontend → add tests → update documentation.

Do not rewrite working architecture unnecessarily. Do not add a library when an existing dependency already solves the problem.

## 38. Implementation priority

1. **Foundation** — Nx monorepo, authentication, organizations, facilities, users/roles, Patient Master, patient lookup, audit, documents, notifications
2. **Clinic** — appointments, queue, registration, triage, vital signs, encounters, diagnosis, prescription, care plan, clinical dashboard
3. **Laboratory** — catalog, orders, specimens, barcode, worklists, results, verification, approval, reports, result history
4. **Patient experience** — portal, online booking, notifications, communication, outreach, follow-up, lab result access
5. **Telemedicine** — online consultation, waiting room, video, prescription, lab orders, follow-up
6. **Dental** — dental record, odontogram, examination, treatment plans, procedures, imaging
7. **Billing** — charges, invoices, payments, discounts, HMO, insurance, PhilHealth
8. **Philippine integration** — PhilHealth/eClaims, DOH reporting, external systems, FHIR
9. **Advanced operations** — inventory, lab QC, equipment, procurement, multi-branch, advanced analytics, offline

Change the order only with a documented reason.

## 39. Standout features

Differentiate through connected workflows, not screen count:

- **Patient 360** — one unified timeline across consultation, lab, dental, prescription, telemedicine, care plan, billing, communication.
- **Doctor one-screen workspace** — patient → current encounter → history → lab trends → care plan → orders → prescription.
- **Connected lab** — consultation → order → specimen → testing → result → verification → approval → patient and doctor.
- **Digital care journey** — online booking → telemedicine → prescription → lab → result → follow-up → care plan.
- **Patient recall** — automatically identify patients due for configured follow-up.
- **Result trends** — longitudinal lab values, not isolated reports.
- **Offline capability** — for clinics with unreliable connectivity.

## 40. Engineering rules

**Never:**

- Expose database entities directly from controllers
- Put business logic in React components
- Put healthcare rules directly into SQL
- Let every module access every repository
- Delete clinical records without a documented policy
- Overwrite released lab results
- Store sensitive files directly in the database
- Hard-code government integration assumptions
- Put secrets in source control
- Skip authorization because the frontend hides a button
- Trust client-side validation
- Introduce microservices without a demonstrated reason

**Always:**

- Validate and authorize server-side
- Audit sensitive actions
- Use transactions for critical workflows
- Use idempotency for external operations
- Maintain history for important clinical records
- Protect patient data
- Keep integrations replaceable
- Write tests for critical workflows
- Keep domain boundaries explicit

## 41. When implementing code

Inspect the repository first. Do not assume files exist, invent APIs, invent tables, or silently change architecture. Follow established patterns unless there is a clear reason to improve them.

When requirements are ambiguous: choose the safest reasonable interpretation, state the assumption briefly, and implement so it can change later. Do not stop unnecessarily for minor clarification.

## 42. Output format for development tasks

1. **Understanding** — what you understand.
2. **Architecture impact** — apps, libraries, database changes, API changes, events, permissions, integrations.
3. **Implementation**
4. **Tests**
5. **Validation** — lint, typecheck, affected tests, build where appropriate.
6. **Summary** — files changed, features implemented, remaining limitations, follow-up recommendations.

Keep explanations concise unless detailed architectural analysis is requested.

## 43. Golden rule

The system behaves like a connected healthcare platform, not a collection of CRUD screens.

```
                    PATIENT
                       │
        ┌──────────────┼──────────────┐
      CLINIC         DENTAL          LAB
        └──────────────┼──────────────┘
                  PATIENT 360
        ┌──────────────┼──────────────┐
  TELEMEDICINE     CARE PLAN       BILLING
        └──────────────┼──────────────┘
                 PATIENT PORTAL
                       │
                   MOBILE APP
```

Always prioritize patient safety, privacy, clinical data integrity, interoperability, maintainability, and excellent user experience over unnecessary technical complexity.
