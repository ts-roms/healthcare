# Documents (`libs/documents`)

## Purpose

Metadata and controlled access for files kept in S3-compatible storage
(consent forms, IDs, medical certificates, lab reports, imaging, …).

## Flow

1. `POST /documents` registers metadata (allowed type, ≤ 50 MB) and returns a
   10-minute presigned `PUT` with the headers to send.
2. Client uploads directly to storage.
3. `POST /documents/:id/complete` verifies the object exists with the declared size → `available`.
4. `GET /documents/:id/download-url` issues a 5-minute URL; each issuance is audited.
5. `POST /documents/:id/archive` (reason required). Documents are never deleted by the API.

## Generated documents

Documents the platform produces itself (today: archived laboratory reports) go through
`DocumentsService.storeGenerated`: the caller chooses the id (idempotency), the object is written server side with a
conditional put that never replaces an existing object, and the document is recorded `available` with source
`generated` and no uploading user (`created_by` null; migration 0030), in the same transaction as the caller's own
bookkeeping. `DocumentsService.content` returns the bytes of an available document to a library that has already
authorized the access (audited as `document.download`).

## Entity

`document` — category, title, file name, content type, size, opaque storage
key (`org/<orgId>/documents/<id>`), status, source (`upload | generated`), patient/facility links.

## Consent forms

A patient consent may reference a document (`patient_consent.document_id`). It
must be an `available` `consent_form` document of the **same patient**:
checked by the patient library through `DocumentsService` and enforced by the
foreign key `(organization_id, patient_id, document_id)` (migration 0014).
`DocumentsModule` is registered as a global module so domain libraries can use
`DocumentsService` without registering the controller twice.

## Queries for other domains

`DocumentRecordQueries.patientRecord(organizationId, patientId)` — metadata of a patient's `available` documents (no
storage key), unaudited, for record exports composed in the API: the FHIR interface maps them to `DocumentReference`
and serves the content through `DocumentsService.downloadUrl` (audited). See `docs/interoperability/fhir.md`.

## Documents managed by a domain

`document.managed_by` (migration 0040) marks documents a domain serves itself, with its own rules — today
`laboratory` (result attachments, visible to clinicians only after release). `DocumentsService` methods take an
optional `{ managedBy }` scope: without it (the documents API, consent forms, FHIR) they only see ordinary documents,
so managed documents are never listed, served or archived through the generic API; the managing domain passes its
name after applying its own checks.

## Retention

The organization sets a retention period (years) per category from its own retention schedule
(`document_retention_policy`, migration `0071`; `document.retention.manage`) and reviews the available ordinary documents
stored longer than it (`/document-retention`, staff `/records/retention`). Nothing is deleted; a document is archived
with a reason as usual. See `docs/architecture/compliance-configuration.md`.

## Permissions

`document.upload`, `document.read`, `document.archive`.

## Ports

`ObjectStorage` (presigned upload/download, head, `putIfAbsent`, `get`) with `S3ObjectStorage` (AWS SDK v3,
SSE-AES256, `If-None-Match: *` for server-side writes) and `InMemoryObjectStorage` (tests).

## Not yet

Malware scanning, checksum verification, retention schedules, thumbnails, DICOM viewing.
