# 7. Laboratory quality

## What this is for

These pages hold the laboratory's quality records for the selected facility: the instrument register with its maintenance and calibration log,
internal quality control (QC) with Levey-Jennings charts and Westgard rules, the reagent lots loaded on each instrument, temperature logs of
refrigerators and other storage units, nonconformances (incidents) with corrective and preventive action (CAPA), proficiency testing (external
quality assessment, EQA) and staff competency. Patient results record the instrument, the QC in force and the reagent lots in use when they were
entered.

The platform does not prescribe any rule. Which Westgard rules reject a run, how long QC covers patient results, storage ranges, reading intervals,
EQA schemes and competency intervals are your laboratory's own choices. Confirm them against your laboratory's QC plan and the applicable DOH
issuances. QC evaluation is decision support for the laboratory's review.

## Who uses it

| Permission      | Default roles                                         | Allows                                                                                                                                                                                               |
| --------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lab.qc.read`   | Organization admin, medical technologist, pathologist | See all quality pages                                                                                                                                                                                |
| `lab.qc.enter`  | Organization admin, medical technologist, pathologist | Record QC runs and corrective actions, instrument log entries, load and unload reagent lots, record temperatures, report nonconformances and add entries, record EQA rounds, results and evaluations |
| `lab.qc.manage` | Organization admin, pathologist                       | Register instruments, retire an instrument, set up control materials, lots and targets, register and retire storage units, add EQA schemes, reclassify and close nonconformances, assess competency  |

The QC and competency policy is part of the facility's laboratory policy and needs `lab.catalog.manage` (see
[How to set the QC and competency policy](#how-to-set-the-qc-and-competency-policy)).

Find the pages under **Laboratory** in the side navigation: **Quality control** (`/laboratory/qc`), **Instruments** (`/laboratory/instruments`),
**Temperatures** (`/laboratory/temperatures`), **Nonconformances** (`/laboratory/nonconformances`), **Proficiency testing** (`/laboratory/eqa`) and
**Competency** (`/laboratory/competency`). Each page works on the facility selected in the top bar. If you do not have `lab.qc.read`, these pages send
you back to the home page.

## How to see what needs attention

With `lab.qc.read`, the home dashboard (`/`) shows a **Laboratory quality** list, each item linking to its page:

- **Open nonconformances** (critical, major, under investigation)
- **Tests that cannot take patient results now** (QC, instrument status or an expired reagent lot)
- **QC to review** (rejected, or not run in the window)
- **Storage units out of range at the last reading** and **Temperature readings due**
- **Instruments** (calibration overdue, out of service)
- **Proficiency testing** (rounds past due with nothing reported, rounds awaiting the provider's evaluation)
- **Staff competency** (reassessments due, not yet competent, and — when competency is required — people not assessed)

### Quality notices

Quality managers (users with `lab.qc.manage` at the facility) receive in-app messages under the bell in the top bar (`/notifications`):

- When a nonconformance is opened (by a colleague, by a temperature excursion or by an unacceptable EQA result). The person who raised it is not
  notified.
- When a QC run is rejected. The message names the instrument, test and rules — never patient details or control values.
- Once for each missed temperature reading (checked hourly).
- When a competency reassessment is due. The person assessed is told too.

Reminders are in-app only. No SMS or email is sent to staff.

## How to register an instrument

You need `lab.qc.manage`.

1. Open **Instruments** (`/laboratory/instruments`).
2. Under **Register an instrument**, enter **Code** and **Name**, and optionally **Department**, **Manufacturer**, **Model** and **Serial number**.
3. Click **Register**.

The **Instruments** list shows each instrument's status (**In service**, **Out of service**, **Retired**), last **Calibration** (passed or failed,
next due — **Overdue since** when past due), last **Maintenance** and **Reagent lots** in use. Click **Show retired** to include retired instruments.
An instrument that is out of service cannot be used for QC or patient results. An overdue calibration is a reminder only; it does not block use.

## How to record maintenance, calibration or a status change

You need `lab.qc.enter`. Retiring needs `lab.qc.manage`.

1. On the instrument row, click **Log**.
2. In **Record**, choose **Maintenance**, **Calibration**, **Verification**, **Repair**, **Out of service** or **Returned to service** (and
   **Retired** if you may retire).
3. For **Calibration** and **Verification**, choose the **Outcome** (**Passed** or **Failed**).
4. For **Maintenance** and **Calibration**, you can set the **Next due** date.
5. Add **Notes**. Notes are required for **Out of service**, **Repair** and **Retired**.
6. Click **Record**.

The log below the form lists every entry with who recorded it. Entries cannot be edited or deleted. A retired instrument cannot be changed.

## How to load, replace or unload a reagent lot

Reagent lots come from inventory: only active items in the **reagent** category, with a lot that has not expired, can be loaded. See
[Chapter 9](09-pharmacy-and-inventory.md) for receiving stock. You need `lab.qc.enter`.

1. On the instrument row, click **Log**. The **Reagent lots in use** panel opens above the log.
2. In **Load a lot from stock**, choose the reagent lot. The list shows lots in stock at this facility with their expiry and quantity.
3. In **For**, choose **All tests on this instrument** or one test.
4. Optional, if you also have `inventory.move`: in **Take from stock**, choose the storage location and enter the **Quantity**. The stock is issued
   from inventory at the same time. Leave **No (issued separately)** if stock is issued another way.
5. Optional: in **Tests it holds**, enter how many tests the lot can perform. Left empty, a lot taken from stock gets the stock quantity times the
   reagent's **tests per unit** (set on **Reagent use**); the hint under the form says what the load will hold.
6. Click **Load lot**.

Loading a new lot of the same reagent replaces the lot in use (it is unloaded with "Replaced by lot …"). To unload without a replacement, click
**Unload…**, give a reason (for example used up, expired) and click **Unload**. Click **Lot history** to see every load and unload.

An expired lot still loaded shows **Expired — QC and results refused**. QC runs and patient results on that test are refused until you load a new
lot or unload it.

By default, loading a new lot restarts the QC window for the test: QC must be run again before patient results are covered. The QC board then shows
"Since the reagent lot change …". Your facility can turn this off in the policy.

## How to follow reagent use per test run

Every lot in use shows how many tests it has used and how many are left, for example "42 of 100 tests used · 58 left", and **Running low** when a
tenth or less is left. Under it: patient, QC, other and wasted runs.

- A **patient run** is counted when a result is entered with the instrument: the tests of one order entered together count once; a correction
  entered on the instrument counts as a re-run.
- A **QC run** is counted when a control is recorded.
- Click **Record use…** for anything else: choose **Repeat** (a re-run not entered as a result), **Calibration**, **Priming**, **Waste** or
  **Other**, enter the number of tests and what for, and click **Record**. You need `lab.qc.enter`; an unloaded lot cannot take more use.
- Click **Runs** to see every run counted against the lot, with who and when.

Counting never moves stock (stock leaves inventory when the lot is loaded) and never blocks a result: use beyond the tests the lot was said to hold
shows as "beyond the stated capacity".

**Reagent use** (menu **Laboratory → Reagent use**, `lab.qc.read`) shows a period (default the last 30 days): patient runs, QC and other use and
their share, lots running low, use per reagent, and per lot the runs in the period and over its life, what its stock cost, the **cost per patient
run** once the lot is unloaded (everything the lot cost spread over its patient runs) and what was left unused. With `lab.qc.manage`, set each
reagent's **tests per unit** in **Tests per unit** (it applies to lots loaded from then on). These are operational figures, not an accounting
valuation.

## How to set up control materials, lots and targets

You need `lab.qc.manage`. On **Quality control** (`/laboratory/qc`), use the **Control materials, lots and targets** card.

1. **New control material:** enter a **Code**, **Name**, **Level** (as the manufacturer names it, for example Level 1) and **Manufacturer**, then
   click **Add material**.
2. **New lot:** choose the material, enter the **Lot number** and **Expiry date**, then click **Add lot**.
3. **Target mean and SD:** choose the **Lot**, **Test** and **Instrument**, enter **Mean**, **SD** and optionally the **Source** (for example "own
   data, 20 runs"), then click **Set target**.

QC applies to numeric tests only. A new target for the same lot, test and instrument replaces the current one from now on; earlier runs keep the
target they were read against. Click **Retire lot** to stop using a lot. Retired lots take no new targets or runs; expired lots take no runs.

## How to record a QC run

You need `lab.qc.enter`.

1. On **Quality control**, use **Record a control** on the right.
2. Choose the **Instrument** (active instruments only), the **Test** (only tests with a target on that instrument) and the **Control lot**. The
   target mean and SD are shown.
3. Enter the **Value** and an optional **Comment**.
4. Click **Record control**.

The run is evaluated when you save it. You see **QC accepted**, **QC warning** or **QC rejected**, with the value in SD from the target and the
rules that fired. A rejected run says "Do not report patient results on this test until QC is resolved." Rejected runs notify the quality managers.

### How runs are evaluated

Each control value is compared with its target as a number of SDs, together with up to nine earlier controls of the same test on the same
instrument, across control levels.

| Rule | Fires when                                                                         |
| ---- | ---------------------------------------------------------------------------------- |
| 1-2s | one control beyond ±2 SD — always a warning, never a rejection                     |
| 1-3s | one control beyond ±3 SD                                                           |
| 2-2s | two consecutive controls beyond 2 SD on the same side                              |
| R-4s | two consecutive controls of different lots more than 4 SD apart, on opposite sides |
| 4-1s | four consecutive controls beyond 1 SD on the same side                             |
| 10-x | ten consecutive controls on the same side of the mean                              |

A run is **rejected** when a rule your facility chose fires. It is a **warning** when only other rules fire. Otherwise it is **accepted**. The
default rejecting rules are 1-3s, 2-2s and R-4s.

## How to read the QC board and the Levey-Jennings chart

The **QC status** card lists each test with a target on each instrument:

- **Control levels** — the latest run of each level within the QC window (for example 24 hours), with its status and the rules that fired.
- **Patient results** — **Allowed** or **Blocked**. Blocked means the instrument is not in service, a reagent lot in use has expired, or — when your
  facility requires QC — no run is in the window or a control level is rejected. A newer accepted level does not hide a rejected one.
- The reagent lots in use are listed under the test name; expired ones are marked **(expired)**.

Click **Chart** on a row to see the **Levey-Jennings** chart and the run history for the last 31 days. Each run shows the value, SD from the
target, evaluation, comment, reagent lots and corrective actions.

### Record a corrective action

For a run with a warning or rejection, click **Corrective action**, describe the cause found and what was done, and click **Save**. You need
`lab.qc.enter`. Corrective actions cannot be recorded on accepted runs and cannot be edited later.

### QC on patient results

When a result is entered on an instrument (see [Chapter 6](06-laboratory.md#how-to-enter-results)), the result keeps the QC state at that moment and
the reagent lots in use. Verifiers see **QC accepted**, **QC warning**, **QC rejected** or **No QC** on each result. Results entered as **Manual /
not on a registered instrument** are not checked against QC.

## How to set the QC and competency policy

You need `lab.catalog.manage`. Open **Laboratory → Catalog** and scroll to **Laboratory policy · _facility_**. Under **Quality control**:

- Tick the rules that reject a QC run: **1-3s**, **2-2s**, **R-4s**, **4-1s**, **10-x**. (1-2s is always a warning.)
- **A QC run covers patient results for _n_ hours** (1 to 168).
- **Refuse results on an instrument without QC in that window, or while a control level is rejected** (off by default).
- **Start the QC window again when a new reagent lot is loaded for a test** (on by default).
- **Refuse results from staff without a current competent assessment for the test or its section** (off by default).

Enter a **Reason for the change** and click **Save policy**. The change is audited.

## How to monitor temperatures

Open **Temperatures** (`/laboratory/temperatures`).

### Register a storage unit

You need `lab.qc.manage`.

1. Under **Register a storage unit**, enter **Code**, **Name** and the kind (**Refrigerator**, **Freezer**, **Incubator**, **Water bath**,
   **Room**, **Other**).
2. Enter **Lowest acceptable (°C)** and **Highest acceptable (°C)**, from the manufacturer's requirements and your procedures.
3. Optional: **Reading every (hours, optional)** (1 to 168). Without it the unit is never flagged as due.
4. Click **Register**.

To retire a unit, click **Readings**, then **Retire unit…**, give the reason and click **Retire**.

### Record a reading

You need `lab.qc.enter`.

1. In the unit's row, type the temperature in °C.
2. If the value is outside the range (the limits themselves are acceptable), a box asks what was seen and done. It is required.
3. Click **Record**.

A reading outside the range is recorded as an excursion and opens a nonconformance (category Temperature excursion, severity Major) automatically.
You see "Excursion recorded — nonconformance opened".

The list shows each unit's range, **Last reading** (in red when out of range), **Reading due** when the interval has passed, and **Excursions (7
days)**. Click **Readings** to see the last 31 days. Readings cannot be edited or deleted.

## How to report and investigate a nonconformance

Open **Nonconformances** (`/laboratory/nonconformances`). Switch between **Open**, **Closed** and **All** at the top. Each record has a number like
`NC00000012`, a **Severity** (**Minor**, **Major**, **Critical**) and a status (**Open**, **Investigating**, **Closed**). Records opened by the
platform show "Platform" as reporter.

### Report one

You need `lab.qc.enter`.

1. Under **Report a nonconformance**, choose the **Category** (Pre-analytical, Analytical, Post-analytical, Equipment, Temperature excursion, QC
   failure, EQA failure, Safety, Complaint, Other) and **Severity**.
2. Enter a **Title** and **What happened**.
3. Optional: link an **Instrument** and a **Specimen accession**.
4. Click **Report**. The record opens.

### Investigate

On the record, under **Add to the trail** (needs `lab.qc.enter`), choose the kind of entry and write it, then click **Add**:

- **Note**
- **Correction (immediate action)**
- **Root cause**
- **Corrective action**
- **Preventive action**
- **Effectiveness check**

The first entry that is not a note moves the record to **Investigating**. Entries are kept as recorded and cannot be edited.

### Reclassify or close

You need `lab.qc.manage`. Use the **Review** card.

- **Reclassify:** choose a new **Severity**, give the reason, and click **Reclassify**. (The category can be changed only through the API.)
- **Close:** the record needs at least a **Root cause**, a **Corrective action** and an **Effectiveness check**. Until then the card says "Record the
  … first." Write an **Outcome summary** and click **Close**.

A closed nonconformance never changes.

## How to record proficiency testing (EQA)

Open **Proficiency testing** (`/laboratory/eqa`). Results and evaluations are entered by hand, as the provider sent them. There is no electronic
exchange with EQA providers.

1. **Add a scheme** (needs `lab.qc.manage`): under **Schemes**, enter a **Code**, the **Provider** (as it names itself) and the programme name, then
   click **Add scheme**.
2. **Record a round received** (needs `lab.qc.enter`): choose the scheme, enter the **Round**, **Received** date and optionally **Due**, then click
   **Record round**.
3. **Add results:** on the round, enter the **Sample** code, choose the **Test**, enter the **Value reported**, and click **Add result**.
4. **Record the provider's evaluation:** on each result click **Record evaluation…**, choose **Acceptable**, **Unacceptable** or **Not graded**,
   optionally add **Target**, **Score** and **Note**, and click **Save evaluation**. The evaluation is recorded once.

An **Unacceptable** result opens a nonconformance (category EQA failure, severity Major) automatically. The round links to it.

## How to record staff competency

Open **Competency** (`/laboratory/competency`). The page lists each staff member who enters results at the facility, with each area (a test or a
whole section) and its state: **Competent**, **Reassessment due** (past the next due date) or **Not yet competent**. For a test, the person's own
assessment for that test counts first; otherwise their assessment for the section.

To record an assessment (needs `lab.qc.manage`):

1. Under **Record an assessment**, choose the **Staff member** and the area (a test, or a whole section).
2. Choose the method (**Direct observation**, **Blind sample**, **Record review**, **Written assessment**, **Other**) and the outcome
   (**Competent** or **Not yet competent**).
3. Enter **Assessed on** and optionally **Next due (optional)**.
4. Add notes. Notes are required for **Not yet competent** ("What needs work").
5. Click **Record assessment**.

You cannot assess yourself. Assessments are kept as history; the latest counts.

When the policy requires competency, a person without a current competent assessment for a test (or its section) cannot enter or correct its
results.

## Rules the system enforces

- An instrument that is out of service or retired cannot be used for QC or patient results. Retiring needs `lab.qc.manage`.
- Calibration and verification entries need an outcome. Out of service, repair and retirement need notes.
- QC runs need a target for that lot, test and instrument. Retired or expired control lots take no runs.
- Only reagent-category inventory lots that have not expired can be loaded. An expired lot in use refuses QC runs and results on that test.
- Reagent use is counted automatically for patient results entered with the instrument and for QC runs; other use needs a reason and is kept
  as history (it cannot be changed or deleted).
- When the facility requires QC, a result on an instrument is refused if no QC run is in the window or a control level is rejected.
- When the facility requires competency, a result is refused from staff whose assessment is missing, due, or not yet competent.
- A temperature outside the range needs a note and opens a nonconformance.
- A nonconformance cannot close without a root cause, a corrective action and an effectiveness check. A closed record never changes.
- An EQA evaluation is recorded once. An unacceptable result opens a nonconformance.
- No one assesses their own competency, and the assessment date cannot be in the future.
- Instrument logs, QC runs, corrective actions, temperature readings, nonconformance entries and competency assessments are append-only.

## Troubleshooting / common messages

| Message                                                                                              | Meaning                                                                        | What to do                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| No QC has been run for this test on this instrument within the facility's QC window. Run QC before … | QC is required and no run covers the result (or a new reagent lot was loaded). | Record a control on **Quality control**, then enter the result.             |
| The latest QC run of a control level for this test on this instrument was rejected. Run QC before …  | A level is rejected.                                                           | Investigate, record a corrective action, and run QC again.                  |
| Reagent _item_ lot _n_ loaded on this instrument has expired. Load a new lot first.                  | An expired reagent lot is in use.                                              | Load a new lot or unload the expired one on **Instruments**.                |
| You cannot enter _test_ results at this facility: _reason_. Ask your section head.                   | Competency is required and yours is missing, due or not yet competent.         | Ask a quality manager to record your assessment.                            |
| The instrument is out of service                                                                     | QC or results on an instrument not in service.                                 | Record **Returned to service** when it is fixed, or use another instrument. |
| Set a target mean and SD for this lot, test and instrument first                                     | No target exists.                                                              | Ask a quality manager to set the target.                                    |
| The QC lot has expired / The QC lot is retired                                                       | The control lot cannot be used.                                                | Use another lot.                                                            |
| QC targets are for numeric tests                                                                     | QC is only for numeric tests.                                                  | —                                                                           |
| Corrective actions are recorded for warning or rejected runs                                         | The run was accepted.                                                          | —                                                                           |
| Record whether the calibration or verification passed                                                | The outcome is missing.                                                        | Choose **Passed** or **Failed**.                                            |
| Say why (notes are required)                                                                         | Notes are required for this log entry.                                         | Add notes.                                                                  |
| Retiring an instrument requires lab.qc.manage                                                        | You lack the permission.                                                       | Ask a quality manager.                                                      |
| This lot is already loaded                                                                           | The lot is already in use on this instrument.                                  | —                                                                           |
| Taking stock needs the inventory.move permission                                                     | You chose **Take from stock** without inventory permission.                    | Choose **No (issued separately)** or ask for the permission.                |
| _n_ °C is outside _min_ to _max_ °C. Say what was seen and done (note).                              | An excursion needs a note.                                                     | Describe what you saw and did.                                              |
| The upper limit must be above the lower limit                                                        | The storage unit range is wrong.                                               | Correct the range.                                                          |
| The unit is retired                                                                                  | Readings cannot be recorded on a retired unit.                                 | —                                                                           |
| Specimen with this accession number at this facility not found                                       | The accession in the nonconformance form does not match.                       | Check the number and the selected facility.                                 |
| Record the root cause, corrective action, effectiveness check before closing                         | The trail is incomplete.                                                       | Add the missing entries.                                                    |
| Closing a nonconformance requires lab.qc.manage                                                      | You lack the permission.                                                       | Ask a quality manager.                                                      |
| The nonconformance is closed                                                                         | Closed records do not change.                                                  | Report a new nonconformance if needed.                                      |
| The evaluation is already recorded                                                                   | EQA evaluations are recorded once.                                             | —                                                                           |
| The due date is before the date received                                                             | Round dates are wrong.                                                         | Correct the dates.                                                          |
| Staff do not assess their own competency                                                             | You chose yourself.                                                            | Another assessor must record it.                                            |
| Competency is recorded for staff who enter results at this facility                                  | The person does not enter results here.                                        | Check the person's role at this facility.                                   |
| The assessment date cannot be in the future                                                          | Wrong date.                                                                    | Correct the date.                                                           |

## Related chapters

- [1. Getting started](01-getting-started.md) — facility selection, notifications bell, dashboard
- [6. Laboratory](06-laboratory.md) — workbench, result entry and the laboratory policy
- [9. Pharmacy and inventory](09-pharmacy-and-inventory.md) — receiving and issuing reagent stock
- [13. Administration](13-administration.md) — roles and permissions
- [14. Glossary and FAQ](14-glossary-and-faq.md)
