# Laboratory quality management (`libs/laboratory`, Phase 9)

## Purpose

The first part of the laboratory's quality management (`libs/laboratory/CLAUDE.md`, "Quality management"): the
**instrument register** with its maintenance and calibration log, **internal quality control** (control materials,
lots, target mean/SD per test and instrument, QC runs evaluated with Westgard multirules, corrective actions), and the
link from each **patient result** to the instrument it was measured on and the QC in force when it was entered.

It also records **reagent lots** (inventory lots of reagent items) loaded on each instrument; results and QC runs keep
the lots in use when they were entered.

Code: `libs/laboratory/src/lib/quality` (`LabQualityService`, `LabReagentService`, `qc.rules.ts`), migrations
`0050_lab_quality.sql` and `0051_lab_reagent_lots.sql`, staff `/laboratory/qc` and `/laboratory/instruments`.

Not yet: temperature logs, incidents and nonconformance, proficiency testing (EQA), staff competency, and instrument
interfaces (results and QC values arriving from analyzers through `libs/interoperability`). QC is for numeric tests.
Loading a lot does not move inventory stock (issuing reagents to the laboratory stays an inventory movement).

No regulatory rule is encoded. Which rules reject a run, how long a run covers patient results, and whether patient
results need QC are **facility configuration**; confirm them against the laboratory's QC plan and the applicable DOH
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
- **Reagents on results and runs** (`lab_result_reagent`, `lab_qc_run_reagent`, append-only) — the loads in use when the
  result was entered or the QC run recorded.
- **Facility policy** (`lab_facility_policy`, new columns) — `qc_reject_rules` (default `1_3s, 2_2s, R_4s`),
  `qc_valid_hours` (default 24, 1–168), `qc_required` (default false), `qc_after_reagent_change` (default true).

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

**Patient results.** Entering (or correcting) a result with `instrumentId`: the instrument must be active at the order's
facility; the decisive run is linked and its status snapshotted (`none` when no run is in the window). When the facility
sets `qc_required`, no run in the window, or a rejected decisive run, refuses the result (`qc_not_accepted`). The reagent
lots in use are recorded on the result. Results
without an instrument (manual methods) are not gated. The workbench shows the QC state on each result so verifiers see
results entered while QC was rejected.

## Commands

Load a reagent lot on an instrument (replacing the lot of the same reagent in use); unload a lot (reason);
register/update instruments; record log entries (retiring needs `lab.qc.manage`); create materials and lots; retire a
lot; set a target; record a QC run; record a corrective action; change the facility QC policy (with the laboratory
policy, reason required, audited).

## Queries

Instruments at the selected facility (optionally retired) with last calibration/maintenance and overdue flag; an
instrument's log; materials with lots and current targets; the QC board (each test with a current target on each
instrument: latest run per level in the window, decisive run, whether results are allowed); runs of a test on an
instrument (optionally one lot, last N days) for the Levey-Jennings chart, with corrective actions and reagent lots;
reagent lots in use at the facility (optionally one instrument), an instrument's load history, and the reagent lots in
stock at the facility (from inventory) that can be loaded.

## Events

`LaboratoryQcRunRejected` (run id, instrument, test, lot, rules — no values), `LaboratoryInstrumentStatusChanged` (from,
to), `LaboratoryReagentLotLoaded` (load, inventory lot, test, replaced load), `LaboratoryReagentLotUnloaded`. No
subscribers yet (intended: notify the section head; dashboard).

## Permissions

| Permission      | Roles                                        | Allows                                                  |
| --------------- | -------------------------------------------- | ------------------------------------------------------- |
| `lab.qc.read`   | org_admin, medical_technologist, pathologist | QC board, runs, materials, instruments and their logs   |
| `lab.qc.enter`  | org_admin, medical_technologist, pathologist | QC runs, corrective actions, instrument log entries     |
| `lab.qc.manage` | org_admin, pathologist                       | Instruments, control materials, lots, targets; retiring |

The QC policy is part of the laboratory policy (`lab.catalog.manage`). Instrument, run and board endpoints are scoped to
the selected facility.

## API

Under `/api/v1/laboratory` (OpenAPI tag `laboratory quality`): `GET/POST instruments`, `PATCH instruments/:id`,
`GET/POST instruments/:id/log`, `GET/POST qc/materials`, `POST qc/materials/:id/lots`, `POST qc/lots/:id/retire`,
`POST qc/lots/:id/targets`, `GET qc/status`, `GET qc/runs?instrumentId=&testId=&qcLotId=&days=`, `POST qc/runs`,
`POST qc/runs/:id/actions`, `GET reagents?instrumentId=`, `GET reagents/available`, `GET/POST instruments/:id/reagents`,
`POST reagents/:loadId/unload`. `PUT policy` accepts `qcRejectRules`, `qcValidHours`, `qcRequired`,
`qcAfterReagentChange` (left out: unchanged). Results and QC runs carry `reagents`.
`POST order-items/:itemId/results` and `POST results/:id/correct` accept `instrumentId`.

Audit: `lab.instrument.create | update | log`, `lab.qc.material.create`, `lab.qc.lot.create | retire`,
`lab.qc.target.set`, `lab.qc.run.record`, `lab.qc.action.record`, `lab.reagent.load | unload`, `lab.policy.update`.

## Database relationships

Composite same-organization foreign keys throughout (instrument → facility and department; target → lot, test,
instrument; run → facility, instrument, test, lot, target; result → instrument and run). Append-only: instrument log,
runs, actions (`prevent_mutation`); targets immutable except closing (trigger); result QC link immutable.

## Integration points

- Inventory (`libs/inventory`): reagent lots are inventory lots. The laboratory reads them through its
  `LaboratoryContext` port (`inventoryLot`, `reagentLotsInStock`), implemented in the API over `InventoryQueries`; the
  laboratory never imports inventory. The database links loads to `inventory_item` / `inventory_lot` by composite
  foreign keys. Loading does not consume stock.
- Instrument interfaces (HL7 v2 / ASTM through `libs/interoperability`): QC values and results would arrive with their
  instrument; the evaluation and the gate are the same.

## Staff app

`/laboratory/qc`: the QC board, "Record a control" (evaluated on save), the Levey-Jennings chart and run history with
corrective actions, and control material / lot / target setup (`lab.qc.manage`). `/laboratory/instruments`: the
register, status, last calibration (overdue flagged) and maintenance, reagent lots in use (load from stock, replace,
unload, history), the log and new entries. The QC board shows the lots in use and "since the reagent lot change". Workbench: result entry
and corrections name the instrument; each result shows its QC state. Laboratory catalog: QC settings in the facility
policy.
