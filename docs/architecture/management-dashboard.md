# Management dashboard

Operational figures across the platform's domains for a range of days (CLAUDE.md §28, _Management_): patient volume,
appointments and no-shows, waiting time, provider utilization, laboratory volume and turnaround, dental procedures,
revenue, collections and services. It is an **operational** view for the organization's managers — not an official,
DOH or BIR report, and nothing on it names a patient.

## Composition

Like the patient timeline, the dashboard is a cross-domain read model composed in the API
(`apps/api/src/app/management-dashboard`). Each domain counts its own rows in its own library, over the same window
(`ReportingWindow` in `libs/core`: an instant range, the facilities, the time zone for local days):

| Domain     | Query                                   | Figures                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patient    | `PatientReportingQueries.registrations` | Patients registered (by registration facility; merged records left out), per day                                                                                                                                                                                                                                                                                      |
| Clinic     | `ClinicReportingQueries.figures`        | Appointments by start (booked = not cancelled, completed, no-show, cancelled, booked by the patient; no-show rate = no-shows / booked); check-ins (walk-ins, left without being seen, average check-in-to-consultation wait); completed encounters (online, patients seen, returning — seen before the range anywhere in the organization); per practitioner; per day |
| Laboratory | `LabReportingQueries.figures`           | Orders (STAT, cancelled) and tests ordered by order time; first releases (a result's version 1) with the average collection-to-release time and the share that met the test's own turnaround target; corrections released; specimens rejected; the ten most ordered tests; per day                                                                                    |
| Dental     | `DentalReportingQueries.figures`        | Procedures recorded (not entered in error) and patients treated                                                                                                                                                                                                                                                                                                       |
| Billing    | `BillingReportingQueries.figures`       | Invoices issued in the range and still valid (gross, discounts, net, payer and patient shares), voids, credit and debit notes, payments and refunds by method, net by service category, the ten services with the most net revenue; invoiced and collected per day (centavos)                                                                                         |

The API adds the returning-patient rate and one row per day of the range (zeros filled in).

## Rules

- **Range:** local days, inclusive, at most 366; the last 30 days by default. Days are read in the facility's time zone
  (one facility filtered), else the request's facility's, else Asia/Manila.
- **Scope:** `management.dashboard.read` (org_admin; migration `0059`). An organization-wide grant covers every facility
  and the whole-organization view; a grant through a facility role covers only that facility (another facility is
  refused with 403, and without a facility filter the figures cover the granted facilities only).
- **Audit:** every view is recorded (`management.dashboard.view`, with the range and facilities).
- **Performance:** partial indexes on the time columns the queries filter (migration `0059`). The dashboard reads the
  transactional tables directly; if volumes grow, materialized daily aggregates are the next step.

## API

`GET /api/v1/management/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&facilityId=` → figures, `daily`, the facilities the caller
may choose (`facilities`) and whether the whole organization is available (`wholeOrganization`). 400 for an unusable
range, 403 outside the caller's facilities, 404 for an unknown facility.

## Staff app

`/management` (navigation _Management_, shown with `management.dashboard.read`): range and facility filters with quick
ranges, eight key figures, two daily charts — activity (counts) and revenue (pesos), never on one axis — each with a
legend and a table view (`DailySeriesChart` in `@healthcare/ui/healthcare`; colours validated for colour-vision
deficiency and contrast in light and dark), and tables of top services, revenue by category and payment method,
providers and laboratory tests.

## Not yet

Comparisons with the previous period, exports (CSV/PDF), per-department laboratory figures, inventory and dispensing
figures, telemedicine waiting times, and scheduled management reports.
