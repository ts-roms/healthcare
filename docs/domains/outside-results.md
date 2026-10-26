# Outside results

Results from other laboratories and hospitals, filed on the patient's record as the report that came with them.

## Purpose

Patients bring results from elsewhere and providers send them. The clinic needs them on the one longitudinal record, where the clinician finds them, without pretending they are this laboratory's work. An outside result is **a report kept as received**: the uploaded file with its source, the day it was done and the tests as the report names them.

What it is **not**:

- not a laboratory result: nothing is entered, verified, approved or released, there is no reference range or abnormal flag the platform evaluated, no unit conversion, no critical-value workflow, and it never joins this laboratory's trends;
- not read by the platform: the report is not parsed, OCR'd or summarised; the clinician reads the file;
- not a send-out: send-outs (`/laboratory/send-outs`) are tests this facility referred out and whose results return into the result workflow.

## Entities

`outside_result` (migration `0128`, `libs/clinic/src/lib/outside-results`):

| Column                       | Meaning                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `patient_id`, `facility_id`  | The record it is filed under and the facility the staff member was working at                        |
| `document_id`                | The report: a private `document` of category `outside_result` for the same patient, `available` only |
| `source_name`, `source_kind` | Who performed it, as written on the report; `laboratory`, `hospital`, `clinic` or `other`            |
| `performed_on`               | The day the test was done as the report states it; never in the future (facility's time zone)        |
| `tests`                      | The tests as the report names them (free text; no code set assumed)                                  |
| `received_from`              | `patient`, `provider` or `other`                                                                     |
| `notes`                      | Staff-only                                                                                           |
| `entered_in_error_*`         | Set once with a reason; the record and its report stay                                               |

Rules enforced by the database: composite same-organization foreign keys (patient, facility, document); the trigger `outside_result_guard` allows only marking entered in error, once, and never deletes; no truncate; no filing under a merged record (`PM001` → `422 patient_merged`); one active filing per document. The new document category `outside_result` is added to `document_category_check`.

## Commands and queries

| Route                                        | Permission              | Notes                                                                                                                                              |
| -------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /patients/:id/outside-results`         | `outside-result.record` | Takes the `documentId` of an uploaded report; `document_not_of_patient`, `document_unavailable`, `performed_on_in_future`, `outside_result_exists` |
| `GET /patients/:id/outside-results`          | `outside-result.read`   | Includes records merged into the patient (`filedAsPatient`); entries in error marked; audited `outside-result.view`                                |
| `GET /outside-results/:id/download-url`      | `outside-result.read`   | Short-lived signed link; audited by the documents service (`document.download`)                                                                    |
| `POST /outside-results/:id/entered-in-error` | `outside-result.record` | Reason of at least 3 characters; once                                                                                                              |

The report is uploaded with the ordinary two-step document flow (`POST /documents` with category `outside_result` and the patient, PUT, `/complete`), so the checksum and malware scan apply and an infected file is quarantined and cannot be filed.

Roles: `org_admin`, `physician`, `nurse`, `receptionist` and `records_officer` read and file; `dentist` reads. Organizations grant more through their own roles.

## Events and audit

`OutsideResultFiled` (ids only). Audit: `outside-result.record`, `outside-result.view`, `outside-result.entered-in-error`, plus `document.download` when the report is opened.

## Staff screens

- `/patients/[id]/outside-results`: file a report (file, source, kind, day, tests, how it reached the clinic, notes) and the list with **Open report** and **Entered in error…**.
- The patient record's **Labs** tab shows the latest five under "Results from other laboratories and hospitals".

## Limits and follow-ups

- Not yet in the patient timeline, Patient 360, FHIR export, MyHealth or the copy of the record. Add each as its own change; none should present the filing as a laboratory result.
- Staff acknowledgement that a clinician reviewed the report is not recorded.
- Structured values for outside results (so a value could be seen beside trends) would need a labelled, separate store that is never merged into this laboratory's trends, as with imported FHIR history.
- Patients cannot yet send a result for the clinic to file from MyHealth; the reuse of the records office review queue is the likely design.
- The report itself may contain personal data of other people (a family member's name, a referral); retention follows the documents' category schedule (`/records/retention`), which the organization sets.
