# Heuristic assistant

## Purpose

Decision support that notices what a screen does not, using fixed rules and simple statistics over data the caller may already read. It suggests and
links; it never changes a record, never diagnoses and uses no language model. Design and phases: `docs/architecture/heuristic-assistant.md`; decision:
ADR-0018. Built: phase 0 (the kernel, settings and feedback, the API, the first stock rule, the settings screen), phase 1 (operational rules on the
inventory, billing, appointments and queue screens, and the replay behind **Try these values**) and phase 2: the doctor's workspace (the consultation
checklist, code suggestions and the laboratory delta check), integrity and security (unusual record access, compliance areas to review, invoices that
may have been issued twice), order sets and outreach (an order set offered in a consultation; when patients use MyHealth, audiences worth a segment
and patients receiving many campaigns on the outreach screen), and the staff command bar (Ctrl+K); and the first slice of phase 3, prescribing checks
(the same medicine or class already prescribed, a daily dose above the organization's maximum, and checks it asks for), run in the prescribing dialog
before a prescription is issued, laboratory timing and quality (orders past their usual turnaround on the workbench; QC values drifting or shifted and
specimen rejections concentrated on a collector or a facility on the QC page), and dental and care plans (on a patient's dental record, treatment plan
items the chart says cannot be carried out and items waiting for the patient's decision; in a consultation, the tests one of the organization's order
sets lists for a chronic diagnosis that have no released result for months), and the pharmacy and online consultations (on the pharmacy's home,
medicines that waiting prescriptions need more of than the facility holds; on the dispense screen, stock that would expire before the course ends; in
an online consultation, reasons to consider seeing the patient in person). Phase 4, governance, is built too: how often each rule was shown and
followed, the reasons staff give for "Not useful", an insights page per rule, and the organization's reviews of its rules (keep, adjust or retire,
with the false positives found), with a quarterly review runbook (`docs/runbooks/assistant-rule-review.md`). Phase 3's MyHealth item, result wording,
is not a rule: MyHealth's result page explains each result in fixed, versioned sentences (`resultExplanation`), and the organization records its
review of them as a compliance area ("Results shown to patients", migration `0158`); see Integration points and limits.

## Entities

Migration `0152_assistant.sql`; Drizzle mirrors in `apps/api/src/app/assistant/assistant.schema.ts` (API-owned, ADR-0011).

- `assistant_rule_setting` — append-only versions per organization (or one facility) and rule: `enabled`, `parameters`
  (JSON checked by the rule's schema). The latest version of the facility's row, else the organization's, is in force.
  A rule with no row is **off**.
- `assistant_feedback` — append-only: who answered which finding (`rule_id`, `rule_version`, `subject_key` from the
  suggestion id) with `accepted | dismissed | not_useful` and an optional reason. No names, values or record text.
- `assistant_rule_shown` (migration `0159`) — times each rule's suggestions were shown, per facility and local day: a counter updated in place by
  every suggestions request (counts only; never a finding, subject or person).
- `assistant_rule_review` (migration `0159`) — append-only: the organization's review of a rule — its version, `keep | adjust | retire`, what was
  decided and why (`note`), the false positives found, the review date and who recorded it.
- Suggestions are computed on demand and not stored. Migrations `0153`, `0154` and `0157` change no table (permissions only). Migration `0155` adds
  the laboratory's order sets (`docs/domains/laboratory.md`, "Order sets") and `0156` the prescription domain's medicine settings
  (`docs/domains/prescription.md`, "Medicine settings"), not assistant tables.

## Rules

A rule is a `RuleDefinition` (`libs/core` `assistant/suggestion.ts`: id, version, domain, the screens it speaks on, the
permissions it needs, a parameter schema, starting values and `parameterLabels`) plus a pure function in its domain
library, a read query in that library, and a binding in `apps/api/src/app/assistant/assistant-rules.ts`. Raise `version`
when its logic or the meaning of a parameter changes; dismissals are per version. Every starting value is a starting
point the organization changes, never a standard.

| Rule                                 | Screen        | Library (query)                                                                                                                   | Says                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Needs                                                   |
| ------------------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `inventory.days-of-cover`            | Inventory     | `inventory` (`InventoryAssistantQueries`)                                                                                         | Usable stock plus open orders lasts less than the delivery time at the recent pace; a quantity to cover the chosen days.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `inventory.read`                                        |
| `inventory.usage-spike`              | Inventory     | `inventory`                                                                                                                       | An item issued far above its usual week: above the mean of earlier weeks plus `spread` swings (standard deviation, never below a tenth of the mean). Points to the movements: demand, a mistaken entry or loss.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `inventory.read`                                        |
| `inventory.expiry-exposure`          | Inventory     | `inventory`                                                                                                                       | A lot expected to expire unused: lots are used up in expiry order (FEFO) at the recent pace; what a lot still holds at its expiry. An item not issued in the window is expected to use nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `inventory.read`                                        |
| `billing.uncharged-work`             | Billing       | `billing` (`BillingAssistantQueries`) + clinic/dental                                                                             | Clinic and dental procedures with no charge some hours later, grouped by code and the likely reason: no billing service for the code (advice: may be deliberate), no price on that day, or not captured (warnings). Counts.                                                                                                                                                                                                                                                                                                                                                                                                                                     | `billing.charge.read`                                   |
| `clinic.no-show-risk`                | Appointments  | `clinic` (`ClinicAssistantQueries`)                                                                                               | An appointment of the day whose patient missed a large share of their past appointments here (records merged into theirs counted). Named by time, never by patient; information only once confirmed.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `appointment.read`                                      |
| `clinic.queue-wait`                  | Queue         | `clinic`                                                                                                                          | Patients waiting to be called longer than a percentile of this facility's past waits for the visit type (check-in to call, visits never sent back in line). Counts; never reorders the queue; no link.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `clinic.queue.read`                                     |
| `clinic.encounter-checklist`         | Consultation  | `clinic` (`EncounterAssistantQueries`)                                                                                            | Before a consultation in progress is signed: what the record does not hold yet (chief complaint, vital signs in person within N hours, allergy review, assessment, plan, a diagnosis, its code when a coding system is active, a primary one). One suggestion listing them; blocks nothing; checks for vital signs and codes are 1/0 parameters.                                                                                                                                                                                                                                                                                                                | `encounter.read`                                        |
| `clinic.code-suggestions`            | Consultation  | `clinic`                                                                                                                          | For each uncoded diagnosis (or the assessment when there is no diagnosis yet): up to three codes the organization itself used whose descriptions share at least N% of their words with the text (`libs/core` `assistant/text-match.ts`), with the matching words and how often each was used. A code counts only after `minUses` (≥ 2) uses, so a one-off description never shows. Never applied.                                                                                                                                                                                                                                                               | `encounter.read`                                        |
| `laboratory.delta-check`             | Laboratory    | `laboratory` (`LabAssistantQueries`)                                                                                              | A numeric result entered but not yet released that differs from the same patient's last released result of the same test (same unit, within N days) by at least N%. Names the order, never the patient; links to the next stage's worklist; changes nothing.                                                                                                                                                                                                                                                                                                                                                                                                    | `lab.result.read`                                       |
| `security.unusual-access`            | Audit log     | `audit` (`AuditAssistantQueries`)                                                                                                 | Staff accounts whose record access in the last N hours stands out in the audit trail: distinct patients opened at least N times the account's usual working day (median of the 28 days before, days with at least one; never below a minimum), patients opened outside the organization's working hours (facility time zone), or refused requests. Names the account (names from `UsersService`), links to its audit trail; counts only; blocks nothing. Reads the whole organization's trail.                                                                                                                                                                  | `audit.read`                                            |
| `admin.compliance-gaps`              | Settings home | `organization` (`OrganizationAssistantQueries`)                                                                                   | Compliance areas (`compliance_review`) never reviewed, last reviewed over N months ago, or last found "changes needed" (warning), in one suggestion whose id follows the gaps (a dismissal lasts until they change). Says nothing about whether the configuration is right.                                                                                                                                                                                                                                                                                                                                                                                     | `compliance.review.manage`                              |
| `billing.possible-duplicate-invoice` | Billing       | `billing` (`BillingAssistantQueries`)                                                                                             | Two invoices at the facility issued within N hours, not void, for the same patient (merged records included) with the same net total and the same services. Names the invoice numbers, never the patient; times in the facility's zone; links to the later one; changes nothing.                                                                                                                                                                                                                                                                                                                                                                                | `billing.charge.read`                                   |
| `laboratory.order-sets`              | Consultation  | `laboratory` (`LabOrderSetService`, `LabAssistantQueries`) + clinic                                                               | An active order set of the organization whose triggers match the consultation in progress: a diagnosis code starting with one of its prefixes (in its coding system, or any) or the visit's visit type (from `EncounterAssistantQueries.orderSetContext`), while some of its tests are not ordered in the consultation yet. Lists its tests and panels as "to order" or "already ordered"; links to the lab order form with the set pre-selected (`?orderSet=`); the doctor checks and places the order. At most N sets.                                                                                                                                        | `encounter.read`, `lab.order.create`                    |
| `crm.send-hour`                      | Outreach      | `audit` (`AuditAssistantQueries.portalVisitsByHour`) + `crm`                                                                      | The hours patients use MyHealth most (Asia/Manila): per hour, accounts that did anything in MyHealth that hour of a day, over N days; the N-hour window with the most visits that does not start in quiet hours. Silent below a minimum of visits, or when recent campaigns already start at about that time (80% of the best); advice when they start at a quieter time; weak when use is spread over the day. Counts only.                                                                                                                                                                                                                                    | `crm.campaign.manage`                                   |
| `crm.audience-ideas`                 | Outreach      | `crm` (`CrmAssistantQueries`) + clinic (`returnFigures`)                                                                          | A segment the organization does not have yet, counted through the same matching as a segment preview: patients not seen for longer than the time within which N% of its returning patients came back (gaps between one patient's completed consultations over two years, linked records as one; none without enough returns; skipped when a segment already selects by the last visit), and next month's birthdays in the month's last N days (skipped when a segment has that month). Links to the segment form filled in. Non-clinical criteria only.                                                                                                         | `crm.segment.manage`                                    |
| `crm.frequency-load`                 | Outreach      | `crm`                                                                                                                             | At least N patients received N or more outreach campaigns (queued or delivered) in N days, and the frequency cap does not already prevent that many. Links to the outreach limits; holds nothing back.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `crm.campaign.approve`                                  |
| `prescription.duplicate-therapy`     | Prescribing   | `prescription` (`PrescriptionAssistantQueries`)                                                                                   | A medicine of the draft already in a current prescription of the patient (records linked to theirs included; current = active and within its duration times one plus its refills, or N days without a duration), of the same class as a current one (the organization's classes in its medicine settings), written twice in the draft, or the same medicine prescribed in the last N days though its course ended (advice). Medicines compared by the words of their names (`medicineWords`, `sameMedicine`). The prescription being replaced is left out.                                                                                                      | `prescription.read`, `prescription.issue`               |
| `prescription.dose-limit`            | Prescribing   | `prescription`                                                                                                                    | A daily dose above the organization's maximum for the medicine in the same unit: the dose (tablets or capsules times the strength, a volume of a concentration such as 5 mL of 250 mg/5 mL, or a unit of measure) times the doses a day of the frequency; medicines taken as needed only when the organization chose a count; custom frequencies, other units and doses by weight are not checked.                                                                                                                                                                                                                                                              | `prescription.read`, `prescription.issue`               |
| `prescription.check-prompts`         | Prescribing   | `prescription`                                                                                                                    | A medicine the organization marked for a kidney-function or pregnancy check, with its own note; the pregnancy check for female patients within the ages set and for patients whose sex is not recorded as male. A prompt only: nothing reads results or decides that the check was done.                                                                                                                                                                                                                                                                                                                                                                        | `prescription.read`, `prescription.issue`               |
| `laboratory.turnaround-risk`         | Laboratory    | `laboratory` (`LabAssistantQueries.turnaroundInputs`)                                                                             | Order items collected but not released (nor cancelled or rejected) whose time since collection is past the facility's usual collection-to-release time for the test (the median of its first releases in N days, STAT orders apart when they have enough releases, plus N%), or the catalog's turnaround target when there are fewer than N releases. One suggestion per test (warning when an order is STAT or twice past its time), each order with the stage it waits at; links to the worklist stage most of them wait at. Changes nothing.                                                                                                                 | `lab.order.read`                                        |
| `laboratory.qc-trend`                | QC page       | `laboratory` (`LabAssistantQueries.qcSeries`)                                                                                     | Per instrument, test and control lot: the last N runs each higher or each lower than the one before (a drift), or the average z-score of the last N runs at least N% of an SD from the target mean (a shift); a warning when both. Something the Westgard rules may not flag yet; links to the series' Levey-Jennings chart (`/laboratory/qc?instrument=&test=`); it rejects no run and changes no QC state.                                                                                                                                                                                                                                                    | `lab.qc.read`                                           |
| `laboratory.rejection-rate`          | QC page       | `laboratory` (`LabAssistantQueries.rejectionFigures`) + names from `UsersService`                                                 | Staff accounts whose share of rejected specimens collected at the facility in N days is at least N times the others' there (with at least N specimens and N rejections), and the facility against the organization's other facilities. Counts only, never a patient or a rejection's free-text reason; links to nonconformances. Quality managers only.                                                                                                                                                                                                                                                                                                         | `lab.qc.manage`                                         |
| `laboratory.monitoring-gap`          | Consultation  | `laboratory` (`LabAssistantQueries.lastReleases`, `LabOrderSetService`) + clinic (`EncounterAssistantQueries.chronicProblems`)    | In a consultation in progress: an active order set whose diagnosis trigger matches a chronic diagnosis of the patient (active, coded and marked chronic in any of their consultations, records linked to theirs included: the long-term part of the problem list) first recorded at least N days ago, while some of the set's tests have no released result for the patient in N months and are not ordered in the consultation. One suggestion per set, each test with its last release (or none); links to the lab order form with the set chosen (`?orderSet=`). The order sets are the configuration: no monitoring interval or guideline is shipped.       | `encounter.read`, `lab.result.read`, `lab.order.create` |
| `dental.chart-consistency`           | Dental record | `dental` (`DentalAssistantQueries.planInputs`)                                                                                    | An item of an open treatment plan still to do (proposed or accepted) whose procedure works on the tooth itself while the chart's latest state of the tooth rules it out: missing or replaced by a pontic (a restoration, sealant, root canal, crown or extraction), an implant (a restoration, sealant or root canal), impacted or not erupted (all but an extraction). A warning per item, with since when the chart shows it, the tooth in the facility's notation. No parameters; changes neither the chart nor the plan.                                                                                                                                    | `dental.record.read`                                    |
| `dental.plan-decisions`              | Dental record | `dental`                                                                                                                          | An open plan with items still proposed, neither accepted nor declined, N days after they were added: one suggestion per plan listing them with the day each was proposed. A reminder to ask the patient and record the decision; nothing is decided.                                                                                                                                                                                                                                                                                                                                                                                                            | `dental.record.read`                                    |
| `dispensing.short-stock`             | Pharmacy      | `prescription` (`PrescriptionAssistantQueries.pendingItems`) + inventory (`InventoryAssistantQueries.stockedItems`, `usableLots`) | On the pharmacy's home: active prescriptions issued at the facility in N days with one fill not fully dispensed (refills not counted), grouped by medicine (the words of its name, its strength and the prescribed unit), whose usable stock here — items the facility stocks named like the medicine (`stockMatches`: the same words apart from salts, the same salt when both name one, the same strength when both state one) in the prescribed unit — is less than what is left. A warning when nothing is usable. Lists the stock per place and the prescription numbers; links to the stock. Medicines not stocked here, or in another unit, are skipped. | `prescription.dispense`, `inventory.read`               |
| `dispensing.course-expiry`           | Pharmacy      | `prescription` (`dispensingItems`, `dispensesBetween`) + inventory (`usableLots`, `lotsTaken`)                                    | On the dispense screen of an active prescription: for each item with a duration and something left to dispense, the stock here named like it (any unit) whose lot taken first (the earliest expiry, as dispensing takes it) expires before the course would end if handed over today (one fill's duration; N days of margin). Advice when another place's first lot lasts the course, a warning when none does; each place with its first lot. Never chooses a lot.                                                                                                                                                                                             | `prescription.dispense`, `inventory.read`               |
| `telemedicine.in-person-care`        | Consultation  | `telemedicine` (`TelemedicineAssistantQueries.preConsultAnswers`) + clinic (`EncounterAssistantQueries.careContinuity`)           | In an online consultation in progress: red flags the patient ticked in the pre-consult questionnaire (a warning; the questionnaire's fixed list), symptoms the patient said have lasted N days or more, N online consultations of the patient in N days (this one included), or no in-person consultation here for N months (or ever). One suggestion with the reasons, the last in-person consultation and vital signs; the doctor decides and escalates from the online consultation panel. Checks with 0 are off.                                                                                                                                            | `encounter.read`, `telemedicine.read`                   |

Composition: billing never reads clinical tables (`libs/billing/CLAUDE.md`), so the API takes the procedures from
`ClinicAssistantQueries.proceduresPerformed` and `DentalAssistantQueries.proceduresPerformed` and asks billing only for
the charge, service and price state of those ids and codes. Clinic and dental never learn about charges.

What the rules read, never: no diagnosis, result, age, sex, address or free text. No-show risk reads attendance only. The order-set rule reads the
consultation's diagnosis codes and visit type, never its notes; the outreach rules read counts (MyHealth visits per hour, patients a criterion
matches, campaigns per patient), never a patient. The prescribing rules read the draft's names, strengths, doses and frequencies, the patient's
earlier prescriptions (names, durations, refills, status) and, for the pregnancy check, the patient's sex and age; never notes, instructions or the
allergy override. The laboratory timing and quality rules read collection, result and release times, QC z-scores and specimen counts per collector;
never a patient, a result value or the free-text reason a specimen was rejected. The dental rules read each charted tooth's conditions and since when,
and the open plans' titles, procedure names, teeth, statuses and dates; never notes, images or fees. The monitoring gap reads the patient's chronic
diagnosis codes and when each was first recorded, the release times of the set's tests and the consultation's orders; never a result value or a note.
The pharmacy rules read prescribed names, strengths, quantities, units, durations, dispenses and prescription numbers, and stock names, units, lots,
expiry dates and quantities; never a patient, an instruction or a cost. The online-consultation rule reads the red flags ticked and the number of days
the symptoms lasted (never the patient's words), the consultations' modality and start times and when vital signs were last measured.

## Moments and replay

Every binding runs at a **moment** (`RuleMoment`: as-of instant, the facility's local day and its bounds, time zone, live
or not), so a rule can read now or a past day. Each query rebuilds its state from timestamps: stock is the ledger summed
up to the moment (the ledger is append-only and every balance is its sum), appointments from booked, confirmed, cancelled,
checked-in and no-show times, the queue from check-in, call, triage and consultation times, procedures from performed,
recorded and entered-in-error times, charges from their capture time. Open purchase orders are counted only live (past
order states are not kept), so a replayed stock rule may fire more often than it would have.

`POST /assistant/rules/:ruleId/replay` (`assistant.configure`, and the rule's own permissions) runs a rule on each of the last 1–31 days (default 14)
at the facility (body or header), each read at the rule's usual local time (`replayAt`: stock 08:00, appointments 07:00, compliance and waiting
prescriptions 09:00, queue and outreach 10:00, laboratory 15:00, consultations, order sets, monitoring, dental and online consultations 16:00, billing
and course expiry 17:00, record access 21:00, prescribing 23:59; laboratory turnaround 15:00, QC trends 10:00, rejection rates 17:00), with given
parameters or the setting in force, else the starting values. Consultation rules read the consultation on screen (`encounterId`); a replay reads every
consultation of the facility started that day and still open at the replay time, and a live request without a consultation reads none. Consultations
rebuild from their start, signing, note revisions, vital signs (and their entered-in-error time), diagnoses and allergy reviews; a diagnosis's later
status changes are not dated, so its current status stands. Laboratory results rebuild from entry, verification, approval, release, cancellation and
supersession. Outreach rules read MyHealth visits, campaign start times, deliveries and the segments active at the moment (an archived segment never
changes again, so its last update dates the archiving); the frequency cap, quiet hours, the order sets and the patients a criterion matches are read
as they are now. A prescribing replay checks each prescription issued at the facility that day as it was written, against the prescriptions on record
when it was issued (rebuilt from their issue and closing times); the medicine settings and the patient's age and sex are read as they are now.
Laboratory items are open at a moment when collected by then and not released, cancelled or rejected by then (each stage from its own time); QC runs
and rejections count when recorded by then. Dental rules read the patient on screen (`patientId`); a replay reads the patients with an open plan at
the facility (its plans only, at most 200 patients), and a live request without a patient reads none. The chart rebuilds from each tooth's states
recorded by the moment (an examination or procedure entered in error by then left out); plans and items count from when they were added, their
statuses as they are now (they keep no history, so a plan decided since is not counted as waiting on an earlier day). The monitoring gap reads the
chronic diagnoses recorded by the moment (their current status and chronic mark), the releases by then and the order sets as they are now. The
pharmacy rules rebuild prescriptions from their issue and closing times, dispenses from their dispense and reversal times and stock from the ledger;
the waiting-prescriptions rule reads only the pharmacy's home (no prescription), and a replay of the course check reads each dispense of the day
against the lots it took (the dispense screen's own check reads the stock before anything is handed over). The online-consultation rule reads the
questionnaire as submitted by the moment, the consultations' modality and start times (an encounter opened in error as it is now) and vital signs not
entered in error by then. It answers counts per day (suggestions, weak ones), the average and the maximum; nothing is stored; audited
`assistant.replay` with rule, facility and days. This is the plan's "backtest": thresholds are chosen from the organization's own data before a rule
is turned on.

## Commands

- Answer a suggestion (`accepted | dismissed | not_useful`): inserts feedback, audits `assistant.answer`, records
  `AssistantSuggestionActedOn` (ids only). A dismissal hides the same finding from the same person for 14 days.
- Change a rule's setting: inserts the next version after checking the editor's `expectedVersion` (409 when stale),
  validates parameters against the rule's schema (422 `invalid_rule_parameters`, the message naming the field in the
  settings screen's words), audits `assistant.rule-setting`.

## Queries

- Suggestions for a surface at the selected facility (`inventory`, `billing`, `appointments` with an optional `date`, `queue`, `encounter` with the
  `encounterId`, `laboratory`, `laboratory-quality`, `security`, `settings`, `outreach`, `dental` with the `patientId`, `pharmacy` with an optional
  `prescriptionId`; `prescribing` reads nothing without a draft); each request audits `assistant.view` with the surface, rule ids, the number shown
  and the consultation's, patient's or prescription's id, never a finding, and adds what it showed to each rule's count for the facility's day
  (`assistant_rule_shown`). Rules whose source permission the caller lacks are listed in `withheld` by
  title, with no counts. A stored setting the rule no longer accepts keeps the rule silent until it is saved again. At most 20 suggestions a request.
- A draft checked before it is saved: `POST /assistant/suggestions/check` with `surface: prescribing`, the consultation, the
  drafted medicines (name, strength, dose, unit, frequency) and the prescription being replaced, if any. The same answer as a
  screen's (items, dismissed, withheld), from the rules turned on; audited `assistant.view` with the surface, rule ids, the
  consultation and the number of medicines, never a medicine. `404` for a consultation of another organization.
- Rules with the setting in force for a scope (and, for a facility, the organization's) and each rule's latest review; the replay; insights per rule
  over 1–365 days (`assistant.insights.read`): where it is on (organization, number of facilities), times shown, followed (`accepted`), dismissed and
  not useful, `reviewSuggested` (at least 20 answers, 70% or more dismissed or not useful), `reviewDue` (on, and never reviewed, reviewed over 92 days
  ago or on an earlier rule version), the latest five reasons given and the latest review — prompts for the administrator, never an automatic change;
  a rule's reviews, newest first, with who recorded each.

- Record a review of a rule (`assistant.configure`): `keep`, `adjust` (thresholds changed on the settings screen) or `retire`,
  with a note, the false positives found and the date (not in the future: `422 review_date_in_future`). Retiring inserts,
  in the same transaction, a disabled version of every setting of the rule that is on (the organization's and each
  facility's; parameters kept). Audited `assistant.rule-review` with the rule, version, outcome and how many scopes were
  turned off — never the note.
- Following a suggestion's link records `accepted` (the staff app's `/assistant/followed` route, sent with
  `navigator.sendBeacon`); it hides nothing. "Not useful" may carry the person's own words (`reason`, up to 500
  characters; the panel asks for no patient details).

## Events

`AssistantSuggestionActedOn` (aggregate `assistant_feedback`; payload: rule id, rule version, outcome).

## Permissions

Migrations `0152`–`0154` and the `PERMISSIONS` catalog. `assistant.use`: org_admin, inventory_officer (0152), cashier, receptionist, nurse (0153),
physician, dentist, medical_technologist, pathologist (0154); the integrity and security rules need no new grant (their screens' permissions,
`audit.read` and `compliance.review.manage`, are organization administrators'), nor do the order-set and monitoring rules (doctors hold
`assistant.use` since 0154), the dental rules (dentists hold it since 0154; dental assistants do not) and the outreach rules (the outreach permissions
are organization administrators'). Migration `0157` grants `assistant.use` to pharmacists for the pharmacy rules (nurses, who also dispense, hold it
since 0153). `assistant.configure` and `assistant.insights.read`: org_admin. A rule's suggestions also need the permission of what it reads (table
above); without it the rule is withheld.

## API

`/api/v1/assistant`: `GET /suggestions?surface=&date=&encounterId=&patientId=&prescriptionId=` (facility header), `POST /suggestions/check` (a draft),
`POST /suggestions/:id/feedback`, `GET /rules[?facilityId=]`, `PUT /rules/:ruleId/settings`, `POST /rules/:ruleId/replay`, `GET /insights?days=`, `GET
/rules/:ruleId/reviews` (`assistant.insights.read`), `POST /rules/:ruleId/reviews` (`assistant.configure`).

## UI

`AssistantPanel` and `SuggestionCard` in `@healthcare/ui/healthcare` (Storybook "Healthcare/Assistant"): a "Decision support"
badge, severity as label plus icon, "Based on limited data" for weak signals, **Why?** (basis, evidence, rule and version),
Dismiss, Not useful, and a link as the only action. Presentational: the staff app loads suggestions and sends answers from its
server.

Screens: staff `/inventory` (above the stock table), `/billing` (above the cashier's desk), `/appointments` (above the day board, for the day shown)
and `/queue` (under the figures, through the `assistant` slot of `QueueWorkspace`, only while someone is in the queue), the consultation workspace
`/clinic/encounters/[id]` (top of the centre column through its `assistant` slot, only while the consultation is in progress) and the laboratory
workbench `/laboratory/worklist` (above the worklist, in the layout's notice area), the QC page `/laboratory/qc` (surface `laboratory-quality`, above
the QC board), a patient's dental record `/dental/patients/[id]` (surface `dental` with the patient's id, above the chart, with a facility selected),
the pharmacy `/pharmacy` (surface `pharmacy`, above the search) and a prescription's dispense screen `/pharmacy/[prescriptionId]` (surface `pharmacy`
with its id, above the prescribed lines, while the prescription is active), the audit log `/admin/audit` (record access), the Settings home `/admin`
(compliance areas) and `/outreach` (above the segments). Each loads its surface with `loadSuggestions` (`apps/staff/src/lib/assistant-suggestions.ts`)
in parallel with the page's own data and shows the panel only when there is something to say; a failed assistant request never breaks the page.
`AssistantSuggestions` (`apps/staff/src/components`) sends answers through `answerSuggestion` (`apps/staff/src/app/(staff)/assistant-actions.ts`),
which refreshes that screen.

End to end: journey `apps/e2e/tests/34-assistant.journey.ts` follows the stock rule `inventory.days-of-cover` through these screens and the
settings below. An administrator turns it on for the organization, stock is received and issued until it would not last a delivery, and an
inventory officer sees the suggestion on `/inventory` (Decision support, **Why?** with its evidence, rule and version), follows its link (counted as
followed) and marks it **Not useful** with a reason (hidden for them). The administrator then reads the counts and the reason on the rule's insights
page and records a review that retires it, and the rule's settings card shows it off with that review.

The prescribing dialog in the consultation (`prescriptions-panel.tsx`) checks the draft when the person holds
`assistant.use` (`checkPrescriptionDraft`, `apps/staff/src/lib/prescribing-check.ts`): on **Issue** (or **Replace**), findings
are shown first under "Before you issue", the button becomes **Issue anyway** and the next click issues; editing a medicine
checks again; without findings, or when the assistant cannot answer, the prescription is issued at once. Dismissing there
hides the finding for 14 days for that person and that consultation. The medicine settings are kept at **Settings →
Clinical → Prescribing checks** (`/clinic/prescribing`, `clinic.configure`).

Two links open a form filled in, never a saved record: an order set's opens the consultation's lab order form with the
set's tests and panels chosen (`?orderSet=`; the page reads the set, `LabOrdersPanel` scrolls to it and says where the
choice came from; the address drops it when the form closes, so a reload cannot reopen it), and an audience idea's opens
the new segment form on `/outreach` with its name and criteria (`?segment=new&…`, read by `segmentDraftFrom` in
`apps/staff/src/lib/outreach-draft.ts`: only known criteria within the API's ranges; the address drops them when the form
closes).

Settings: staff `/admin/assistant` (**Settings → Assistant**, `assistant.configure`) shows every rule for the whole organization or one facility
(`?facility=`): its state, an on/off switch and its parameters labelled from the rule's own `parameterLabels`, so a new rule needs no screen change;
**Try these values** replays the rule over the last 14 days at the facility of the scope (else the one selected in the top bar) with the values in the
form, saved or not, and says how often it would have spoken. With `assistant.insights.read` the page links to **Insights and reviews**
(`/admin/assistant/insights`: every rule with where it is on, times shown, followed, dismissed and not useful, review due and mostly dismissed first,
over 30, 90 or 365 days; `/admin/assistant/insights/[ruleId]`: the counts, what staff said, the review form and the reviews), and each rule card shows
its latest review and known false positives. Wording helpers in `apps/staff/src/lib/assistant-settings.ts` (unit-tested). Manual: chapter 13, "How to
turn on the assistant's suggestions", and each screen's chapter (3, 4, 5, 6, 7, 8, 9, 10, 11).

## Command bar

Not a rule: a way to reach screens and patients by typing (phase 2). **Ctrl+K** (⌘K), or the top bar's **⌘** button, opens it
anywhere in the staff app (`CommandBar` in `apps/staff/src/components/command-bar.tsx`, mounted in the shell). The words are
read by `apps/staff/src/lib/command-bar.ts` (pure, unit-tested; fixed word lists, no model):

- **Days**: today / tomorrow / yesterday (ngayon / bukas / kahapon), weekdays (the next one, today included), "Nov 25",
  "25 Nov 2027", ISO dates, in the facility's time zone; impossible days are ignored.
- **Patient actions** at the start or end (`PATIENT_VERBS`: book, check in / walk-in, bill, labs, visits, 360, timeline,
  history, vaccines, edit, communications, dental, coverage, open), each behind the permissions its page checks; without
  them a patient is offered as "Open the record".
- **Screens**: the navigation, every module tab (`moduleTabsForPermissions`), the Settings pages and shortcuts (register,
  walk-in, book, the lab worklist's stages, low and expiring stock, the waiting-room display, account, notifications, help),
  all from the permissions — the same lists the menu uses — ranked by how many words they hold; screens that show a day
  (`/appointments`, `/calendar`, `/appointments/new`) open the day named.
- **Patients**: what is left after actions, days, filler words and screen words is searched as a name or number (three
  characters or more, 400 ms after typing stops) through the ordinary `GET /patients` (`findPatientsForCommand`, a server
  action; `patient.search`; audited by the API like any search; id, number, name, sex, age and status only).
- **Help**: the two manual sections that best match the phrase, from the sections the shell already has.

Every result is a link; nothing is done for the person. Patients come first when an action was named, screens otherwise.
No API, permission or migration was added.

## Integration points and limits

- Dispensing is not charged by billing, so it is not part of `billing.uncharged-work`; laboratory orders and consultations
  are not checked yet.
- Dismissals are per person, not shared. A dismissed uncharged-work group hides later items of the same code and reason
  for that person too, for 14 days. Nothing is learned automatically.
- Replays read past days at one time of day; the queue rule's answer depends on that hour.
- The consultation and laboratory rules are clinical decision support (CLAUDE.md §35): labelled as such, showing their
  basis, never applied, overridable by ignoring or dismissing, logged, and off until turned on. Each organization's
  clinicians validate a rule and its thresholds before it is turned on (compliance register); no test-specific delta
  limits, triage scale or code set is shipped.
- Code suggestions read other patients' coded diagnoses only as codes, their most common description and a count, and only
  codes used at least twice, so no single patient's free text is offered.
- The delta check compares results with the same unit only; it does not convert units or read reference ranges.
- Record-access suggestions are analytics about staff behaviour from the audit trail. Whether and how staff are told that
  access is reviewed is the organization's (Data Privacy Act; compliance register). Only administrators see them, nothing
  is blocked or sent, and the request is audited with rule ids only.
- An organization's validation of its own configuration is recorded by people; the compliance rule only says what has
  not been recorded. Areas that do not apply (for example dental estimates without dentistry) are dismissed.
- Which tests an order set holds and what it is offered for are the organization's clinical decisions; no guideline or
  national order set is shipped, and nothing is ordered without the doctor.
- The send hour is a statistic over the audit trail's MyHealth activity (counts per hour, no account, patient or action);
  whether the privacy notice covers using it to time outreach is the organization's (compliance register). It says
  nothing about patients without MyHealth or about text messages.
- Audience ideas are fixed (recall from the organization's own return time, next month's birthdays): no clinical
  criterion, and nothing is created or sent until people save a segment and a second person approves a campaign.
- The laboratory turnaround rule uses the facility's own medians, so a test that is often referred out or recollected has a
  long usual time; it moves no order. The QC rules add a drift and a shift check to the facility's Westgard rules and never
  change a run's evaluation or block results. Rejection rates per collector are analytics about staff work: only quality
  managers see them, and how staff are told is the organization's (compliance register).
- The prescribing checks are clinical decision support that complements the drug–allergy check (which still runs when a
  prescription is issued) and replaces nothing. Names are compared by their words: a different salt ("metoprolol tartrate"
  and "metoprolol succinate"), spelling or brand-only name may not match, so no finding is not evidence of safety. Doses are
  compared in the setting's unit only, without conversion, body weight, kidney function or the patient's other medicines.
  The kidney and pregnancy checks are prompts: nothing reads a result or records that the check was done. Every class,
  maximum and check is the organization's own (compliance register).
- The dental rules read the chart as charted: a tooth charted missing by mistake makes a plan item look impossible until the
  examination is entered in error or a new one charts the tooth again. Surfaces are checked when an item is saved, so they
  need no rule; no dental recall interval is kept, so none is checked.
- The monitoring gap uses the organization's order sets as its configuration: a diagnosis with no set, or not marked chronic (as on the Patient 360
  problem list), is never checked, and the months are one value for every set. A test counts as done when one of its item's tests (a panel's members)
  was released for the patient here, whatever the value; outside results filed on the record are not read. When the consultation's own diagnosis
  matches the set, the order sets rule may offer the same set: one says what is not ordered yet, the other how long it has not been done. Overdue and
  next-due care-plan activities are the care plans' recall list, not a rule.
- The pharmacy rules match stock to a prescribed medicine by the words of its name and its strength, like the dispense
  form's ranking: a brand-only stock name, a different spelling or a strength written differently may not match, so no
  suggestion is not evidence that stock is enough or lasts. Waiting prescriptions count one fill (refills are not counted)
  and only in the prescribed unit; prescriptions are often filled elsewhere, so the shortfall is what this pharmacy would
  need, not a demand forecast. Dispensing always takes the earliest expiry first, so the course check never picks a lot:
  it points to another place, a smaller quantity or telling the patient.
- The online-consultation rule's red flags are the questionnaire's fixed list (`RED_FLAGS`); an organization's own list is
  not built. "Never seen in person here" counts this organization's consultations only. It never escalates: the doctor
  does, from the online consultation panel.
- MyHealth shows no suggestion. Phase 3's result wording is fixed text in `@healthcare/domain/portal-results`
  (`resultExplanation`, `RESULT_WORDING_VERSION`), shown under **About this result** on MyHealth's result page: where the
  value sits against the usual range of the laboratory that did the test, what a usual range is, that a critical result
  went to the care team before it was shown (patients see one only after it was acknowledged), and that the doctor explains
  what it means. It never interprets a value. Organizations record who reviewed it under Settings → Compliance ("Results
  shown to patients", `patient_results`, migration `0158`), which `admin.compliance-gaps` also lists until it is reviewed.
- Governance counts are impressions: a suggestion seen on five page loads is shown five times; followed counts link
  opens, not what was done on the screen it opened. Staff's reasons are their own words, read only by administrators;
  the panel asks for no patient details, and nothing checks the words. A review records the organization's decision and
  is its clinical sign-off for a clinical rule; the platform changes no threshold by itself.
