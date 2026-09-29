# Records requests

## Purpose

A patient asks, in MyHealth, for copies of their records; the organization's records office reviews the request and
shares documents from the patient's record, or declines with a reason the patient reads. Code:
`libs/patient/src/lib/records-requests`, migration `0068_medical_certificates_records_requests.sql`, staff
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

## Commands

| Command        | Who                              | Rules                                                                                                           |
| -------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Submit         | Patient (MyHealth)               | At most **3 open** at once (`too_many_open_requests`, 409; serialized per patient); period in order.            |
| Withdraw       | Patient                          | Own, open request (`request_closed` otherwise).                                                                 |
| Take in review | `patient.records-request.manage` | Submitted only; optimistic `version`.                                                                           |
| Share (fulfil) | `patient.records-request.manage` | Open; 1–50 documents of this patient, ordinary and available (`document_not_shareable`); optional note; closes. |
| Decline        | `patient.records-request.manage` | Open; reason (3–1000) the patient reads; closes.                                                                |

## Queries

The records office's list (open oldest first, answered, all; with the patient's number and name and the days waiting);
one request (audited `patient.records-request.view`) with what was shared and the patient's documents that could be
(listing them is audited by the documents service). The patient's requests with the answer and the shared documents
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
`POST /records-requests/:id/{review,fulfil,decline}`. MyHealth: `GET /portal/documents`, `POST /portal/records-requests`,
`POST /portal/records-requests/:id/withdraw`, `GET /portal/records-requests/documents/:documentId/link` (a short-lived
link to a document shared in a fulfilled request of this patient; audited as the patient's download).

## Database relationships

`records_request` → `patient` (same organization), `patient_portal_account`; `records_request_document` →
`records_request` by (organization, id) and (patient, id), → `document` by (organization, id). Guard trigger on the
request; append-only shared documents.

## Integration points

`DocumentsService` (`libs/documents`): the patient's documents, a metadata lookup (`describe`) and patient links
(`downloadUrlForPatient`). Notifications through `NotificationService`. Staff notices use `UsersService.holdersOf` with
no facility (records requests belong to the organization).

## Open questions / assumptions

- Identity checks beyond the MyHealth sign-in, fees and response times follow the organization's procedures; the page
  reminds staff of them. Requests on behalf of someone else (a parent, a representative) are made at the clinic.
- Copies are shared as documents already in the record (uploaded scans, generated reports, certificates); composing a
  full record export is a follow-up.
