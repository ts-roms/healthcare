# Patient timeline (Patient 360)

## Purpose

One chronological view of a patient's record for staff (CLAUDE.md §6 and §39): appointments, consultations (in person
and online), vital signs, prescriptions, laboratory orders and result releases, dental work, care plans, invoices and
payments, communications, imported history and documents — newest first, each entry linking to the screen that holds
the record.

The timeline is a **read model composed in the API** (`apps/api/src/app/patient-timeline`), like the Patient 360
summary and workspace ([patient-360.md](patient-360.md)) and the FHIR record. It owns no tables and changes nothing. It is not a copy of the record: each row is a short,
non-sensitive summary (ids, times, statuses, codes, names), and the linked screen — with its own permission check and
audit — shows the rest. It is not a patient-facing view (MyHealth has its own released-only screens).

## Entities

None. Every entry has one shape:

| Field        | Meaning                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `id`         | `{source}:{uuid}` — unique across kinds (a source is one kind of row, e.g. `dental_procedure`)                              |
| `kind`       | See below                                                                                                                   |
| `occurredAt` | ISO 8601 instant, UTC, microseconds (as PostgreSQL stores it)                                                               |
| `facility`   | `{ id, name }`, or null for organization-level records (care plans, communications, imported history)                       |
| `title`      | Short text, e.g. "Results released: FBS (1 test)"                                                                           |
| `detail`     | Short text or null, e.g. "Dr. Reyes · Diagnoses: E11.9"                                                                     |
| `status`     | The source record's status code (`completed`, `entered_in_error`, `void`, …)                                                |
| `marker`     | `entered_in_error`, `cancelled` or `void` when the record is not valid care: still listed (history), marked, never as valid |
| `flag`       | Laboratory releases only: `abnormal` / `critical` if any released result was flagged                                        |
| `link`       | `{ type, id }` of the screen to open (`encounter`, `appointment`, `telemedicine`, `patient_laboratory`, `dental_record`, …) |
| `filedUnder` | The patient number of a record merged into this patient that the entry is filed under; null for the patient's own entries   |
| `sourceIds`  | The underlying ids (e.g. `prescriptionId`, `encounterId`)                                                                   |

### Kinds, what a row shows and what it never shows

| Kind                 | Rows (when)                                                                             | Shows                                                                                                | Never                                                          |
| -------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `appointment`        | Appointment (scheduled start); cancelled and no-show included                           | Visit type, practitioner, online, booked by the patient, status                                      | Reason for visit, cancellation reason, staff notes             |
| `encounter`          | Encounter, in person or telemedicine (start); entered in error included                 | Visit type, practitioner, diagnosis **codes** (and a count of uncoded ones), status                  | Chief complaint, SOAP notes, diagnosis text or notes           |
| `referral`           | Referral (issued); cancelled included                                                   | Number, specialty, the practitioner or outside provider, urgency, status                             | Reason, clinical summary, outcome notes                        |
| `vitals`             | Vital sign set (measured)                                                               | That vitals were recorded, status                                                                    | Any value                                                      |
| `prescription`       | Prescription (issued); cancelled and superseded included                                | Number, generic names (up to 3), status                                                              | Doses, instructions, notes, override reasons                   |
| `lab_order`          | Laboratory order (ordered); cancelled included                                          | Number, test names, priority, status                                                                 | Clinical indication, notes                                     |
| `lab_result_release` | One release of an order's results (the versions one person released in the same second) | Test names and count, correction or not, abnormal/critical flag, `superseded` if all corrected later | Values, units, ranges, comments                                |
| `dental`             | Examination (recorded), procedure (performed), treatment plan decision (decided)        | Procedure name and code, plan title, status (entered in error included)                              | Notes, findings, teeth                                         |
| `care_plan`          | Care plan (created); completed activity (completed)                                     | Plan title and category, activity kind, current status                                               | Description, goals, activity text, progress notes              |
| `invoice`            | Issued invoice (issued); voided invoices stay, marked                                   | Number, net total, status                                                                            | Items, discounts evidence, notes                               |
| `payment`            | Payment or refund (recorded)                                                            | Amount, method, receipt number, invoice number                                                       | References, refund reasons                                     |
| `communication`      | Notification to the patient (requested); suppressed ones included                       | Channel, template, category, delivery status                                                         | Message body, variables, destination                           |
| `external_history`   | Imported history entry (accepted), labelled "(external record)"                         | Kind, code, declared source                                                                          | Display text, values, the other provider's free-text dates     |
| `document`           | Uploaded document (upload verified)                                                     | Category                                                                                             | Title, file name (free text); generated and archived documents |
| `immunization`       | Dose given, not given, reported or imported (at the time given, else when recorded)     | Vaccine name, dose as recorded, date given when partial, status (entered in error marked), source    | Notes, the not-given reason text, reactions, lot               |

The status history of care plans is not stored, so a plan appears once (when created) with its current status. Draft
invoices are not part of the record until issued. Telemedicine consultations are encounters (`modality`), and online
appointments open the teleconsultation screen.

## Commands

None.

## Queries

- `GET /api/v1/patients/{id}/timeline` — `PatientTimelineService` (API). Each domain exports a small timeline query that
  returns at most one page (plus one) of its own rows within the page window: `ClinicQueries.timelineAppointments |
Encounters | Vitals | ExternalHistory`, `PrescriptionService.timeline`, `LabRecordQueries.timelineOrders | Releases`,
  `DentalRecordQueries.timelineExaminations | Procedures | PlanDecisions`, `CarePlanService.timelinePlans |
CompletedActivities`, `BillingRecordQueries.timelineInvoices | Payments`, `NotificationService.timelineForPatient`,
  `DocumentRecordQueries.timeline`. The shared window and cursor predicate are in `libs/core`
  (`TimelineWindow`, `timelineRange`).

## Events

None published or consumed.

## Permissions

The route needs `patient.read`. Each kind is included only if the caller holds the permission that gates that domain's
own reads; otherwise it is left out and listed in `withheld` (no counts are revealed). No new permission was added.

| Kind                         | Permission            |
| ---------------------------- | --------------------- |
| `appointment`                | `appointment.read`    |
| `encounter`, `referral`      | `encounter.read`      |
| `vitals`, `external_history` | `clinical.read`       |
| `prescription`               | `prescription.read`   |
| `lab_order`                  | `lab.order.read`      |
| `lab_result_release`         | `lab.result.read`     |
| `dental`                     | `dental.record.read`  |
| `care_plan`                  | `care-plan.read`      |
| `invoice`, `payment`         | `billing.charge.read` |
| `communication`              | `notification.read`   |
| `document`                   | `document.read`       |
| `immunization`               | `immunization.read`   |

For example a cashier sees invoices and payments only; a medical technologist sees laboratory orders and releases only;
a physician sees everything but billing. Permissions are the caller's effective permissions for the request's facility
context, as everywhere else.

Each request records one audit event `patient.timeline.view` (`AuditService.recordStandalone`) with the patient, the
filters, the number of entries per kind on the page and the withheld kinds — never titles or other content.

## API

`GET /api/v1/patients/{id}/timeline`

| Parameter    | Meaning                                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kinds`      | Comma-separated kinds (default: all the caller may see)                                                                                                                    |
| `from`, `to` | Local dates (inclusive), in the filtered facility's time zone, else the request's facility (`X-Facility-Id`), else Manila                                                  |
| `facilityId` | Only records of this facility of the organization (organization-level records — care plans, communications, imported history — are then left out); default: every facility |
| `cursor`     | `nextCursor` of the previous page                                                                                                                                          |
| `limit`      | Page size, 1–100, default 50                                                                                                                                               |

Response: `{ items, nextCursor, withheld, timeZone }`. A patient of another organization is `404`; an unknown facility
`404`; a malformed cursor `400 invalid_cursor`; `from` after `to` `400 invalid_date_range`.

**Ordering and paging.** Entries are ordered by (`occurredAt`, source, id), all descending — a total order, so paging
never repeats or skips an entry even when many share a timestamp. Instants keep PostgreSQL's microseconds (as text), so
the cursor bound is exact. Each source query is bounded by the cursor and returns `limit + 1` rows; the API merges them,
trims to `limit` and returns the last entry's position as the opaque `nextCursor` (base64url; validated before use).
Future appointments appear at the top (newest first by scheduled time).

**Patient merge.** Each domain's timeline query reads the rows filed as this patient (`filedAsPatient`, ADR-0009): the
patient's own and those of every record merged into it, returning each row's `patientId`; the service maps a row
filed under a merged record to its number (`filedUnder`). The staff app shows it after the details ("Filed under P…")
and opens the survivor's timeline for a retired record.

## Database relationships

Reads only. Migration `0058_patient_timeline.sql` adds indexes for the per-patient, newest-first page queries that had
none: payments by patient, issued invoices by patient, all care plans by patient, completed care plan activities by
patient, released laboratory result versions by patient.

## Integration points

- Staff app: `/patients/[id]/timeline` and the patient record's **Recent activity** card (see
  `docs/architecture/staff-app.md`); the design-system component is `RecordTimeline` (`libs/ui`). The demo
  `PatientTimeline` component and `/preview/patient-360` remain demo-only.
- No external interface. The FHIR `$everything` operation is the machine-readable export of the same record.

## Open questions / assumptions

- **Facility visibility.** Staff access is organization-wide with facility-scoped grants; the timeline covers every
  facility of the organization by default, like the patient record and the FHIR record. Restricting records by the
  facilities a user works at would be a platform-wide policy, not a timeline rule.
- **Release grouping.** A laboratory release is identified by order, releaser and second; two separate releases of the
  same order by the same person within one second would show as one entry.
- **Not yet listed:** allergies (recorded/reviewed), consents, queue visits and triage assessments, specimen events,
  critical-value communication, dental images and periodontal charts, credit/debit notes, deposits, PhilHealth claims and
  eligibility answers, case reports, dispensing. Each can be added as another small read query and kind.
- Status changes over time (e.g. care plan completed, appointment confirmed) are shown only as the current status; a
  status history would need the domains to keep one.
