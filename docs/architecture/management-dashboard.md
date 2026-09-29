# Management dashboard

Operational figures across the platform's domains for a range of days (CLAUDE.md §28, _Management_): patient volume
and retention, appointments and no-shows, waiting time, provider and schedule utilization, laboratory volume,
turnaround and specimen rejection, dental procedures, online consultations, revenue, collections and services, with the
headline figures beside the previous period. It is an **operational** view for the organization's managers — not an
official, DOH or BIR report, and nothing on it names a patient.

## Composition

Like the patient timeline, the dashboard is a cross-domain read model composed in the API
(`apps/api/src/app/management-dashboard`). Each domain counts its own rows in its own library, over the same window
(`ReportingWindow` in `libs/core`: an instant range, the facilities, the time zone for local days):

| Domain       | Query                                                           | Figures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patient      | `PatientReportingQueries.registrations`                         | Patients registered (by registration facility; merged records left out), per day                                                                                                                                                                                                                                                                                                                                                                                                        |
| Clinic       | `ClinicReportingQueries.figures`, `.retention`                  | Appointments by start (booked = not cancelled, completed, no-show, cancelled, booked by the patient; no-show rate = no-shows / booked); check-ins (walk-ins, left without being seen, average check-in-to-consultation wait); completed encounters (online, patients seen, returning — seen before the range anywhere in the organization); per practitioner (with booked and available schedule minutes); per day (consultations, distinct patients seen); retention and return counts |
| Laboratory   | `LabReportingQueries.figures`                                   | Orders (STAT, cancelled) and tests ordered by order time; first releases (a result's version 1) with the average collection-to-release time and the share that met the test's own turnaround target; corrections released; specimens rejected; specimens collected in the range and how many of them were rejected; first result versions entered per instrument; the ten most ordered tests; per day                                                                                   |
| Dental       | `DentalReportingQueries.figures`                                | Procedures recorded (not entered in error), patients treated, the ten most used procedure codes with their distinct patients                                                                                                                                                                                                                                                                                                                                                            |
| Telemedicine | `TelemedicineReportingQueries.figures` (`libs/telemedicine`)    | Online consultations whose video consultation started in the range, by current status (ended, escalated, in consultation)                                                                                                                                                                                                                                                                                                                                                               |
| Billing      | `BillingReportingQueries.figures` (only with billing reporting) | Invoices issued in the range and still valid (gross, discounts, net, payer and patient shares), voids, credit and debit notes, payments and refunds by method, net by service category, the ten services with the most net revenue (with distinct patients invoiced); invoiced and collected per day (centavos)                                                                                                                                                                         |

The API adds the rates, suppression, the previous-period comparison and one row per day of the range (zeros filled
in). The pure rules — range, facility scope, suppression, comparison, retention figures, revenue gating — live in
`management-dashboard.rules.ts`; CSV tables in `management-dashboard.csv.ts`; the definitions below in
`management-dashboard.definitions.ts` (returned as `definitions` and shown in the staff app). They stay in the API
rather than a separate `libs/reporting` library: the dashboard is the only consumer, and one place avoids duplicating
the rules.

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
  period whose consultation started.
- **Schedule utilization** (per practitioner and overall) — booked minutes (appointments starting in the period, not
  cancelled, no-shows included) ÷ available minutes: the practitioner's weekly schedules at the facilities in scope valid
  on each day (a retired schedule until it was retired), less leave and facility closures (a multirange difference, so
  overlapping exceptions are not subtracted twice). Can exceed 100% when booked outside the schedule; empty without
  schedules. Overall = all booked minutes ÷ all available minutes.
- **Invoiced (net)** — net total of invoices issued in the period and still valid (voided excluded; credit and debit
  notes shown separately). **Collected** — payments recorded in the period less refunds recorded in the period
  (deposits and account credit not included).
- **Lab tests released** — tests whose result was first released in the period (a result's first version); later
  versions count as corrections. **Turnaround** — average minutes from collection to that first release.
  **Within target** — of those whose catalog entry has a turnaround target, the share released within it.
- **Specimen rejection rate** — specimens rejected ÷ specimens collected, for specimens collected in the period
  (whenever they were rejected). The older "specimens rejected" figure (rejected in the period) is kept.
- **Results per instrument** — first versions of results entered in the period, by the instrument recorded on them
  ("No instrument recorded" when none).
- **Dental procedures** — performed in the period, excluding entered in error; patients = distinct patients treated.
- **Online consultations** — telemedicine sessions whose video consultation started in the period: ended, escalated to
  in-person care, still in consultation. **Escalation rate** = escalated ÷ finished (ended + escalated). Not a quality
  target.
- **Retention** — of the patients seen in the period at the facilities in scope, the share who also had a completed
  consultation there in the **12 months** before the period started.
- **Returned within 90 days** — cohort: patients seen in the period whose first completed consultation in the period
  was more than 90 days before today (their follow-up window has fully elapsed); rate: the share with another completed
  consultation at the facilities in scope on a **later local day**, at most 90 days after that first one.

"Seen" is a completed consultation throughout (the dashboard's existing definition), so retention's patients equal the
patients seen.

## Previous-period comparison

The headline figures (patients seen, consultations, no-show rate, average wait, lab tests released, lab turnaround,
specimen rejection rate, retention rate and — with billing reporting — invoiced and collected) are computed again for
the previous period of equal length ending the day before the range (`previous`), and returned in `comparison` with
`current`, `previous`, the absolute change (rates as a fraction: 0.05 = 5 percentage points), the relative change
(not for rates, nor from zero), the direction and an assessment against the figure's direction of improvement
(`better`: up for volumes, collections and retention; down for no-shows, waiting, turnaround and rejections). A
suppressed or missing value on either side gives no change. The staff app shows it as arrow + words + colour, e.g.
"↑ +5.0 points vs previous period (worse)". `?compare=false` skips the second read.

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
  it `billing` is `null`, `withheld` is `["billing"]`, billing is not queried, the daily `invoiced`/`collected` are
  `null`, revenue is left out of the comparison and revenue CSV sections are refused (403). org_admin holds it.
- **Audit:** every view is recorded (`management.dashboard.view`, with the range, facilities, `withheld`, whether it was
  compared, `format` (`json` or `csv`) and the CSV `section`). A refused revenue export is not recorded as a view.
- **Performance:** partial indexes on the time columns the queries filter (migrations `0059` and `0063`: specimens by
  collection, first result versions by entry, started teleconsultations, recorded dental procedures). The dashboard
  reads the transactional tables directly (twice when compared); if volumes grow, materialized daily aggregates are the
  next step.

## API

- `GET /api/v1/management/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&facilityId=&compare=true|false` → figures, `daily`,
  `comparison`, `previous`, `retention`, `telemedicine`, `suppressionThreshold`, `withheld`, `definitions`, the
  facilities the caller may choose (`facilities`) and whether the whole organization is available
  (`wholeOrganization`). 400 for an unusable range, 403 outside the caller's facilities, 404 for an unknown facility.
- `GET /api/v1/management/dashboard.csv?section=…` (same filters) → one table as `text/csv` (attachment
  `management-<section>-<from>-to-<to>.csv`) after a short header block (period, comparison period, facilities, privacy
  and revenue notes). Sections: `summary` (compared figures), `daily`, `providers`, `laboratory`, `lab-tests`,
  `lab-instruments`, `dental-procedures`, `telemedicine`, `retention`, and — with billing reporting — `revenue`,
  `revenue-by-category`, `collections`, `services`. Suppression applies; text cells a spreadsheet would read as a
  formula (starting with `=`, `+`, `-`, `@`, tab or carriage return; plain numbers excepted) are prefixed with `'`.
  Amounts in pesos with two decimals, rates in percent with one.

## Staff app

`/management` (navigation _Management_, shown with `management.dashboard.read`): range and facility filters with quick
ranges; key figures, each with its previous-period change (arrow, words and colour — never colour alone) and "How is
this calculated?"; two daily charts — activity (consultations and lab releases) and revenue (pesos, only when not
withheld), never on one axis — each with a legend and a table view (`DailySeriesChart` in `@healthcare/ui/healthcare`);
tables of top services, revenue by category and payment method, providers with utilization, laboratory tests and
instruments, dental procedure codes, online consultations and retention; a CSV link on each. Downloads go through the
`/management/export` route handler, which proxies the API with the user's session (the token never reaches the browser).
Without billing reporting a note replaces the revenue figures.

## Not yet

PDF export, per-department laboratory figures, median/percentile waiting and turnaround times, inventory and dispensing
figures, telemedicine waiting times, and scheduled management reports.
