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

## Entity

`document` — category, title, file name, content type, size, opaque storage
key (`org/<orgId>/documents/<id>`), status, patient/facility links.

## Consent forms

A patient consent may reference a document (`patient_consent.document_id`). It
must be an `available` `consent_form` document of the **same patient**:
checked by the patient library through `DocumentsService` and enforced by the
foreign key `(organization_id, patient_id, document_id)` (migration 0014).
`DocumentsModule` is registered as a global module so domain libraries can use
`DocumentsService` without registering the controller twice.

## Permissions

`document.upload`, `document.read`, `document.archive`.

## Ports

`ObjectStorage` with `S3ObjectStorage` (AWS SDK v3, SSE-AES256) and
`InMemoryObjectStorage` (tests).

## Not yet

Malware scanning, checksum verification, retention schedules, thumbnails, DICOM viewing.
