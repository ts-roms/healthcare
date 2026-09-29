# Laboratory quality management (`libs/laboratory`, Phase 9)

## Purpose

The first part of the laboratory's quality management (`libs/laboratory/CLAUDE.md`, "Quality management"): the
**instrument register** with its maintenance and calibration log, **internal quality control** (control materials,
lots, target mean/SD per test and instrument, QC runs evaluated with Westgard multirules, corrective actions), and the
link from each **patient result** to the instrument it was measured on and the QC in force when it was entered.

It also records **reagent lots** (inventory lots of reagent items) loaded on each instrument; results and QC runs keep
the lots in use when they were entered.

The rest of the quality system (migration `0055`): **temperature logs** of storage units (refrigerators, freezers,
incubators, rooms) with excursions, **nonconformances** (incidents) with their investigation and corrective and
preventive actions (CAPA), **proficiency testing** (external quality assessment, EQA) rounds with reported results and
the provider's evaluation, and **staff competency** assessments per test or section, optionally required for result
entry.

Code: `libs/laboratory/src/lib/quality` (`LabQualityService`, `LabReagentService`, `qc.rules.ts`), migrations
`0050_lab_quality.sql`, `0051_lab_reagent_lots.sql` and `0064_lab_reagent_use.sql` (reagent use per test run), staff `/laboratory/qc` and `/laboratory/instruments`; quality
management in `LabTemperatureService`, `LabNonconformanceService`, `LabEqaService`, `LabCompetencyService`,
`quality-management.rules.ts`, migration `0055_lab_quality_management.sql`, staff `/laboratory/temperatures`,
`/laboratory/nonconformances`, `/laboratory/eqa` and `/laboratory/competency`.

Not yet: instrument interfaces (results and QC values arriving from analyzers through `libs/interoperability`). QC is for
numeric tests. Loading a lot can take that lot's stock from a storage location of the facility in the same transaction
(migration `0054_lab_reagent_stock.sql`); otherwise stock is issued to the laboratory separately.

Not yet either: electronic EQA exchange with providers (results are entered by hand), automatic temperature sensors,
and documents attached to nonconformances. Reminders are in-app only (no SMS or email to staff).

No regulatory rule is encoded. Which rules reject a run, how long a run covers patient results, whether patient
results need QC, storage limits and reading intervals, EQA schemes, competency areas and intervals, and what a
nonconformance needs before it closes beyond the platform's minimum are **facility configuration** or the laboratory's
own procedure; confirm them against the laboratory's QC plan and the applicable DOH
issuances.

## Entities

- **Instrument** (`lab_instrument`) — per facility: code, name, department, manufacturer, model, serial number, status
  `active | out_of_service | retired`. An instrument that is not active cannot be used for QC or patient results.
- **Instrument log** (`lab_instrument_event`, append-only) — maintenance, calibration and verification (outcome
  pass/fail required), repair, and status changes (out of service, returned to service, retired; notes required),
  with when it was done and when it is next due. The instrument list shows the last calibration and maintenance and
  flags a calibration whose next due date has passed (a reminder; it does not block use).
- **Control material** (`lab_qc_material`) — code, name, level as the manufacturer names it.
- **Control lot** (`lab_qc_lot`) — lot number and expiry; retired lots take no new targets or runs; expired lots take no
  runs.
- **Target** (`lab_qc_target`) — mean and SD of a lot for a test on an instrument, with its source; **versioned**: a new
  target closes the current one (`effective_to`), nothing is rewritten (trigger), one current target per lot, test and
  instrument (partial unique index).
- **QC run** (`lab_qc_run`, append-only) — the control value, the target it was read against (snapshot), the z-score,
  the evaluation `accepted | warning | rejected` and the rules that fired.
- **Corrective action** (`lab_qc_action`, append-only) — cause and action for a warning or rejected run.
- **Result** (`lab_result`, new columns) — `instrument_id`, `qc_run_id` and `qc_status` (`accepted | warning | rejected |
none`): a snapshot of the QC in force at entry, immutable like the value (trigger `lab_result_quality_immutable`).
- **Reagent load** (`lab_reagent_load`) — an inventory reagent lot loaded on an instrument, for every test on it
  (`test_id` null) or one test: inventory item and lot ids plus a snapshot (item code and name, lot number, expiry),
  who loaded it and when; unloaded once (who, when, reason — "Replaced by lot …" when a new lot of the same reagent is
  loaded). One lot of a reagent in use per instrument and test scope (partial unique index); history only changes by
  unloading (trigger) and is never deleted.
- **Reagent yield** (`lab_reagent_yield`, migration `0064`) — per reagent item of the organization: the tests one stock
  unit holds (1–1,000,000), with a snapshot of the item's code, name and stock unit; set by `lab.qc.manage` (audited
  with the previous value). Applies to loads made afterwards.
- **Load capacity** (`lab_reagent_load.capacity_tests`, migration `0064`) — the tests a load holds: the number given at
  the load, else the stock taken times the reagent's yield, else unknown (null). Fixed with the load (guard trigger).
- **Reagent use** (`lab_reagent_use`, migration `0064`, append-only) — each test run counted against a load: `patient`
  (the order, the result that recorded it and its version as `run_number`; unique per load, order and version),
  `qc` (the QC run; unique per load and run), or use recorded by staff with a reason — `repeat` (a re-run not entered as
  a result), `calibration`, `priming`, `waste`, `other` — with a number of tests. Who and when.
- **Reagents on results and runs** (`lab_result_reagent`, `lab_qc_run_reagent`, append-only) — the loads in use when the
  result was entered or the QC run recorded.
- **Facility policy** (`lab_facility_policy`, new columns) — `qc_reject_rules` (default `1_3s, 2_2s, R_4s`),
  `qc_valid_hours` (default 24, 1–168), `qc_required` (default false), `qc_after_reagent_change` (default true),
  `competency_required` (default false).
- **Storage unit** (`lab_storage_unit`) — per facility: code, name, kind (`refrigerator | freezer | incubator |
water_bath | room | other`), optional department, acceptable range (min < max °C), reading interval (1–168 h), status
  `active | retired`; versioned, changes need a reason.
- **Temperature reading** (`lab_temperature_reading`, append-only) — the value, when it was read, who read it, the range
  in force (snapshot) and `out_of_range` (checked against the snapshot by the database); a note is required when out of
  range.
- **Nonconformance** (`lab_nonconformance`) — `NC########` per organization, facility, category (`pre_analytical,
analytical, post_analytical, equipment, temperature_excursion, qc_failure, eqa_failure, safety, complaint, other`),
  severity `minor | major | critical`, title, description, when it happened, optional links (instrument, QC run,
  temperature reading, EQA result, specimen — one nonconformance per reading and per EQA result), status
  `open | investigating | closed`. Links, occurrence and reporter never change; a closed record never changes and none is
  deleted (trigger).
- **Nonconformance entry** (`lab_nonconformance_entry`, append-only) — the investigation record: `note, correction,
root_cause, corrective_action, preventive_action, effectiveness_check`, plus `reclassified` and `closed` written by the
  platform.
- **EQA scheme** (`lab_eqa_scheme`, organization) — code, provider, name, status. **Survey** (`lab_eqa_survey`) — a round
  received at a facility (round code unique per scheme and facility, received and due dates). **EQA result**
  (`lab_eqa_result`) — sample code, test, the value reported (text, as sent), who reported it; then, once, the provider's
  evaluation `acceptable | unacceptable | not_graded` with target, score and note (trigger).
- **Competency assessment** (`lab_competency_assessment`, append-only) — a staff member assessed at a facility for a test
  **or** a whole section (department): method (`direct_observation, blind_sample, record_review, written_assessment,
other`), outcome `competent | not_yet_competent` (notes required), assessed on, next due (after the assessment), by
  whom (never the person assessed).

## Rules

**Evaluation** (`qc.rules.ts`). A control value becomes a z-score against its target and is read with up to nine earlier
controls of the **same test on the same instrument, across control levels** (as z-scores, so levels run together are
compared):

| Rule   | Fires when                                                                      |
| ------ | ------------------------------------------------------------------------------- |
| `1_2s` | one control beyond ±2 SD — always a warning, never a rejection                  |
| `1_3s` | one control beyond ±3 SD                                                        |
| `2_2s` | two consecutive controls beyond 2 SD on the same side                           |
| `R_4s` | two consecutive controls of different lots more than 4 SD apart, opposite sides |
| `4_1s` | four consecutive controls beyond 1 SD on the same side                          |
| `10_x` | ten consecutive controls on the same side of the mean                           |

A run is **rejected** when a rule the facility chose fires, a **warning** when only other rules fire, otherwise
**accepted**. Runs are serialized per instrument (row lock), so each is evaluated against the series that includes the
one before it. Simplification: "within-run" rules (R_4s) use the previous control of another level, not a declared
analytical run.

**QC state of a test on an instrument**: the latest run of each control lot within the facility's window; the
**decisive run** is the worst of them (the newest among equals) — a newer accepted level does not hide a rejected one.

**Reagent lots.** Only inventory items of category `reagent`, active, and lots not expired (facility date) are loaded.
The lots that apply to a test on an instrument are those loaded for the test and those loaded for every test. An
expired lot in use refuses QC runs and results on that test (`reagent_lot_expired`) until a new lot is loaded or it is
unloaded. With `qc_after_reagent_change` (default), the QC window of a test starts at the newest load of a lot in use
for it, so only runs after a lot change count — the board shows "No QC" until the new lot has been controlled.

**Reagent use per test run.** A patient run is an order measured on the instrument: when a result is entered (or
corrected) with `instrumentId`, each load that applies counts one run for the order and the result version, so the
tests of a panel entered for one order count once and a correction entered on the instrument counts as a re-run. Each
QC run counts one run on each load that applies. Repeats not entered as results, calibration, priming and waste are
recorded by staff on a loaded lot (never on an unloaded one: `reagent_lot_unloaded`), with a reason. Runs never move
stock — stock leaves inventory when the lot is loaded — and never refuse a result or a QC run: use beyond the stated
capacity is shown as such. A loaded lot with a tenth of its capacity or less left is **running low**
(`REAGENT_LOW_SHARE`). What is left when a lot is unloaded is its unused part. The **cost per patient run** of an
unloaded lot whose stock came from inventory is what that stock cost (inventory's cost on the issue movements) divided by
its patient runs — QC, repeats, calibration, waste and the unused part included; unknown while in use, without a cost or
without patient runs. Operational figures, not an accounting valuation. Runs recorded before migration `0064` (the lots
on results and QC runs) were counted by the migration.

**Patient results.** Entering (or correcting) a result with `instrumentId`: the instrument must be active at the order's
facility; the decisive run is linked and its status snapshotted (`none` when no run is in the window). When the facility
sets `qc_required`, no run in the window, or a rejected decisive run, refuses the result (`qc_not_accepted`). The reagent
lots in use are recorded on the result. Results
without an instrument (manual methods) are not gated. The workbench shows the QC state on each result so verifiers see
results entered while QC was rejected.

**Temperatures.** A reading outside the unit's range (limits inclusive) needs a note and opens a nonconformance
(`temperature_excursion`, major) linked to it. A unit is **due** when its last reading is older than its interval (a
reminder; nothing is blocked).

**Nonconformances.** Opened by staff (optionally naming a specimen by accession number, an instrument, a QC run) or by
the platform: a temperature excursion, an unacceptable EQA result. The first investigation entry that is not a note moves
it to _investigating_. Closing (`lab.qc.manage`) needs at least a root cause, a corrective action and an effectiveness
check (`nonconformance_incomplete` lists what is missing) and a summary; reclassifying category or severity needs a
reason. Both are recorded as entries.

**EQA.** Results are reported before the evaluation; the evaluation is recorded once. An unacceptable result opens an
`eqa_failure` nonconformance (major). A survey is _received_, _reported_ (all results in) or _evaluated_.

**Competency.** Only staff who may enter results at the facility are assessed; no one assesses themselves; the date is
not in the future. The state of an area is the latest assessment: _competent_, _reassessment due_ (past its next due
date), _not yet competent_. For a test, its own latest assessment counts first, else its section's. With
`competency_required`, entering or correcting a result needs a current _competent_ state for the test
(`competency_required` otherwise; the message names why).

## Commands

Load a reagent lot on an instrument (replacing the lot of the same reagent in use), optionally taking a quantity of that
lot from a storage location (`takeFromStock: { locationId, quantity }`; needs `inventory.move` too; an inventory issue
with source `lab_reagent_load` and the instrument code as reference — refused with the load if the stock is short; inventory also accepts only `REAGENT_CATEGORY` items for it) and stating the tests it holds (`capacityTests`); unload a lot (reason);
record reagent use on a loaded lot (kind, tests, reason); set a reagent's yield (`lab.qc.manage`);
register/update instruments; record log entries (retiring needs `lab.qc.manage`); create materials and lots; retire a
lot; set a target; record a QC run; record a corrective action; change the facility QC policy (with the laboratory
policy, reason required, audited). Register, update or retire a storage unit; record a reading; report a
nonconformance, add investigation entries, reclassify, close; create EQA schemes and rounds, report results, record the
evaluation; record a competency assessment.

## Queries

Instruments at the selected facility (optionally retired) with last calibration/maintenance and overdue flag; an
instrument's log; materials with lots and current targets; the QC board (each test with a current target on each
instrument: latest run per level in the window, decisive run, whether results are allowed); runs of a test on an
instrument (optionally one lot, last N days) for the Levey-Jennings chart, with corrective actions and reagent lots;
reagent lots in use at the facility (optionally one instrument), an instrument's load history, and the reagent lots in
stock at the facility (from inventory) that can be loaded; each load carries its use (patient, QC, other runs, wasted,
total, capacity, remaining, running low). The runs counted against a load (latest 500); reagent yields; **reagent
use** over a period of up to 366 local days (facility time zone): the loads in use during the period with the runs in
the period and over their life, stock cost, cost per patient run and unused capacity at unload, and per reagent the
runs in the period and the share that were not patient runs. Storage units with their last reading, whether a reading
is due and excursions in the last 7 days; a unit's readings (last N days, default 31); nonconformances (open,
closed, all) and one with its entries and what it still needs to close; EQA schemes and rounds with results; each
result-entering staff member's latest assessment per area, and one person's history. The **quality summary**
(`LabQualitySummaryService`, built from the same queries as the pages): open nonconformances (investigating, critical,
major), QC pairs rejected, missing in the window or refusing patient results, instruments out of service or with
calibration overdue, storage units with a reading due or out of range at the last reading and excursions in 7 days, EQA
rounds past due with nothing reported or awaiting evaluation, and competency areas due or not yet competent and staff
never assessed.

## Events

`LaboratoryQcRunRejected` (run id, instrument, test, lot, rules, who entered it — no values), `LaboratoryInstrumentStatusChanged` (from,
to), `LaboratoryReagentLotLoaded` (load, inventory lot, test, replaced load), `LaboratoryReagentLotUnloaded`,
`LaboratoryReagentUseRecorded` (load, use, kind, tests — staff-recorded use only),
`LaboratoryTemperatureExcursion` (reading, unit, nonconformance), `LaboratoryNonconformanceOpened` (number, category,
severity, who reported it), `LaboratoryNonconformanceClosed`, `LaboratoryEqaResultUnacceptable` (result, survey, test,
nonconformance) — ids only.

**Notifications** (`apps/api/src/app/laboratory-quality-notifications.ts`): on `LaboratoryNonconformanceOpened` (by
staff, a temperature excursion or an unacceptable EQA result) and `LaboratoryQcRunRejected`, every active user holding
`lab.qc.manage` at the event's facility (organization-wide or facility role) gets an in-app `lab.quality-notice`, except
the person whose action raised it. The message names the record number, category and severity, or the instrument code,
test name and rules; never a patient, specimen, title, description or control value. It links to the nonconformance or
to `/laboratory/qc`. One message per event and recipient (idempotency key), so redelivered events are not repeated.

**Reminders** (`apps/api/src/app/laboratory-quality-reminders.ts`, hourly in the API process, advisory lock; what is due
comes from `LabQualityDue` in the library):

- **Temperature reading missed**: an active unit with a reading interval whose last reading (or, never read, its
  registration) is older than the interval. The facility's quality managers get one `lab.quality-notice` per missed
  reading (key: unit and last reading), so a unit left unread is reminded once, and again after the next missed
  interval once a reading was recorded.
- **Competency reassessment due**: the latest assessment of an area (test or section) is competent and its next due
  date has passed in the facility's time zone. The person (while they still enter results at the facility) and the
  quality managers get one message per assessment; a new assessment ends it.

## Permissions

| Permission      | Roles                                        | Allows                                                  |
| --------------- | -------------------------------------------- | ------------------------------------------------------- |
| `lab.qc.read`   | org_admin, medical_technologist, pathologist | QC board, runs, materials, instruments and their logs   |
| `lab.qc.enter`  | org_admin, medical_technologist, pathologist | QC runs, corrective actions, instrument log entries     |
| `lab.qc.manage` | org_admin, pathologist                       | Instruments, control materials, lots, targets; retiring |

Quality management uses the same permissions (no new ones): `lab.qc.read` reads temperatures, nonconformances, EQA and
competency; `lab.qc.enter` records readings, reports nonconformances and adds entries, records EQA rounds, results and
evaluations; `lab.qc.manage` sets up storage units and EQA schemes, reclassifies and closes nonconformances and records
competency assessments.

The QC and competency policy is part of the laboratory policy (`lab.catalog.manage`). Instrument, run and board endpoints are scoped to
the selected facility.

## API

Under `/api/v1/laboratory` (OpenAPI tag `laboratory quality`): `GET/POST instruments`, `PATCH instruments/:id`,
`GET/POST instruments/:id/log`, `GET/POST qc/materials`, `POST qc/materials/:id/lots`, `POST qc/lots/:id/retire`,
`POST qc/lots/:id/targets`, `GET qc/status`, `GET qc/runs?instrumentId=&testId=&qcLotId=&days=`, `POST qc/runs`,
`POST qc/runs/:id/actions`, `GET reagents?instrumentId=`, `GET reagents/available`, `GET/POST instruments/:id/reagents`,
`POST reagents/:loadId/unload`, `GET/POST reagents/:loadId/uses`, `GET reagents/yields`, `PUT reagents/yields/:itemId`
(`lab.qc.manage`), `GET reagents/usage?from=&to=&instrumentId=`, `GET/POST storage-units`, `PATCH storage-units/:id`,
`GET/POST storage-units/:id/readings`, `GET/POST nonconformances?status=`, `GET nonconformances/:id`,
`POST nonconformances/:id/entries | reclassify | close`, `GET/POST eqa/schemes`, `GET/POST eqa/surveys`,
`POST eqa/surveys/:id/results`, `POST eqa/results/:id/evaluation`, `GET/POST competency`,
`GET competency/users/:userId`, `GET quality/summary` (`lab.qc.read`, selected facility). `PUT policy` accepts `qcRejectRules`, `qcValidHours`, `qcRequired`,
`qcAfterReagentChange`, `competencyRequired` (left out: unchanged). Results and QC runs carry `reagents`.
`POST order-items/:itemId/results` and `POST results/:id/correct` accept `instrumentId`.

Audit: `lab.instrument.create | update | log`, `lab.qc.material.create`, `lab.qc.lot.create | retire`,
`lab.qc.target.set`, `lab.qc.run.record`, `lab.qc.action.record`, `lab.reagent.load | unload | use | yield`, `lab.policy.update`,
`lab.storage-unit.create | update`, `lab.temperature.record`, `lab.nonconformance.open | entry | reclassify | close`,
`lab.eqa.scheme.create`, `lab.eqa.survey.create`, `lab.eqa.result.report | evaluate`, `lab.competency.record`.

## Database relationships

Composite same-organization foreign keys throughout (instrument → facility and department; target → lot, test,
instrument; run → facility, instrument, test, lot, target; result → instrument and run). Append-only: instrument log,
runs, actions (`prevent_mutation`); targets immutable except closing (trigger); result QC link immutable. Temperature
readings, nonconformance entries and competency assessments are append-only; nonconformances and EQA results are guarded
by triggers (above). Nonconformances link to instrument, QC run, reading, EQA result and specimen by composite foreign
keys.

## Integration points

- Inventory (`libs/inventory`): reagent lots are inventory lots. The laboratory reads them through its
  `LaboratoryContext` port (`inventoryLot`, `reagentLotsInStock`), implemented in the API over `InventoryQueries`; the
  laboratory never imports inventory. The database links loads to `inventory_item` / `inventory_lot` by composite
  foreign keys. Loading consumes stock only when it takes it from a location (`takeReagentStock`); the reagent use report
  reads what that stock cost through `reagentStockCosts` (`InventoryQueries.issuedCost`), and a reagent's yield reads the
  item through `inventoryItem`.
- Instrument interfaces (HL7 v2 / ASTM through `libs/interoperability`): QC values and results would arrive with their
  instrument; the evaluation and the gate are the same.

## Staff app

`/laboratory/qc`: the QC board, "Record a control" (evaluated on save), the Levey-Jennings chart and run history with
corrective actions, and control material / lot / target setup (`lab.qc.manage`). `/laboratory/instruments`: the
register, status, last calibration (overdue flagged) and maintenance, reagent lots in use (load from stock, replace,
unload, history; each lot's use against the tests it holds, "Running low", the runs counted and "Record use…"), the log
and new entries. `/laboratory/reagents`: reagent use over a period — by reagent and per lot (in the period and over its
life, stock cost, cost per patient run, unused when unloaded) — and the tests per unit of each reagent. `/laboratory/temperatures`: storage units with the last reading, due and
excursion flags, record a reading (an excursion asks for a note and links to the nonconformance it opened), the reading
history, unit setup. `/laboratory/nonconformances`: open / closed lists, report one; the detail page shows
links, the investigation, what is still needed to close, reclassify and close. `/laboratory/eqa`: rounds with results
and evaluations (unacceptable ones link to their nonconformance), schemes. `/laboratory/competency`: each
result-entering staff member's areas with their state, and recording an assessment. Dashboard (`/`, with
`lab.qc.read`): a _Laboratory quality_ list of what needs attention, linking to each page — critical when patient results
are refused, a storage unit is out of range or a critical nonconformance is open. The QC board shows the lots in use and "since the reagent lot change". Workbench: result entry
and corrections name the instrument; each result shows its QC state. Laboratory catalog: QC settings in the facility
policy.
