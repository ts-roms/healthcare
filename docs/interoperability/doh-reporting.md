# DOH reporting — adapter stubs

| Item            | Value                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| External system | Department of Health reporting (disease surveillance case reports)                                      |
| Specification   | **Not obtained.** No reporting system, message format, transport, code lists or deadlines are modelled  |
| Status          | **Dependency** — detection, review, a format-neutral case package, the port and an unconfigured adapter |
| Code            | `libs/interoperability/src/lib/doh`, `apps/api/src/app/adapters/doh-adapters.ts`, staff `/reporting`    |
| Migration       | `0023_doh_reporting.sql`, `0045_doh_rescan.sql`                                                         |

Root `CLAUDE.md` §36: never invent government APIs, regulatory requirements or rules. Which diseases are notifiable,
their case definitions, reporting timelines and the official forms or systems come from DOH issuances; none of them are
encoded here. The organization configures what it reports, and staff report through DOH's own channel until an adapter
exists.

## What exists

- **Reportable-condition rules** (`doh_reportable_rule`) — the organization's own configuration: an ICD-10 code or
  prefix (`A9` covers A90–A99, `A91` covers A91 and A91.x) → a category in its own wording, with a note of the source it
  took it from. Nothing is reportable until configured. Rules are not edited: deactivate and add (case reports keep the
  rule they matched). Coding-system keys `icd-10` and `icd10` are both treated as ICD-10.
- **Detection** — on `DiagnosisRecorded` (outbox, idempotent), a coded diagnosis matching an active rule (longest prefix
  wins) opens a **case report** (`doh_case_report`, one per diagnosis) in `pending_review`. Diagnoses recorded before a
  rule was added are not reached by detection; staff check them on request (below).
- **Checking earlier diagnoses** (`doh_rescan`, staff with `doh.settings.manage`) — an explicit, audited request to
  check the organization's coded diagnoses recorded within a date range (calendar dates in the time zone of the facility the requester works in — `facility.timezone`, Asia/Manila without a
  selected facility — both included,
  at most **90 days**, not in the future) against the rules active when the check runs. The API runs it in the
  background (`DohRescans`, polled every 15 s and started at once in the requesting instance): diagnoses are read in
  pages of 500 through the `DohCaseSources` port (`ClinicQueries.codedDiagnosesRecorded`, in `(recorded_at, id)` order,
  entered-in-error excluded), and each match goes through the same detection, so a diagnosis never gets a second case
  report — re-running a range, or overlapping ranges, only opens what is missing. One check at a time per organization;
  progress (counts and the cursor) is saved per page, so a check interrupted by a restart resumes where it stopped
  (after 5 minutes without a heartbeat; failed after 3 runs). The check records how many coded diagnoses it read
  (`scanned`), how many matched a rule (`matched`) and how many case reports it opened (`opened`, counted from the case
  reports carrying its `rescan_id`; matches that already had one are not counted). Requires at least one active rule.
- **Review** (staff with `doh.report.manage`):
  - **Record as reported** — reported through DOH's own channel; the reference it gave is recorded.
  - **Dismiss** — not reportable after review; a reason is required.
  - **Submit** — refused (`integration_not_configured`) while the gateway is a dependency; with an adapter, queued for
    the integration worker.
  - Allowed from `pending_review`, `rejected` or `failed`; optimistic locking (`version`).
- **Case package** (`platform-case-1`) — the platform's own, format-neutral summary: category, facility (with its DOH
  health facility code), patient identity, address and contact number, the diagnosis (ICD-10, certainty, when recorded),
  the consultation (date, clinician, in person or online). Not an official DOH form.
- **Readiness checks** — of the platform's data only: the diagnosis stands (not entered in error or refuted), the
  facility code is recorded, the patient's city/municipality is recorded.
- **Gateway port** — `DohReportingGateway.submitCaseReport(package, idempotencyKey)`; the default
  `UnconfiguredDohReportingGateway` has status `dependency` and transmits nothing. `DohCaseReportHandler` runs it in
  `apps/integration-worker` ([../architecture/integration-worker.md](../architecture/integration-worker.md)); the
  outcome returns through `IntegrationExchangeCompleted` and updates the case report (`reported` via adapter with the
  reference, `rejected`, or `failed`).
- **Facility code** (`doh_facility_setting`) — each facility's DOH health facility code as issued, recorded by staff,
  versioned and audited; not verified with DOH.

### Reporting deadlines (the organization's own)

A rule may carry "report within N days of the diagnosis" (`report_within_days`, optional, migration `0073`). A case
report opened from it gets `due_at` (the diagnosis time plus the days, kept if the rule changes) and is **overdue** while
still pending review, queued, failed or rejected past it. No DOH deadline is suggested by the platform.

## API

| Request                                                                          | Permission            |
| -------------------------------------------------------------------------------- | --------------------- |
| `GET /api/v1/doh/integration`                                                    | `doh.report.manage`   |
| `GET /api/v1/doh/rules`                                                          | `doh.report.manage`   |
| `POST /api/v1/doh/rules`, `POST …/rules/{id}/deactivate`                         | `doh.settings.manage` |
| `GET, PUT /api/v1/doh/facilities/{id}/facility-code`                             | `doh.settings.manage` |
| `POST /api/v1/doh/rescans` (`{ from, to }`, 202)                                 | `doh.settings.manage` |
| `GET /api/v1/doh/rescans` (`{ timeZone, today, rescans }`), `GET …/rescans/{id}` | `doh.settings.manage` |
| `GET /api/v1/doh/case-reports[?status=]`, `GET …/{id}`                           | `doh.report.manage`   |
| `POST …/{id}/reported`, `…/dismiss`, `…/submissions`                             | `doh.report.manage`   |

Roles: `org_admin` (both), `physician` and `records_officer` (`doh.report.manage`). Audit: `doh.case.detected`
(system), `doh.case.list`, `doh.case.view`, `doh.case.reported`, `doh.case.dismissed` (with the reason),
`doh.case.submit-request`, `doh.case.outcome` (system), `doh.rule.create`, `doh.rule.deactivate`,
`doh.facility-code.record`, `doh.rescan.request` (range, number of active rules), `doh.rescan.completed` and
`doh.rescan.failed` (system, with the counts). Case reports opened by a check audit `doh.case.detected` with its
`rescanId`. Errors: `rescan_range` (reversed, future or longer than 90 days), `no_active_rules`, `rescan_in_progress`
(409).

## Screens

Staff **Disease reporting** (`/reporting`): case reports, those to review first, filterable by status; one case
(`/reporting/{id}`) with the prepared report, the checklist, and the decision (reference from DOH's channel, dismiss with
a reason; submit only when an adapter is connected). Case reports opened by a check of earlier diagnoses carry an
"Earlier diagnosis" badge in the list and on the case. **Reportable conditions** (`/reporting/settings`): rules and the
selected facility's DOH health facility code, and **Check earlier diagnoses** (a date range in the facility's time
zone, the recent checks with their status and counts; the page refreshes itself every 5 s while one waits or runs).

## Not modelled (integration dependencies)

- The official notifiable-disease list, categories and case definitions (configured by the organization, not shipped).
- Reporting deadlines and escalation (e.g. immediate vs weekly reporting) — would come with the specification.
- Aggregate/statistical reporting (e.g. periodic facility reports) — no specification on record.
- Laboratory-confirmed case triggers (only recorded diagnoses open case reports today).
- Patient follow-up by public health units.

## To implement a real adapter

1. Record the specification (system, version, contact) in [dependencies.md](dependencies.md).
2. Implement `DohReportingGateway` (map `DohCasePackage` to the official format; credentials from secrets
   management; idempotent per key) and provide it to the API (`DohReportingModule` `gateway`) and the worker
   (`IntegrationWorkerModule` `dohGateway`).
3. Add what the specification requires beyond the package (e.g. onset date, case classification) as clinical data first —
   never as guesses in the adapter.
