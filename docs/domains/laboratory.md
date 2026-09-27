# Laboratory (`libs/laboratory`)

## Purpose

The Laboratory Information System: test catalog and reference ranges, orders, specimen collection and receiving,
result entry, verification, approval, release, corrections, critical-result communication, worklists, trends and the
laboratory dashboard. Rules for this domain are in `libs/laboratory/CLAUDE.md`.

Not in scope yet: billing charges (Phase 7: the LIS emits events and never computes invoices), result attachments and
printed reports (PDF), instrument and outsourced-lab interfaces (`libs/interoperability`), QC, reagent lots and
inventory (Phase 9).

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
policy. Orders: create, cancel, cancel one test. Specimens: collect (assigns accession), receive, reject. Results:
enter, verify, approve (auto-release if the policy says so), release, release all approved on an order, correct,
cancel. Critical results: communicate, acknowledge.

## Queries

Catalog lists; orders by patient or encounter; order detail; barcode lookup by accession; specimen event log;
worklists by stage (`collect | receive | enter | verify | approve | release`, STAT first, optional department filter);
dashboard (per-stage counts, STAT open, overdue against turnaround time, released today, average collection-to-release
minutes, rejections today, unacknowledged criticals); a patient's released results; result history per test; trend of
one analyte (tests sharing a LOINC code line up) with each point's range snapshot; critical-result list.

## Events

`LaboratoryOrderCreated`, `LaboratoryOrderCancelled`, `LaboratoryOrderCompleted`, `SpecimenCollected`,
`SpecimenReceived`, `SpecimenRejected`, `LaboratoryResultEntered`, `LaboratoryResultVerified`,
`LaboratoryResultApproved`, `LaboratoryResultReleased`, `LaboratoryResultCorrectionStarted`,
`LaboratoryResultAmended` (a released result's correction was released), `LaboratoryResultCancelled`,
`CriticalResultRaised`, `CriticalResultCommunicated`, `CriticalResultAcknowledged`. Payloads carry ids, numbers,
statuses and the `critical` flag — never values, test names or clinical text.

The API (`apps/api/src/app/laboratory-notifications.ts`) sends the ordering practitioner an in-app notice
(`lab.result-notice`: order and patient numbers only) on `CriticalResultRaised` and `LaboratoryResultAmended`.
The API (`apps/api/src/app/portal/patient-result-notices.ts`) also tells patients who use MyHealth when results become
visible to them, and when a visible result is corrected (`lab.results-available`, no test or value).

**Patient visibility** (`LabPatientAccess`): current version, released, test `patient_releasable`, and — if critical —
alert acknowledged. See [portal-app.md](../architecture/portal-app.md).

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
  `POST specimens/:id/{receive,reject}`.
- Results: `POST order-items/:itemId/results` (enter), `GET order-items/:itemId/results` (history),
  `POST results/:id/{verify,approve,release,correct,cancel}`, `POST orders/:id/release`,
  `GET patients/:patientId/results`, `GET patients/:patientId/trends?testId=`.
- Critical results: `GET critical-results?status=`, `POST critical-results/:id/{communicate,acknowledge}`.
- `GET worklist?stage=&departmentId=`, `GET dashboard`.

Views and reads of patient results are audited (`lab.order.view`, `lab.order.list`, `lab.result.list`,
`lab.result.history`, `lab.result.trend`, `lab.worklist.view`); every change is audited in its transaction.

## Database relationships

Migration `0015_laboratory.sql`. Same-organization composite FKs throughout; same-patient FKs tie items, specimens,
results and critical alerts to their order's patient, and an order's encounter to the same patient. Triggers:
`lab_result_immutable`, `lab_reference_range_immutable`, `lab_specimen_event_append_only`, `lab_critical_alert_no_delete`.
Results reference instrument and method as text today; QC runs and reagent lots (Phase 9) can be linked later.

## Integration points

`LaboratoryContext` port (patient briefs and demographics, practitioner for a user and names, staff names, encounter
state) implemented in `apps/api/src/app/adapters/laboratory-adapters.ts` over `PatientRecordService`, `ClinicQueries`
and `UsersService`. Other domains order tests only through the API above; they never read laboratory tables.

## Staff app

Workbench, critical results, catalog, ordering from the encounter workspace, and results and trends on the patient
record: see [staff-app.md](../architecture/staff-app.md#laboratory).

## Open questions / assumptions

- Accession numbers are per facility per day; if a site needs a different format (prefixes, check digits for its
  barcode printers), make the format configurable.
- One accession per specimen container; aliquots and add-on tests to an existing specimen are not modelled yet.
- The order's facility is the collecting/performing laboratory; referral to another branch's laboratory is future work.
