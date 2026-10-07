# Management dashboard

Operational figures across the platform's domains for a range of days (CLAUDE.md §28, _Management_): patient volume
and retention, appointments and no-shows, waiting time, provider and schedule utilization, laboratory volume,
turnaround and specimen rejection, dental procedures, online consultations, revenue, collections and services, stock
received and used at cost, and dispensing from prescriptions, with the headline figures beside the previous period. It is an **operational** view for the organization's managers — not an
official, DOH or BIR report, and nothing on it names a patient.

## Composition

Like the patient timeline, the dashboard is a cross-domain read model composed in the API
(`apps/api/src/app/management-dashboard`). Each domain counts its own rows in its own library, over the same window
(`ReportingWindow` in `libs/core`: an instant range, the facilities, the time zone for local days):

| Domain       | Query                                                                   | Figures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patient      | `PatientReportingQueries.registrations`                                 | Patients registered (by registration facility; merged records left out), per day                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Clinic       | `ClinicReportingQueries.figures`, `.retention`                          | Appointments by start (booked = not cancelled, completed, no-show, cancelled, booked by the patient; no-show rate = no-shows / booked); check-ins (walk-ins, left without being seen, average check-in-to-consultation wait); completed encounters (online, patients seen, returning — seen before the range anywhere in the organization); per practitioner (with booked and available schedule minutes); per day (consultations, distinct patients seen); retention and return counts                              |
| Laboratory   | `LabReportingQueries.figures`                                           | Orders (STAT, cancelled) and tests ordered by order time; first releases (a result's version 1) with the average collection-to-release time and the share that met the test's own turnaround target; corrections released; specimens rejected; specimens collected in the range and how many of them were rejected; first result versions entered per instrument; the ten most ordered tests; per day                                                                                                                |
| Dental       | `DentalReportingQueries.figures`                                        | Procedures recorded (not entered in error), patients treated, the ten most used procedure codes with their distinct patients                                                                                                                                                                                                                                                                                                                                                                                         |
| Telemedicine | `TelemedicineReportingQueries.figures` (`libs/telemedicine`)            | Online consultations whose video consultation started in the range, by current status (ended, escalated, in consultation)                                                                                                                                                                                                                                                                                                                                                                                            |
| Inventory    | `InventoryReportingQueries.figures` (only with inventory valuation)     | Movements recorded in the range at the stock locations of the facilities in scope, valued at the cost each movement recorded: received (receipts), used per workflow (the movement's source: dispensing, laboratory reagents, dental and clinic procedures, immunizations; plain issues, write-offs and count adjustments; returns net off), written off, the quantity moved before costs were recorded, and the ten items that consumed the most value. Transfers between locations are not use. No patient, no lot |
| Prescription | `PrescriptionReportingQueries.figures` (only with prescription reading) | Prescriptions issued in the range (and how many are cancelled or replaced since), dispense lines recorded and reversed, distinct prescriptions dispensed and patients served (standing dispenses; a merged pair once), the ten items dispensed most by quantity, standing dispenses per day                                                                                                                                                                                                                          |
| Billing      | `BillingReportingQueries.figures` (only with billing reporting)         | Invoices issued in the range and still valid (gross, discounts, net, payer and patient shares), voids, credit and debit notes, payments and refunds by method, net by service category, the ten services with the most net revenue (with distinct patients invoiced); invoiced and collected per day (centavos)                                                                                                                                                                                                      |

The API adds the rates, suppression, the previous-period comparison and one row per day of the range (zeros filled
in). The pure rules — range, facility scope, suppression, comparison, retention figures, revenue gating — live in
`management-dashboard.rules.ts` (with the CSV writer and summary table; the other export tables in the service); the definitions below in
`management-dashboard.definitions.ts` (returned as `definitions` and shown in the staff app). They stay in the API
rather than a separate `libs/reporting` library: the dashboard is the only consumer, and one place avoids duplicating
the rules (ADR-0011 records when the library is created: a second process, such as scheduled reports from a worker,
needing the same rules).

## Metric definitions ("How is this calculated?")

Every figure covers the chosen local days at the facilities in scope. The API returns the same text as
`definitions`; the staff app shows it under each figure.

- **Patients seen** — distinct patients with at least one completed consultation (in person, online or dental)
  completed in the period. Entered-in-error consultations are never counted.
- **New patients** — patient records registered in the period at the facilities in scope (the registering facility);
  records merged into another are left out.
- **Returning patients** — patients seen in the period who had a completed consultation before the period, anywhere in
  the organization. First-time = seen − returning. Returning rate = returning ÷ seen.
- **Consultations** — encounters completed in the period, in person and online (telemedicine modality).
- **No-show rate** — no-shows ÷ appointments booked (appointments starting in the period; cancelled ones excluded from
  both).
- **Average wait** — average minutes from check-in to the start of the consultation, for visits checked in during the
  period whose consultation started. **Median** and **90th percentile** of the same waits (`percentile_cont`) sit beside
  it: the wait half, and nine in ten, of those visits beat, which one very long wait does not sway. The median is a key
  figure and compared; the 90th percentile is shown under it.
- **Schedule utilization** (per practitioner and overall) — booked minutes (appointments starting in the period, not
  cancelled, no-shows included) ÷ available minutes: the practitioner's weekly schedules at the facilities in scope valid
  on each day (a retired schedule until it was retired), less leave and facility closures (a multirange difference, so
  overlapping exceptions are not subtracted twice). Can exceed 100% when booked outside the schedule; empty without
  schedules. Overall = all booked minutes ÷ all available minutes.
- **Invoiced (net)** — net total of invoices issued in the period and still valid (voided excluded; credit and debit
  notes shown separately). **Collected** — payments recorded in the period less refunds recorded in the period
  (deposits and account credit not included).
- **Lab tests released** — tests whose result was first released in the period (a result's first version); later
  versions count as corrections. **Turnaround** — average minutes from collection to that first release, with the
  **median** (a key figure, compared) and **90th percentile** beside it. **Within target** — of those whose catalog
  entry has a turnaround target, the share released within it. **By department** — the same release, average and
  median turnaround and within-target figures per `lab_department` (the department of each test's catalog entry).
- **Specimen rejection rate** — specimens rejected ÷ specimens collected, for specimens collected in the period
  (whenever they were rejected). The older "specimens rejected" figure (rejected in the period) is kept.
- **Results per instrument** — first versions of results entered in the period, by the instrument recorded on them
  ("No instrument recorded" when none).
- **Dental procedures** — performed in the period, excluding entered in error; patients = distinct patients treated.
- **Online consultations** — telemedicine sessions whose video consultation started in the period: ended, escalated to
  in-person care, still in consultation. **Escalation rate** = escalated ÷ finished (ended + escalated). Not a quality
  target. **Waiting room** — for consultations started in the period, the average, median and 90th percentile minutes
  from the patient joining the waiting room to the consultation starting; **joined, never seen** counts sessions whose
  patient joined the waiting room in the period and whose consultation never started (one patient each, so suppressed
  like a patient count).
- **Retention** — of the patients seen in the period at the facilities in scope, the share who also had a completed
  consultation there in the **12 months** before the period started.
- **Returned within 90 days** — cohort: patients seen in the period whose first completed consultation in the period
  was more than 90 days before today (their follow-up window has fully elapsed); rate: the share with another completed
  consultation at the facilities in scope on a **later local day**, at most 90 days after that first one.

- **Stock used at cost** (a key figure, neither direction better) — issues, dispenses, write-offs and count adjustments
  in the period, net of returns, each at the cost its movement recorded when posted (`docs/domains/inventory.md`,
  valuation), so the figure never shifts. Received and written off beside it; the quantity moved before costs were
  recorded is shown, not valued. Transfers between locations are not use. Operational figures, not accounting or BIR.
- **Dispenses** (a key figure, neither direction better) — dispense lines recorded from prescriptions in the period; a
  reversed dispense is counted as recorded and again as reversed. Prescriptions issued (and cancelled or replaced
  since), prescriptions dispensed, patients served (a patient count, suppressed) and the items dispensed most count
  standing dispenses only.

"Seen" is a completed consultation throughout (the dashboard's existing definition), so retention's patients equal the
patients seen.

## Previous-period comparison

The same queries also run for the comparison period: by default the period of the same length just before the range
(30 days before the last 30 days; the day before a single day), or, with `comparison=last-year`, the same calendar
dates one year earlier (`comparisonRange`; 29 February falls back to 28 February, so a leap-year range compares with
one day less). `previous.mode` says which. The API returns the headline figures for both — `keyFigures` and
`previous.keyFigures`: patients seen, new patients, consultations, no-show rate, average and median wait, net invoiced,
net collected, laboratory tests released, average and median laboratory turnaround, dental procedures, specimen
rejection rate, retention rate, stock used at cost and dispenses — and, per figure,
`previous.changes[key]`: its `unit`, which direction is `better` (up for volumes, revenue and retention; down for
no-shows, waiting, turnaround and rejections) and the `change` (absolute — a fraction for rates: 0.05 = 5 percentage
points —, relative (not for rates, nor from zero), direction, and the assessment `better` / `worse` / `unchanged` /
`neutral`). A suppressed (`"<5"`), withheld (revenue: `null`) or missing value on either side gives no change. The staff
app shows main's change text with the assessment, coloured (e.g. "▲ 2.5 pts (worse) vs the previous 30 days").

## Privacy: small-cell suppression

- **Aggregate only.** No patient id, number or name leaves a domain query; distinct-patient counts are numbers
  computed in SQL.
- **Suppression** (`SMALL_CELL_THRESHOLD = 5` in `management-dashboard.rules.ts`): every **patient count** from 1 to 4
  — registered, seen, returning and first-time totals and per day, per practitioner, per service, per dental procedure
  code, dental patients treated, retention cohorts — is returned as `"<5"` (JSON and CSV); 0 is shown. A rate whose
  numerator or denominator is such a count (returning rate, retention, return) is withheld (`null`, `…Suppressed:
true`). Consultation, test and procedure counts and money are not patient counts and are shown exactly.
- The threshold is a platform choice (a common minimum cell size in health statistics), **not a regulatory figure** —
  confirm it with the organization's Data Protection Officer. Complementary disclosure (deriving a small cell from a
  total and the other cells) is limited because distinct counts do not add up across cells, but it is not formally
  prevented.
- Daily new-patient counts are no longer charted (a day's count under five is suppressed); they stay in the JSON and
  the daily CSV.
- Practitioner names appear (staff, not patients).

## Rules

- **Range:** local days, inclusive, at most 366; the last 30 days by default. Days are read in the facility's time zone
  (one facility filtered), else the request's facility's, else Asia/Manila.
- **Scope:** `management.dashboard.read` (org_admin; migration `0059`). An organization-wide grant covers every facility
  and the whole-organization view; a grant through a facility role covers only that facility (another facility is
  refused with 403, and without a facility filter the figures cover the granted facilities only).
- **Revenue:** revenue, collections, revenue by category, payment methods and top services also need the existing
  `billing.report.read` on **every** facility the figures cover (organization-wide, or a facility grant on each). Without
  it `billing` is `null`, `withheld` lists `billing`, billing is not queried, the daily `invoiced`/`collected` are
  `null`, the key figures `netInvoiced`/`netCollected` are `null` (no change), revenue rows are left out of the summary
  and daily exports, and the revenue tables (`services`, `categories`, `revenue`, `collections`) are refused (403).
  org_admin holds it.
- **Stock and dispensing** follow the same rule with their own permissions (`WITHHELD_SECTIONS`, `TABLE_SECTIONS` in
  `management-dashboard.rules.ts`): `inventory` needs `inventory.valuation.read` (tables `inventory`,
  `inventory-items`; key figure `stockUsed`), `dispensing` needs `prescription.read` (tables `dispensing`,
  `dispensing-items`; key figure `dispenses`; the daily `dispenses` column). A withheld section is `null`, named in
  `withheld`, not queried, left out of the summary and daily exports, and its tables are refused (403, audited as a
  denial naming the permission). org_admin holds both. No new permission.
- **Merged patients:** distinct-patient counts (patients seen, returning, retention, dental and invoiced patients)
  count a merged pair once (`canonicalPatientId`, ADR-0009); registrations leave merged (retired) records out.
- **Audit:** every view is recorded (`management.dashboard.view`, with the range, facilities and `withheld`), every
  export too (`management.dashboard.export`, with the table, range, facilities, `withheld` and number of rows); a refused
  revenue export is recorded as a denial (`outcome = denied`, with the reason).
- **Performance:** partial indexes on the time columns the queries filter (migrations `0059` and `0063`: specimens by
  collection, first result versions by entry, started teleconsultations, recorded dental procedures). The dashboard
  reads the transactional tables directly (twice: the range and the previous period); if volumes grow, materialized daily aggregates are the
  next step.

## API

- `GET /api/v1/management/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&facilityId=&comparison=previous|last-year` → figures,
  `daily`, `keyFigures`, `previous` (`from`, `to`, `mode`, `keyFigures`, `changes`), `retention`, `telemedicine` (with
  waiting-room figures), `laboratory.byDepartment`, `suppressionThreshold`, `withheld`,
  `definitions`, the facilities the caller may choose (`facilities`) and whether the whole organization is available
  (`wholeOrganization`). 400 for an unusable range, 403 outside the caller's facilities, 404 for an unknown facility.
- `GET /api/v1/management/dashboard/export.pdf?from=&to=&facilityId=&comparison=` → the whole dashboard as one A4 PDF
  (`application/pdf`, attachment `management-dashboard-{from}-to-{to}.pdf`; `management-dashboard.pdf.ts` over
  `libs/pdf`): the organization's letterhead (the facility's when one facility is filtered), the period, scope and
  comparison, the key figures table (both periods, change, better when, assessment), then every section's table in
  the screen's order — a withheld section is printed as "Not available to you: … permission" rather than left out —
  and the metric definitions; the footer says the figures are operational, not official, DOH, PhilHealth or BIR
  reports, and that counts under five show as "<5". Audited as `management.dashboard.export` with `table: "pdf"`.
- `GET /api/v1/management/dashboard/export?table=…&from=&to=&facilityId=&comparison=` → one table as `text/csv` (attachment
  `management-{table}-{from}-to-{to}.csv`), RFC 4180 with a UTF-8 byte-order mark, amounts in pesos with two decimals,
  rates as fractions. Tables: `summary` (each key figure for the range and the previous period, the change, which way is
  better and the assessment), `daily`, `providers` (with booked and available minutes and utilization), `laboratory`
  (with median and 90th-percentile turnaround), `lab-tests`, `lab-instruments`, `lab-departments`, `dental-procedures`,
  `telemedicine` (with the waiting-room figures), `retention`, — with billing reporting —
  `services` (with patients), `categories`, `revenue`, `collections`, — with inventory valuation — `inventory`
  (received, used, written off, used per workflow: quantity, value at cost, quantity without a cost),
  `inventory-items`, and — with prescription reading — `dispensing`, `dispensing-items`. Suppression applies. A cell starting with `=`, `+`,
  `-`, `@`, a tab or a carriage return is prefixed with an apostrophe, so spreadsheets never run staff-entered names as
  formulas. The same scope rules apply.

## Staff app

`/management` (navigation _Management_, shown with `management.dashboard.read`): range, facility and comparison
filters (the period just before, or the same dates last year) with quick ranges; key figures, each with its comparison
change (arrow, words and colour — never colour alone), the median and 90th percentile under the wait and turnaround
figures, and "How is this calculated?"; a laboratory-by-department table and the waiting-room figures of online
consultations; two daily charts — activity (consultations and lab releases) and revenue (pesos, only when not
withheld), never on one axis — each with a legend and a table view (`DailySeriesChart` in `@healthcare/ui/healthcare`);
tables of top services, revenue by category and payment method, providers with utilization, laboratory tests and
instruments, dental procedure codes, online consultations, stock received and used (per workflow, with the items that
used the most value), dispensing (the items dispensed most) and retention; CSV downloads of each table (a gated table
only when its section is not withheld) through the `/management/export` route handler and **Download as PDF** through
`/management/export.pdf`, both passing only known tables and well-formed filters to the API with the user's session
(the token never reaches the browser). A note names the sections not shown and the permission each needs.

## Scheduled reports

A schedule (`management_report_schedule`, migration `0093`) names a weekly (Monday to Sunday) or monthly (calendar
month) cadence, the dashboard tables wanted (from `EXPORT_TABLES`) and/or the whole dashboard as a PDF (`pdf`, together
`REPORT_FILES`; the `tables` column checks only the count, so no migration), a facility or every facility the owner may report
on, and named recipients. The hourly `ManagementReportRuns` job in the API process (`pg_try_advisory_xact_lock`, so one
instance at a time) takes every active schedule, works out which periods have ended in the schedule's facility time
zone (else Asia/Manila) and are not yet produced (at most three missed periods are caught up, oldest first), claims
each period as a `management_report` row (unique per schedule and period start, so two instances never produce it
twice) and produces it through the very same `ManagementDashboardService.export` the screen uses — with the **owner's**
permissions, re-resolved at each run (the owner is whoever last created or changed the schedule). Each table is stored
once as a `management_report` document (`DocumentsService.storeGenerated`, `text/csv` with a byte-order mark, or
`application/pdf` for the PDF; `management_report_file`). A table the owner may no longer export (a refusal) is listed
in `withheld` and the run is `partial`; the PDF is always produced with what the owner may see, and each section it had
to print as not available is listed in `withheld` as `pdf:<section>` (the run is `partial` then); any other failure marks the run `failed` with the error text. A run left `producing` for more than ten
minutes (a crashed instance) is resumed on the next tick, file by file, and a `failed` run is tried again every hour
for seven days from its start (files already stored are kept), then left for someone to look at. Every produced run is audited
(`management.report.produce`, system actor, with the schedule, period, tables and `withheld`) and each recipient gets
an in-app and email notice (`management.report-ready`: the schedule name, the period and a link to the reports page —
never a figure; idempotent per run, recipient and channel).

- **Who may schedule:** `management.report.manage` (org_admin; migration `0093`). A schedule is refused when the
  caller's own grants do not cover the scope (`scope_not_reportable`), when a gated table is wanted without its
  permission on every facility in scope (`revenue_not_reportable`, `stock_not_reportable`,
  `dispensing_not_reportable`; the PDF needs none, it marks what is missing), or when a recipient is not an active
  member holding `management.dashboard.read` for the scope (`recipient_not_member` / `recipient_not_permitted`), so a
  schedule that could only produce an empty or unreadable report is never created. Changing a schedule (optimistic
  `version`) makes the caller its owner, under the same checks; pause and resume keep the owner.
- **Who may read:** `management.dashboard.read` lists schedules and runs and downloads files; a gated table is
  refused at download (403, audited as a denial) without its permission on every facility of the run — the
  file exists, but the reader's permissions decide, exactly as on the screen. The PDF holds every section its owner
  could see, so it opens only for a reader holding each of those sections' permissions on the run's facilities (a
  section listed as `pdf:<section>` in `withheld` is not in it and not required). Downloads are audited
  (`management.report.download`).
- **What is in a file:** exactly what the export gives for that range and scope (same suppression, same formula
  safety). Nothing names a patient. The notice names no figure.
- **API:** `GET|POST /api/v1/management/report-schedules`, `PUT /management/report-schedules/:id`,
  `POST /management/report-schedules/:id/status`, `GET /management/reports?scheduleId=`,
  `GET /management/reports/:id/files/:table` (`text/csv`; `application/pdf` for `pdf`).
- **Staff app:** `/management/reports` (navigation _Management → Scheduled reports_): schedules with pause, resume and
  change (recipients chosen from the staff list, which needs `user.read`), the produced reports with a link per stored
  table through the `/management/reports/[id]/files/[table]` route handler, and what was withheld or failed.
- **Not built:** a spreadsheet with several sheets, attachments in the email (the file stays behind the
  signed-in download), daily or custom cadences, a report for a range chosen by hand (the dashboard export does that),
  and sending to addresses outside the organization.

## Not yet

Scheduled reports as an email attachment, stock value as of a date on the dashboard (the valuation screen shows it per
facility), and a comparison that aligns weekdays rather than calendar dates.
