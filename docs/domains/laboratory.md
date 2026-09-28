# Laboratory (`libs/laboratory`)

## Purpose

The Laboratory Information System: test catalog and reference ranges, orders, specimen collection and receiving,
result entry, verification, approval, release, corrections, critical-result communication, worklists, trends and the
laboratory dashboard. Rules for this domain are in `libs/laboratory/CLAUDE.md`.

Also: printable reports (PDF), specimen tube labels, and an archive of each released report in object storage.

Not in scope yet: result attachments, instrument and outsourced-lab interfaces (`libs/interoperability`), QC, reagent
lots and inventory (Phase 9). Billing charges are billing's (the LIS emits events and never computes invoices).

## Entities

**Catalog (organization configuration, audited):**

- `lab_department` — configurable sections (chemistry, hematology, serology…), not enums in code.
- `lab_specimen_type` — serum, EDTA whole blood, urine…, with container and collection instructions.
- `lab_test` — code, name, department, specimen type, optional LOINC code (the trend key), result type
  `numeric | text | coded`, unit and decimal places (numeric), allowed and abnormal values (coded), turnaround time,
  fasting requirement, and `patient_releasable` (whether released results may later be shown to the patient).
- `lab_reference_range` — per test, optionally per sex (`male`/`female`; none = any) and age band (days, upper bound
  exclusive), with normal and critical limits or a text range, **versioned by effective period**. A gist exclusion
  constraint forbids overlapping ranges for the same test, sex and ages; a trigger makes ranges immutable except for
  closing an open one. Adding a range for the same sex and band closes the previous one.
- `lab_panel` / `lab_panel_test` — ordered groups of tests; ordering a panel orders its active tests.
- `lab_facility_policy` — per facility: `allow_self_verification`, `allow_self_approval`, `release_on_approval`.
  Defaults (no row) are the safe choice: separation of duties, manual release. Changes need a reason and are audited.

**Workflow:**

- `lab_order` — number `LO########` per organization, patient, facility, optional encounter (same patient, enforced by a
  composite FK), ordering practitioner (or `external_orderer` for external requests), source
  `clinic | telemedicine | dental | external | patient_request`, priority `routine | stat | scheduled`, clinical
  indication, notes, `fasting_required` (from the tests), status `active | completed | cancelled`.
- `lab_order_item` — one per test, with a snapshot of the test code and name, the panel it came from, its specimen, and
  status `pending_collection → collected → received → resulted → released`, or `cancelled` (with reason).
- `lab_specimen` — accession number unique per facility (`YYMMDD` facility-local date + daily counter, allocated
  server-side in the collecting transaction), collector and time, receiving, rejection with reason.
  Status `collected | received | rejected | stored | disposed`.
- `lab_specimen_event` — append-only log of every specimen transition (who, when, reason).
- `lab_result` — one row per **version** of a test's result: value by type, unit, flag
  (`normal | low | high | critical_low | critical_high | abnormal`), `critical`, the **reference-range snapshot**
  (limits, text and range id at entry), comment, method, instrument, `patient_releasable` (copied from the test), and
  the sign-offs (entered, verified, approved, released — each who and when; `self_verified` / `self_approved` record
  policy exceptions). Status `entered → verified → approved → released`, `superseded` (replaced by a newer version) or
  `cancelled` (unreleased only).
- `lab_critical_alert` — raised when a critical result is verified; `open → communicated` (to whom, how, read-back
  confirmed, note) `→ acknowledged` (by the ordering side).

## Rules

- **Released results are never overwritten.** Values of every version are immutable (trigger `lab_result_guard`):
  only the status moves forward, sign-offs once written cannot change, rows cannot be deleted. A correction adds a new
  version (`supersedes_result_id`, `correction_reason`), marks the previous one `superseded` (still readable in the
  history) and goes through verification and approval again. Correcting a released result needs `lab.result.amend`;
  correcting an unreleased one needs `lab.result.enter`. At most one current version per test (partial unique index).
- **Reference ranges are snapshotted at entry.** The range is chosen for the patient's sex and age (days, on the
  facility-local date) among ranges effective at that moment; a sex-specific range beats an "any" range. Patients
  recorded as intersex or of unknown sex get "any" ranges only — the system never guesses. Flags compare the value
  against the snapshot; they are **interpretation aids, not diagnoses**.
- **Separation of duties.** The person who entered a result may not verify or approve it unless the facility policy
  allows it; such sign-offs are recorded as self sign-offs. The database checks the same (`verified_by <> entered_by OR
self_verified`). Holding the permission is required in every case.
- Results are entered only after the specimen is received, at the facility of the order. Numeric values respect the
  test's decimal places; coded values must be one of the allowed values.
- **Visibility.** Before release, results are visible only to laboratory staff (holders of `lab.result.enter`, `verify`,
  `approve`, `release` or `amend`). Clinicians see released results; while a released result is being corrected they
  see no current value for that test. The history endpoint shows other users only versions that were released.
- **Rejection.** Rejecting a specimen cancels its unreleased results and returns its tests to collection (recollection
  requested) or cancels them. A specimen with released results cannot be rejected — correct the results instead.
- Orders from an encounter need the encounter in progress and a practitioner linked to the account; external orders
  record the requesting physician; patient requests need no practitioner. An order completes when every test is
  released or cancelled and reopens if a released result is corrected.
- Regulatory requirements (DOH laboratory licensing, reporting, retention) are **not encoded**. Validate them against
  current official issuances and add them as configuration with a documented source.

## Commands

Catalog: create/update departments, specimen types, tests; add reference ranges; create/update panels; set facility
policy. Orders: create, cancel, cancel one test. Specimens: collect (assigns accession), print tube labels, receive,
reject. Results:
enter, verify, approve (auto-release if the policy says so), release, release all approved on an order, correct,
cancel. Critical results: communicate, acknowledge.

## Queries

Catalog lists; orders by patient or encounter; order detail; barcode lookup by accession; specimen event log;
worklists by stage (`collect | receive | enter | verify | approve | release`, STAT first, optional department filter);
dashboard (per-stage counts, STAT open, overdue against turnaround time, released today, average collection-to-release
minutes, rejections today, unacknowledged criticals); a patient's released results; result history per test; trend of
one analyte (tests sharing a LOINC code line up) with each point's range snapshot; critical-result list; a patient's
archived reports and the stored PDF of one.

## Events

`LaboratoryOrderCreated`, `LaboratoryOrderCancelled`, `LaboratoryOrderCompleted`, `SpecimenCollected`,
`SpecimenReceived`, `SpecimenRejected`, `LaboratoryResultEntered`, `LaboratoryResultVerified`,
`LaboratoryResultApproved`, `LaboratoryResultReleased`, `LaboratoryResultCorrectionStarted`,
`LaboratoryResultAmended` (a released result's correction was released), `LaboratoryResultCancelled`,
`CriticalResultRaised`, `CriticalResultCommunicated`, `CriticalResultAcknowledged`, `LaboratoryReportReleased` (once per
releasing transaction: the order and the ids of every result version then released — what the report shows). Payloads
carry ids, numbers, statuses and the `critical` flag — never values, test names or clinical text.

`LabReportArchive` (in this library) handles `LaboratoryReportReleased`: it records a `lab_report_archive` row for the
order and that set of result versions (idempotent: SHA-256 of the sorted ids) and queues it on BullMQ; the consumer
renders the report and stores it through `libs/documents`. See [Report archive](#report-archive).

The API (`apps/api/src/app/laboratory-notifications.ts`) sends the ordering practitioner an in-app notice
(`lab.result-notice`: order and patient numbers only) on `CriticalResultRaised` and `LaboratoryResultAmended`.
The API (`apps/api/src/app/portal/patient-result-notices.ts`) also tells patients who use MyHealth when results become
visible to them, and when a visible result is corrected (`lab.results-available`, no test or value).

**Patient visibility** (`LabPatientAccess`): current version, released, test `patient_releasable`, and — if critical —
alert acknowledged. See [portal-app.md](../architecture/portal-app.md).

## Realtime

Laboratory events are pushed on the Socket.IO `/realtime` gateway (the one the queue uses) as `lab.updated`, to sockets
whose user holds `lab.order.read` at the event's facility (room `laboratory:<facility>`). The message is built from an
allow-list (`apps/api/src/app/realtime/lab-updates.ts`): `{ event, kind: order|specimen|result|critical, id, orderId,
status, critical, occurredAt }` — no patient, test, value, order or accession number. Events: order created, cancelled,
completed; specimen collected, received, rejected; result entered, verified, approved, released, correction started,
amended, cancelled; critical raised, communicated, acknowledged. The staff workbench, the critical-results page and
the dashboard re-read through the REST API when a message arrives (debounced), and poll every 15 s while the socket is
down. One API instance holds the sockets (no Socket.IO Redis adapter yet — the same limit as the queue).

## Permissions

| Permission             | Physician | Nurse | Records | Med. technologist | Pathologist | Phlebotomist |
| ---------------------- | :-------: | :---: | :-----: | :---------------: | :---------: | :----------: |
| `lab.order.read`       |     ✓     |   ✓   |    ✓    |         ✓         |      ✓      |      ✓       |
| `lab.order.create`     |     ✓     |       |         |         ✓         |             |              |
| `lab.order.cancel`     |     ✓     |       |         |                   |             |              |
| `lab.specimen.collect` |           |   ✓   |         |         ✓         |             |      ✓       |
| `lab.specimen.receive` |           |       |         |         ✓         |             |              |
| `lab.specimen.reject`  |           |       |         |         ✓         |             |              |
| `lab.result.read`      |     ✓     |   ✓   |    ✓    |         ✓         |      ✓      |              |
| `lab.result.enter`     |           |       |         |         ✓         |             |              |
| `lab.result.verify`    |           |       |         |         ✓         |      ✓      |              |
| `lab.result.approve`   |           |       |         |                   |      ✓      |              |
| `lab.result.release`   |           |       |         |                   |      ✓      |              |
| `lab.result.amend`     |           |       |         |                   |      ✓      |              |
| `lab.critical.manage`  |           |       |         |         ✓         |      ✓      |              |
| `lab.catalog.manage`   |           |       |         |                   |      ✓      |              |
| `lab.dashboard.read`   |           |       |         |         ✓         |      ✓      |              |

Organization administrators hold all of them. `medical_technologist`, `pathologist` and `phlebotomist` are new system
roles (migration `0015`); assign them per facility for laboratory staff.

## API

Under `/api/v1/laboratory` (OpenAPI tag `laboratory`):

- Catalog: `GET/POST departments`, `PATCH departments/:id`, `GET/POST specimen-types`, `PATCH specimen-types/:id`,
  `GET/POST tests`, `GET/PATCH tests/:id`, `POST tests/:id/reference-ranges`, `GET/POST panels`, `PATCH panels/:id`,
  `GET/PUT policy` (selected facility).
- Orders: `POST orders` (Idempotency-Key), `GET orders?patientId=|encounterId=`, `GET orders/:id`,
  `POST orders/:id/cancel`, `POST orders/:id/items/:itemId/cancel`.
- Specimens: `POST orders/:id/specimens` (collect), `GET specimens/by-accession/:accession`, `GET specimens/:id/events`,
  `GET specimens/:id/label.pdf?copies=` (`lab.specimen.collect`, selected facility, 1–10 copies),
  `POST specimens/:id/{receive,reject}`.
- Results: `POST order-items/:itemId/results` (enter), `GET order-items/:itemId/results` (history),
  `POST results/:id/{verify,approve,release,correct,cancel}`, `POST orders/:id/release`,
  `GET patients/:patientId/results`, `GET patients/:patientId/trends?testId=`, `GET orders/:id/report.pdf`.
- Archived reports (`lab.order.read` + `lab.result.read`): `GET patients/:patientId/report-archive`,
  `GET report-archive/:id/report.pdf`.
- Critical results: `GET critical-results?status=`, `POST critical-results/:id/{communicate,acknowledge}`.
- `GET worklist?stage=&departmentId=`, `GET dashboard`.

Views and reads of patient results are audited (`lab.order.view`, `lab.order.list`, `lab.result.list`,
`lab.result.history`, `lab.result.trend`, `lab.worklist.view`, `lab.specimen.label-print`, `lab.report.print`,
`lab.report.archive.list`, `lab.report.archive.download`); every change is audited in its transaction (archiving:
`lab.report.archive.schedule`, `lab.report.archive`, and `document.generate` by the documents library).

## Database relationships

Migrations `0015_laboratory.sql` and `0030_lab_report_archive.sql`. Same-organization composite FKs throughout; same-patient FKs tie items, specimens,
results and critical alerts to their order's patient, and an order's encounter to the same patient. Triggers:
`lab_result_immutable`, `lab_reference_range_immutable`, `lab_specimen_event_append_only`, `lab_critical_alert_no_delete`,
`lab_report_archive_immutable` (a stored archive never changes; none is deleted). `lab_report_archive` references its
order, patient, facility and the `document` holding the PDF (same id); unique per order and result set, and per order and
archive version.
Results reference instrument and method as text today; QC runs and reagent lots (Phase 9) can be linked later.

## Integration points

`LaboratoryContext` port (patient briefs and demographics, practitioner for a user and names, staff names, encounter
state) implemented in `apps/api/src/app/adapters/laboratory-adapters.ts` over `PatientRecordService`, `ClinicQueries`
and `UsersService`. Other domains order tests only through the API above; they never read laboratory tables. Archived
reports are stored through `DocumentsService` (`libs/documents`, a shared platform service): private S3-compatible
storage, category `laboratory_report`, source `generated`.

## Staff app

Workbench, critical results, catalog, ordering from the encounter workspace, and results and trends on the patient
record: see [staff-app.md](../architecture/staff-app.md#laboratory).

## Open questions / assumptions

- Accession numbers are per facility per day; if a site needs a different format (prefixes, check digits for its
  barcode printers), make the format configurable.
- One accession per specimen container; aliquots and add-on tests to an existing specimen are not modelled yet.
- The order's facility is the collecting/performing laboratory; referral to another branch's laboratory is future work.

## Printable reports

Per order, released results only (`LabReportService`); staff and patient copies — see
[printable-documents.md](../architecture/printable-documents.md).

## Specimen labels

`LabLabelService`: one label per page on 2.25 × 1.25 in (57 × 32 mm) stock, for the thermal label printers laboratories
use. **Code 128** barcode of the accession number (code set C for the all-digit accession: short enough for a tube;
set B otherwise) — the linear symbology every handheld scanner reads, and what the workbench's scan field receives.
Encoded in `libs/pdf` (`barcode.ts`, no extra dependency) and checked with an independent decoder. Only what identifies
the specimen at the bench is printed: patient name and number, sex/age, specimen type, STAT, collection time (facility
time zone) and test codes — no birth date, address, indication, orderer or results. Rejected specimens are not
labelled. Printing is `lab.specimen.collect` at the specimen's facility, and audited.

## Report archive

Each release of an order's results (a single result, "release all", or approval with release-on-approval) records one
`LaboratoryReportReleased` event with the result versions then released. The archive keeps one PDF per order and set:
releasing another test of the order, or releasing a correction, adds the next `archive_version`; earlier versions stay
as they were (object written with a conditional put that never replaces, database trigger against changes). The PDF is
the staff copy, labelled "Archived copy, version N", with tests not yet released listed as pending.

Why BullMQ and not the outbox alone: rendering and uploading take longer than an outbox handler should (the relay
dispatches events in one transaction); the queue gives retries with backoff and a bounded concurrency, while the outbox
gives the durable, at-least-once hand-off from the release transaction. The consumer (`LabReportArchiveWorker`) runs
in the API process, started in `main.ts` — rendering needs the laboratory's data and the patient adapters wired only in
the API's composition root; it can move to its own process by composing the same module there. Pending archives whose
job was lost are re-queued every 5 minutes; after 8 failed attempts an archive is marked `failed` (shown to staff).
