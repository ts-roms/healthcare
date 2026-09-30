# Patient 360 workspace

## Purpose

The doctor's one-screen view of a patient (CLAUDE.md §29 and §39): patient → current consultation → alerts → problems,
medicines, care plans → laboratory results and trends → history, images and documents. Staff open it at
`/patients/[id]/360`.

Patient 360 is a **read model composed in the API** from each domain's small read query, like the timeline
([patient-timeline.md](patient-timeline.md)) and the FHIR record. It owns no tables and changes nothing: every edit stays
in the screen that owns it (encounter workspace, laboratory, dental record, care plan), which the workspace links to.
It is not patient-facing (MyHealth has its own released-only screens).

The page reads four API resources in parallel, each already gated and audited:

| Resource                               | What the workspace takes from it                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /patients/:id/summary`            | Allergies (with review status), problem list (active; chronic first), latest vitals, active prescriptions (with prescriber name), open care plans with open activities |
| `GET /patients/:id/workspace`          | What no other endpoint exposes: the consultation in progress and today's visit, recent consultations with diagnoses, alerts, open orders, images and documents         |
| `GET /laboratory/patients/:id/results` | Released results (latest per test, flags, reference ranges) and same-test trends; the table's **Trend** button reads `GET /laboratory/patients/:id/trends`             |
| `GET /patients/:id/timeline?limit=8`   | The latest entries of the timeline, with withheld kinds named                                                                                                          |

## Entities

None. `GET /patients/:id/workspace` returns (`apps/api/src/app/patient-360/patient-workspace.service.ts`):

| Field              | Content                                                                                                                                                                                                                                                                                                           | Never                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `facility`         | The selected facility (`{ id, name }` or null) and `timeZone` (its zone, else Asia/Manila)                                                                                                                                                                                                                        |                                                |
| `currentEncounter` | `encounters`: consultations in progress at any facility (≤ 5), the viewer's at the selected facility first, with visit type, clinician, facility, `mine`, `atSelectedFacility`, `hasNoteDraft` and diagnoses; `visit`: today's queue visit at the selected facility (not ended), if the viewer may read the queue | Note content, chief complaint                  |
| `encounterHistory` | The latest 5 consultations (in progress or signed; entered in error left out) with visit type, clinician, facility and diagnoses (code, display, rank, certainty, chronic)                                                                                                                                        | Notes, complaints, diagnosis notes             |
| `criticalResults`  | Critical results not yet acknowledged (`open` or `communicated`), oldest first (≤ 10): test, order number, facility, raised at                                                                                                                                                                                    | The value                                      |
| `labOrders`        | Open (active) laboratory orders, latest first (≤ 10): number, priority, ordered at, encounter, each test's name and status                                                                                                                                                                                        | Clinical indication, notes                     |
| `dentalImages`     | The latest 8 radiographs and photos (not entered in error): kind, date taken, teeth, facility                                                                                                                                                                                                                     | Notes; the file (opened through a signed link) |
| `documents`        | The latest 8 documents staff uploaded (available, not domain-managed), without those listed as dental images: category, title, uploaded at                                                                                                                                                                        | The file (opened through a signed link)        |
| `withheld`         | Panels the caller may not read (their field is null); never counted                                                                                                                                                                                                                                               |                                                |

## Commands

None. Starting a consultation from today's visit uses the clinic's existing `POST /encounters` (the queue's **Start
consultation** button); an online visit opens Telemedicine instead.

## Queries

- `ClinicQueries.workspaceEncounters` and `workspaceActiveVisit` (`libs/clinic`)
- `LabRecordQueries.unacknowledgedCriticalAlerts` and `openOrders` (`libs/laboratory`)
- `DentalRecordQueries.workspaceImages` (`libs/dental`)
- `DocumentRecordQueries.recentForPatient` (`libs/documents`)
- The summary also asks `ClinicQueries.practitionerNames` for the prescribers of active prescriptions.

Each returns short display fields only and is not audited itself; the endpoint audits the view.

**Patient merge (ADR-0009).** Every read above includes the records merged into the patient (`filedAsPatient`). The
summary returns `linkedRecords` (id and number of each merged record) and its rows keep their `patientId`; the
workspace's panels carry `filedUnder` (the retired number, null for the patient's own) and `linkedRecords`. The staff
page says "Includes the records of P…" and marks rows "Filed under P…" in text; the 360 page of a retired record
redirects to its survivor's.

## Events

None published or consumed.

## Permissions

The endpoint needs `patient.read`; each panel needs the owning domain's read permission (`workspace.rules.ts`), the same
that gates the domain's own reads:

| Panel               | Permission                                                | Default roles                                                           |
| ------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `current_encounter` | `encounter.read` (today's visit also `clinic.queue.read`) | physician, nurse, dentist, dental_assistant, records_officer, org_admin |
| `encounter_history` | `encounter.read`                                          | as above                                                                |
| `critical_results`  | `lab.result.read`                                         | as above, plus medical_technologist and pathologist                     |
| `lab_orders`        | `lab.order.read`                                          | as `critical_results`, plus phlebotomist                                |
| `dental_images`     | `dental.imaging.read`                                     | dentist, dental_assistant, org_admin                                    |
| `documents`         | `document.read`                                           | physician, nurse, dentist, dental_assistant, records_officer, org_admin |
| `immunizations`     | `immunization.read`                                       | physician, nurse, dentist, records_officer, org_admin                   |

On the page, the summary panels need `patient.read` + `clinical.read` (prescriptions also `prescription.read`, care plans
`care-plan.read`) and laboratory results `lab.result.read` (`lib/patient-workspace.ts` → `workspaceAccess`). A withheld
panel shows "Not available to you." — never an empty list. No permission was added. The `immunizations` panel (migration
`0081`, [immunizations](immunizations.md)) lists the latest 8 records not in error: vaccine, dose as recorded, date at
its precision, given / not given, source and whether a reaction is recorded — never notes or reasons.

## API

`GET /api/v1/patients/{patientId}/workspace` (OpenAPI tag `patients`). Unknown or other-organization patients answer 404.
One `patient.workspace.view` audit per request with the panels shown and withheld and their counts — no content.

`GET /api/v1/patients/{patientId}/summary` now also returns `prescriberName` on each active prescription.

## Database relationships

No tables and no migration: the queries use existing indexes (encounter, diagnosis, laboratory, dental image and document
indexes by patient; migration `0058` for the timeline).

## Integration points

- Staff app: `/patients/[id]/360` (`apps/staff/src/app/(staff)/patients/[id]/360`), linked from the patient record, search
  results (**360**), the queue ticket and the encounter workspace header. Presentation rules (allergy wording, masked
  PhilHealth PIN, alerts, most relevant tests) in `apps/staff/src/lib/patient-workspace.ts`.
- `/preview/patient-360` stays a labelled design demo on fixtures and points to the real workspace.

## Open questions / assumptions

- "Current consultation" lists every consultation in progress for the patient (any facility), because a patient may be
  seen at another facility at the same time; the viewer's at the selected facility comes first.
- Alerts are derived on the page from the data above (critical results awaiting acknowledgement, chronic problems,
  refused or withdrawn treatment/data-processing/telemedicine consent, no MyHealth consent, record status). They are
  information, not decision support; no clinical rule is encoded.
- The inline trends plot one test's released values; the table's **Trend** button shows the laboratory's trend, which
  lines up equivalent tests (LOINC).
