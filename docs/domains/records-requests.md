# Records requests

## Purpose

A patient asks, in MyHealth, for copies of their records; the organization's records office reviews the request and
shares documents from the patient's record, or declines with a reason the patient reads. Code:
`libs/patient/src/lib/records-requests`, migrations `0068_medical_certificates_records_requests.sql` and
`0070_record_export.sql` (copies of the record, composed in `apps/api/src/app/record-copy`), staff
`/records/requests`, MyHealth `/documents`.

Not responsible for: deciding what may be disclosed, to whom or by when. The Data Privacy Act gives data subjects a right
of access, but the organization's own procedures (identity checks, fees, response times, what is withheld) govern the
answer; **no deadline, fee or disclosure rule is encoded** (compliance dependency). Records already in MyHealth
(released results, prescriptions, care plans, dental records the clinic shares) need no request.

## Entities

- **Records request** (`records_request`) — number `RR########` per organization (`records_request_number_sequence`),
  the patient, what they ask for (`scope`, 1–7 of consultations, laboratory, prescriptions, dental, imaging,
  certificates, other — "other" needs details), an optional period, details (≤ 1000) and purpose (≤ 300), the MyHealth
  account that sent it, status `submitted → in_review → fulfilled | declined`, or `withdrawn` by the patient while open;
  who took it into review and when; the answer (`response_note`: a note when shared, the **reason** when declined —
  required); who closed it and when; version. What the patient asked is never changed; a closed request never changes;
  nothing is deleted (trigger).
- **Shared document** (`records_request_document`, append-only) — a document of the patient's record shared in answer
  (who, when). Only ordinary documents (a domain that manages its documents, e.g. unreleased laboratory attachments,
  shares them itself), of the same patient (composite key), available when shared. An archived document is no longer
  offered to the patient.
- **Copy of the record** (`records_request_export`, append-only) — a PDF compiled from the patient's record for the
  request: its id is the stored document's (category `record_copy`, generated, of the same patient — composite key),
  the sections (1–8 of allergies, consultations, laboratory, prescriptions, care_plans, dental, certificates,
  documents), the optional period, who prepared it and when. A new copy is a new document; none is ever replaced.

## Copy of the record

The records office compiles the sections a request needs into one PDF, stored once in the patient's record and then
shared like any other document (it appears among the documents to share). The screen starts from the sections matching
what the patient asked for (consultations → allergies, consultations, care plans; laboratory → laboratory; prescriptions
→ prescriptions; dental → dental; imaging → documents; certificates → certificates; other → none) and from the request's
period. The record is composed at the application layer (`RecordCopyService` over `FhirRecordComposer`, plus
`ClinicQueries.signedNotes` and the issued medical certificates), never by the patient library.

- **Cover:** the patient's name, number, date of birth and sex; the request number, period, contents, who prepared it
  and when; what the copy leaves out. Footer: the request number and "Confidential".
- **Allergies:** the current active list (confirmed or not; imported ones labelled "from another provider"), or the
  recorded review ("No known allergies"), whatever the period.
- **Consultations:** completed consultations started in the period (in person and online): clinician with PRC number,
  chief complaint, vital signs, diagnoses (not entered in error), and the note as it stands — the latest signed or
  amendment revision, never a draft (an amended note says so).
- **Laboratory:** results **released** in the period (current version; "performed by" a reference laboratory for
  send-outs; flags in words). Unreleased results never appear.
- **Prescriptions** issued in the period (status shown when not active); **care plans** (not drafts) running during the
  period, with activities not cancelled; **dental** procedures (recorded) and treatment plans; **certificates** issued
  (not void) for examinations in the period — listed, each is its own document; **documents** uploaded in the period —
  listed (earlier copies of the record are not), the files are shared separately.
- Dates are local dates in the facility's time zone (Asia/Manila when no facility is selected); both ends included.
- The copy answers the patient's own request, so it includes the dental record and the document list whatever the
  preparer's own clinical permissions; preparing it is audited (`patient.records-request.copy` with the sections and
  period — never content) and nothing reaches the patient until the records office shares it.

## The organization's procedure

`records_request_setting` (migration `0071`; `docs/architecture/compliance-configuration.md`): a response time in days
(each new request gets `respond_by`, shown to staff and to the patient; open requests past it are flagged), whether staff
must record how they confirmed the requester's identity before sharing (sharing is refused with
`identity_check_required` until they do; stored on the request), and a notice patients read in MyHealth before asking.
`GET|PUT /records-requests/setting` (write needs `organization.manage` too). Staff `/records/requests/settings`. The
values are the organization's own; no deadline, fee or disclosure rule is suggested.

## Commands

| Command        | Who                              | Rules                                                                                                                 |
| -------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Submit         | Patient (MyHealth)               | At most **3 open** at once (`too_many_open_requests`, 409; serialized per patient); period in order.                  |
| Withdraw       | Patient                          | Own, open request (`request_closed` otherwise).                                                                       |
| Take in review | `patient.records-request.manage` | Submitted only; optimistic `version`.                                                                                 |
| Share (fulfil) | `patient.records-request.manage` | Open; 1–50 documents of this patient, ordinary and available (`document_not_shareable`); optional note; closes.       |
| Decline        | `patient.records-request.manage` | Open; reason (3–1000) the patient reads; closes.                                                                      |
| Prepare a copy | `patient.records-request.manage` | Open (`request_closed` otherwise); 1–8 sections; period in order. Stores a `record_copy` document; request unchanged. |

## Queries

The records office's list (open oldest first, answered, all; with the patient's number and name and the days waiting);
one request (audited `patient.records-request.view`) with what was shared, the patient's documents that could be
(listing them is audited by the documents service), the copies prepared for it and the suggested sections. The patient's requests with the answer and the shared documents
(`GET /portal/documents`, audited `portal.documents-view`, together with their medical certificates).

## Events

`RecordsRequestSubmitted` → in-app `records.request-new` to every holder of `patient.records-request.manage` in the
organization (link to the request); `RecordsRequestFulfilled`, `RecordsRequestDeclined` → `records.update` to the patient
(in-app, and SMS or email when SMS is not possible — the request number only, no clinical detail);
`RecordsRequestWithdrawn`. Handler: `apps/api/src/app/portal/patient-records-notices.ts`. Payloads carry ids, the number
and status.

## Permissions

`patient.records-request.manage` (org_admin, records_officer; migration `0068`) for every staff route. Patients act
through MyHealth (`PatientAccessGuard`, portal consent re-checked per request); their actions are audited with actor
type `patient` (`portal.records-request.submit | withdraw`).

## API

Staff: `GET /records-requests?status=open|closed|all`, `GET /records-requests/:id`,
`POST /records-requests/:id/{review,fulfil,decline}`, `POST /records-requests/:id/copies` (`{ sections, periodFrom?,
periodTo? }` → the stored document's id). MyHealth: `GET /portal/documents`, `POST /portal/records-requests`,
`POST /portal/records-requests/:id/withdraw`, `GET /portal/records-requests/documents/:documentId/link` (a short-lived
link to a document shared in a fulfilled request of this patient; audited as the patient's download).

## Database relationships

`records_request` → `patient` (same organization), `patient_portal_account`; `records_request_document` →
`records_request` by (organization, id) and (patient, id), → `document` by (organization, id);
`records_request_export` → `records_request` likewise, → `document` by (organization, patient, id). Guard trigger on the
request; append-only shared documents and copies.

## Integration points

`DocumentsService` (`libs/documents`): the patient's documents, a metadata lookup (`describe`) and patient links
(`downloadUrlForPatient`). Notifications through `NotificationService`. Staff notices use `UsersService.holdersOf` with
no facility (records requests belong to the organization).

## Open questions / assumptions

- Identity checks beyond the MyHealth sign-in, fees and response times follow the organization's procedures, which it
  records as its own settings (above). Requests on behalf of someone else (a parent, a representative) are made at the clinic.
- A copy of the record contains what the platform holds as structured data; scans and images stay separate documents to
  share. Billing records, the dental chart and periodontal charts are not in the copy (ask for them specifically).
- Whether a copy must be certified, signed or stamped, and what may be withheld from it, is the organization's
  procedure (compliance dependency); the PDF carries no signature.
