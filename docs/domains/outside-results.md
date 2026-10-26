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
| `POST /outside-results/:id/review`           | `outside-result.review` | Optional note; once; see Review                                                                                                                    |
| `GET /outside-results/unreviewed`            | `outside-result.review` | The queue across patients; see Review                                                                                                              |

The report is uploaded with the ordinary two-step document flow (`POST /documents` with category `outside_result` and the patient, PUT, `/complete`), so the checksum and malware scan apply and an infected file is quarantined and cannot be filed.

Roles: `org_admin`, `physician`, `nurse`, `receptionist` and `records_officer` read and file; `dentist` reads. Organizations grant more through their own roles.

## Events and audit

`OutsideResultFiled` and `OutsideResultReviewed` (ids only). Audit: `outside-result.record`, `outside-result.view`, `outside-result.entered-in-error`, `outside-result.review`, plus `document.download` when the report is opened.

## Staff screens

- `/patients/[id]/outside-results`: file a report (file, source, kind, day, tests, how it reached the clinic, notes) and the list with **Open report** and **Entered in error…**.
- The patient record's **Labs** tab shows the latest five under "Results from other laboratories and hospitals".

## Review

A filed report waits until a clinician has recorded that they read it (migration `0129`).

- **What it records:** who, when and an optional note (500 characters, staff-only). It says nothing about what the report shows, changes nothing else in the record and is not a sign-off of the patient's care.
- **Who:** permission `outside-result.review` (physician, dentist). Nurses, receptionists and the records office file but cannot review. The filer may review their own filing.
- **Once:** a filing is reviewed once and a filing marked entered in error is never reviewed (`already_reviewed`, `already_entered_in_error`); the database trigger refuses any later change of the review. Filings made before the migration are unreviewed.
- **Routes:** `POST /outside-results/:id/review` (audited `outside-result.review`, event `OutsideResultReviewed` with ids only); `GET /outside-results/unreviewed` (oldest first, at most 100, the selected facility's and those filed without a facility; each listed patient is audited `outside-result.view`); the count behind the tab is `outsideResultsUnreviewed` in `GET /me/badges`.
- **Where it shows:** the patient's list ("Awaiting review", or "Reviewed by … on …" with the note), the timeline row ("Awaiting review" / "Reviewed"; never who or the note), the Patient 360 panel (a reviewed flag only) and the staff page `/clinic/outside-results`, the **Outside results** tab of Consultations with its count.
- **Not built:** reminders for reports left unreviewed, reassigning a report to a particular clinician and a second review. Nothing blocks care while a report is unreviewed.

## Patient timeline and Patient 360

- **Timeline:** kind `outside_result` (permission `outside-result.read`, source `outside_result`), dated when the report was filed. The row carries the tests, the source and the day it was done ("Outside result: CBC, HbA1c", "From St. Luke's… · Done …"), never the notes; entries in error stay listed, marked. The uploaded file is not also listed as a `document` entry (the documents timeline leaves out the `outside_result` category). Staff chip "Outside results"; the row opens `/patients/[id]/outside-results`.
- **Patient 360:** panel `outside_results` in `GET /patients/:id/workspace` (the latest 5 not in error: source, kind, tests, day, how it arrived, facility; no notes), withheld without `outside-result.read`. The panel says the reports are not results of this laboratory.

## Limits and follow-ups

- Not yet in the FHIR export, MyHealth or the copy of the record. Add each as its own change; none should present the filing as a laboratory result.
- Structured values for outside results (so a value could be seen beside trends) would need a labelled, separate store that is never merged into this laboratory's trends, as with imported FHIR history.
- Patients cannot yet send a result for the clinic to file from MyHealth; the reuse of the records office review queue is the likely design.
- The report itself may contain personal data of other people (a family member's name, a referral); retention follows the documents' category schedule (`/records/retention`), which the organization sets.
