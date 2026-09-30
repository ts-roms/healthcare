# Patient timeline (Patient 360)

## Purpose

One chronological view of a patient's record for staff (CLAUDE.md §6 and §39): appointments, queue visits and triage,
consultations (in person and online), referrals, medical certificates, vital signs, allergies, consents, prescriptions
and dispensing, laboratory orders, specimens, result releases and critical-value communication, dental work and images,
care plans, invoices, payments, credit and debit notes, deposits, PhilHealth claims and answers, DOH case reports,
communications, imported history, documents, immunizations and records requests — newest first, each entry linking to
the screen that holds the record.

The timeline is a **read model composed in the API** (`apps/api/src/app/patient-timeline`), like the Patient 360
summary and workspace ([patient-360.md](patient-360.md)) and the FHIR record. It owns no tables and changes nothing. It is not a copy of the record: each row is a short,
non-sensitive summary (ids, times, statuses, codes, names), and the linked screen — with its own permission check and
audit — shows the rest. It is not a patient-facing view (MyHealth has its own released-only screens).

## Entities

None. Every entry has one shape:

| Field        | Meaning                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`         | `{source}:{uuid}` — unique across kinds (a source is one kind of row, e.g. `dental_procedure`)                                 |
| `kind`       | See below                                                                                                                      |
| `occurredAt` | ISO 8601 instant, UTC, microseconds (as PostgreSQL stores it)                                                                  |
| `facility`   | `{ id, name }`, or null for organization-level records (care plans, allergies, consents, communications, imported history…)    |
| `title`      | Short text, e.g. "Results released: FBS (1 test)"                                                                              |
| `detail`     | Short text or null, e.g. "Dr. Reyes · Diagnoses: E11.9"                                                                        |
| `status`     | The source record's status code (`completed`, `entered_in_error`, `void`, …)                                                   |
| `marker`     | `entered_in_error`, `cancelled` or `void` when the record is not valid care: still listed (history), marked, never as valid    |
| `flag`       | Laboratory releases only: `abnormal` / `critical` if any released result was flagged                                           |
| `link`       | `{ type, id }` of the screen to open (`encounter`, `appointment`, `patient_laboratory`, `billing_account`, `records_request`…) |
| `filedUnder` | The patient number of a record merged into this patient that the entry is filed under; null for the patient's own entries      |
| `sourceIds`  | The underlying ids (e.g. `prescriptionId`, `encounterId`)                                                                      |

### Kinds, what a row shows and what it never shows

| Kind                     | Rows (when)                                                                                                                       | Shows                                                                                                    | Never                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `appointment`            | Appointment (scheduled start); cancelled and no-show included                                                                     | Visit type, practitioner, online, booked by the patient, status                                          | Reason for visit, cancellation reason, staff notes                            |
| `queue_visit`            | Queue visit (checked in); cancelled and left-without-being-seen included                                                          | Visit type, queue number, walk-in or appointment, checked in online, priority, status                    | Chief complaint, where the patient was called to, why the visit was closed    |
| `triage`                 | Triage assessment (assessed); entered in error included                                                                           | That triage was recorded, the priority given, status                                                     | Chief complaint, pain score, risk flags, notes, vital values (see `vitals`)   |
| `encounter`              | Encounter, in person or telemedicine (start); entered in error included                                                           | Visit type, practitioner, diagnosis **codes** (and a count of uncoded ones), status                      | Chief complaint, SOAP notes, diagnosis text or notes                          |
| `referral`               | Referral (issued); cancelled included                                                                                             | Number, specialty, the practitioner or outside provider, urgency, status                                 | Reason, clinical summary, outcome notes                                       |
| `medical_certificate`    | Medical certificate (issued); void included, marked                                                                               | Number, issuing practitioner, status                                                                     | Purpose, findings, recommendations, rest period, void reason                  |
| `vitals`                 | Vital sign set (measured)                                                                                                         | That vitals were recorded, status                                                                        | Any value                                                                     |
| `allergy`                | Allergy (recorded, or accepted from an import, labelled "(external record)"); allergy review (reviewed)                           | Substance, category, high criticality, confirmed or not, current status; "no known allergies" on reviews | Reaction, severity, status reason                                             |
| `consent`                | Consent decision (took effect)                                                                                                    | Consent type, granted/refused/withdrawn, how captured, recorded by the patient in MyHealth               | Notes, the wording read, the scanned form                                     |
| `prescription`           | Prescription (issued); cancelled and superseded included                                                                          | Number, generic names (up to 3), status                                                                  | Doses, instructions, notes, override reasons                                  |
| `dispense`               | Item dispensed (dispensed) and, for a mistaken dispense, its reversal (reversed)                                                  | Stock item name, quantity and unit, prescription number, `recorded`/`reversed`                           | Dispensing note, reversal reason, lots                                        |
| `lab_order`              | Laboratory order (ordered); cancelled included                                                                                    | Number, test names, priority, status                                                                     | Clinical indication, notes                                                    |
| `specimen`               | Specimen collected, received, rejected (each event when it happened)                                                              | Specimen type, accession number, the tests on it, order number, "Recollection requested"                 | Rejection reason (free text), who handled it                                  |
| `lab_result_release`     | One release of an order's results (the versions one person released in the same second)                                           | Test names and count, correction or not, abnormal/critical flag, `superseded` if all corrected later     | Values, units, ranges, comments                                               |
| `critical_value`         | Critical result communicated (to whom, when) and acknowledged by the care team (when)                                             | Test name, communicated to (name or role as recorded), method, read back, the alert's status             | The value, flag detail, communication note                                    |
| `dental`                 | Examination (recorded), procedure (performed), treatment plan decision (decided), periodontal chart (recorded)                    | Procedure name and code, plan title, status (entered in error included)                                  | Notes, findings, teeth, measurements                                          |
| `dental_imaging`         | Dental image (recorded); image shared with the patient in MyHealth (shared)                                                       | Kind of image, day taken, status (entered in error included), sharing withdrawn later                    | Teeth, notes, the file, withdrawal reason                                     |
| `care_plan`              | Care plan (created); completed activity (completed)                                                                               | Plan title and category, activity kind, current status                                                   | Description, goals, activity text, progress notes                             |
| `invoice`                | Issued invoice (issued); voided invoices stay, marked                                                                             | Number, net total, status                                                                                | Items, discounts evidence, notes                                              |
| `payment`                | Payment or refund (recorded)                                                                                                      | Amount, method, receipt number, invoice number                                                           | References, refund reasons                                                    |
| `billing_note`           | Credit note, debit note (issued)                                                                                                  | Number, amount, invoice number                                                                           | Reason, lines                                                                 |
| `deposit`                | Deposit and credit account entry (recorded): deposit, applied to an invoice, released on void, refunded, moved between facilities | Kind, amount, method, receipt number, invoice number                                                     | References, refund reasons; credit from a credit note (the note is its entry) |
| `philhealth_claim`       | eClaims submission for an invoice (requested)                                                                                     | Exchange status, PhilHealth's reference                                                                  | Payload, errors, outcome detail                                               |
| `philhealth_eligibility` | Eligibility answer or inquiry (recorded); YAKAP registration answer (recorded)                                                    | Date of service, status as PhilHealth answered, effective date, PhilHealth's reference                   | Notes, outcome detail                                                         |
| `doh_case_report`        | Case report opened for review (detected); its latest review — reported, dismissed or submitted (reviewed)                         | The organization's category label, current status                                                        | Diagnosis code and text (see `encounter`), reason, DOH's reference            |
| `communication`          | Notification to the patient (requested); suppressed ones included                                                                 | Channel, template, category, delivery status                                                             | Message body, variables, destination                                          |
| `external_history`       | Imported history entry (accepted), labelled "(external record)"                                                                   | Kind, code, declared source                                                                              | Display text, values, the other provider's free-text dates                    |
| `document`               | Uploaded document (upload verified)                                                                                               | Category                                                                                                 | Title, file name (free text); generated and archived documents                |
| `procedure`              | Procedure performed at the clinic (at the time performed)                                                                         | Name with quantity and site, code; entered in error marked; link to the consultation                     | Notes, the late-entry reason                                                  |
| `immunization`           | Dose given, not given, reported or imported (at the time given, else when recorded)                                               | Vaccine name, dose as recorded, date given when partial, status (entered in error marked), source        | Notes, the not-given reason text, reactions, lot                              |
| `records_request`        | Request for copies of records from MyHealth (submitted)                                                                           | Number, what was asked for (fixed scopes), status                                                        | Details, purpose, the records office's answer, what was shared                |

The patient history (past procedures and conditions, family and social history; [patient history](patient-history.md)) is
deliberately **not** a timeline kind: it describes the past as reported, often only by year, and must never carry its
sensitive parts; the history page lists it.

**Patient messaging** conversations ([patient messaging](patient-messaging.md)) are **not** a kind either: a message is
its body, which the timeline never carries, and each "a message is waiting" notice to the patient is already a
`communication` entry. Conversations are read at **Messages** (`patient.message.read`).

**Decisions on the further kinds.** A kind lists what its domain's own screen lists to the same permission, as short
display fields. Rows that are organization-level in their domain (allergies and reviews, consents, records requests,
PhilHealth claims — an exchange carries no facility) have no facility and are left out by a facility filter. Allergies,
specimens, critical alerts, DOH case reports and dispenses change status over time; like care plans, each row shows the
**current** status, and a second row marks a later step where the domain records its time (a specimen's receipt and
rejection are events of their own, a critical result's communication and acknowledgement, a case report's review, a
dispense's reversal). A rejected specimen whose tests go back to be collected again no longer names them. The
communicated-to name of a critical result is shown as recorded (a person or role, never clinical content). A reversed
dispense is shown with status `reversed` (not "entered in error": the stock movement happened and was returned). DOH case
reports show the organization's own category label only: the diagnosis code is on the consultation's entry.

The status history of care plans is not stored, so a plan appears once (when created) with its current status. Draft
invoices are not part of the record until issued. Telemedicine consultations are encounters (`modality`), and online
appointments open the teleconsultation screen.

## Commands

None.

## Queries

- `GET /api/v1/patients/{id}/timeline` — `PatientTimelineService` (API). Each domain exports a small timeline query that
  returns at most one page (plus one) of its own rows within the page window: `ClinicQueries.timelineAppointments |
Visits | Triage | Encounters | Referrals | MedicalCertificates | Vitals | Allergies | AllergyReviews | ExternalHistory`,
  `ImmunizationService.timeline`, `PatientTimelineQueries.timelineConsents | RecordsRequests` (patient),
  `PrescriptionService.timeline | timelineDispenses`, `LabRecordQueries.timelineOrders | SpecimenEvents | Releases |
CriticalAlerts`, `DentalRecordQueries.timelineExaminations | Procedures | PlanDecisions | PerioCharts | Images |
ImageShares`, `CarePlanService.timelinePlans | CompletedActivities`, `BillingRecordQueries.timelineInvoices | Payments |
CreditNotes | DebitNotes | AccountEntries`, `PhilHealthRecordQueries.timelineClaims | Eligibility | YakapRegistrations`,
  `DohRecordQueries.timelineCaseReports`, `NotificationService.timelineForPatient`, `DocumentRecordQueries.timeline`. The
  shared window and cursor predicate are in `libs/core` (`TimelineWindow`, `timelineRange`).

## Events

None published or consumed.

## Permissions

The route needs `patient.read`. Each kind is included only if the caller holds the permission that gates that domain's
own reads; otherwise it is left out and listed in `withheld` (no counts are revealed). No new permission was added.

| Kind                                                        | Permission                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `appointment`                                               | `appointment.read`                                                   |
| `queue_visit`                                               | `clinic.queue.read`                                                  |
| `encounter`, `referral`, `medical_certificate`, `procedure` | `encounter.read`                                                     |
| `vitals`, `triage`, `allergy`, `external_history`           | `clinical.read` (the allergy list's own read)                        |
| `consent`                                                   | `patient.read` (consents are read with the patient record)           |
| `prescription`, `dispense`                                  | `prescription.read`                                                  |
| `lab_order`, `specimen`                                     | `lab.order.read` (specimen events are read with it)                  |
| `lab_result_release`, `critical_value`                      | `lab.result.read` (the critical-results list's read)                 |
| `dental`                                                    | `dental.record.read`                                                 |
| `dental_imaging`                                            | `dental.imaging.read`                                                |
| `care_plan`                                                 | `care-plan.read`                                                     |
| `invoice`, `payment`, `billing_note`, `deposit`             | `billing.charge.read`                                                |
| `philhealth_claim`                                          | `philhealth.claim.submit` (the invoice's claim panel)                |
| `philhealth_eligibility`                                    | `philhealth.eligibility.manage` (the record's eligibility and YAKAP) |
| `doh_case_report`                                           | `doh.report.manage` (`/reporting`)                                   |
| `communication`                                             | `notification.read`                                                  |
| `document`                                                  | `document.read`                                                      |
| `immunization`                                              | `immunization.read`                                                  |
| `records_request`                                           | `patient.records-request.manage`                                     |

For example a cashier sees consents, billing (invoices, payments, notes and deposits) and PhilHealth claims and answers; a
medical technologist sees consents and the laboratory kinds; a physician sees everything but billing, PhilHealth, dental
images and records requests. Dispensing is gated like prescriptions (pharmacists hold `prescription.read`), not by
`prescription.dispense`, so the prescriber sees what was dispensed. Permissions are the caller's effective permissions for the request's facility
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
patient, released laboratory result versions by patient. Migration `0084_patient_timeline_kinds.sql` adds the same for
the further kinds whose tables had no index leading with the patient: every allergy (the old index covers active ones),
triage assessments, critical alerts, credit and debit notes, outbound exchanges (PhilHealth claims), DOH case reports
and dispenses. Queue visits and specimens use their `UNIQUE (patient_id, id)` keys (specimen events then the
specimen's index); consents, allergy reviews, dental images and charts, deposits, eligibility and YAKAP answers,
medical certificates and records requests already had a (patient, time) index. Checked with `EXPLAIN ANALYZE` on
200 000 visits over 20 000 patients: an index scan on the patient, a few rows sorted.

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
- **Not listed:** patient history (see above) and patient messaging conversations (bodies; the notices are
  `communication` entries). Status changes other than the steps listed above (e.g. an allergy made inactive, a records
  request fulfilled) show only as the current status.
- Status changes over time (e.g. care plan completed, appointment confirmed) are shown only as the current status; a
  status history would need the domains to keep one.
