# Documents (`libs/documents`)

## Purpose

Metadata and controlled access for files kept in S3-compatible storage
(consent forms, IDs, medical certificates, lab reports, imaging, …).

## Flow

1. `POST /documents` registers metadata (allowed type, ≤ 50 MB) and returns a
   10-minute presigned `PUT` with the headers to send.
2. Client uploads directly to storage.
3. `POST /documents/:id/complete` reads the object back: size as declared, SHA-256 (refused when it differs from a
   checksum declared at registration, `422 checksum_mismatch`), then the malware scanner's verdict → `available`
   (`scan_status` `clean`, or `not_scanned` without a scanner) or `quarantined` (migration `0098`, below).
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
(`document_retention_policy`, migration `0074`; `document.retention.manage`) and reviews the available ordinary documents
stored longer than it (`/document-retention`, staff `/records/retention`). Nothing is deleted; a document is archived
with a reason as usual. See `docs/architecture/compliance-configuration.md`.

## Permissions

`document.upload`, `document.read`, `document.archive`, `document.retention.manage`, `document.integrity.manage`.

## Ports

`ObjectStorage` (presigned upload/download, head, `putIfAbsent`, `get`) with `S3ObjectStorage` (AWS SDK v3,
SSE-AES256, `If-None-Match: *` for server-side writes) and `InMemoryObjectStorage` (tests).

## Patient uploads (MyHealth messages)

A patient may upload a photo or PDF to send with a MyHealth message (migration `0097`,
[patient messaging](patient-messaging.md)): `DocumentsService.createForPatient` files a `clinical_attachment`
document of the patient's own record with `source = 'patient_upload'` and `created_by_portal_account` (no staff
`created_by`; CHECK `document_patient_upload_creator`), `completeUploadForPatient` verifies the stored object, and
`patientUploadsToday` counts a day's uploads for the limit. Only JPEG, PNG, HEIC and PDF up to 10 MB, through the
same presigned flow (the portal server sends the bytes). Uploads are opened only behind short-lived audited links;
the clinic sees them in the conversation and in the patient's documents.

## Malware scanning and checksums (migration `0098`)

Every completed upload (staff or patient) is read back from storage in the completing request, hashed and scanned
through the `MalwareScanner` port (`libs/documents/src/lib/malware-scanner.ts`): `ClamAvScanner` speaks clamd's
`INSTREAM` protocol over TCP to `CLAMAV_HOST`:`CLAMAV_PORT` (default 3310; `CLAMAV_TIMEOUT_MS`, default 60 s; no
third-party dependency); `UnconfiguredMalwareScanner` is the default when `CLAMAV_HOST` is unset.

- **Clean** → `available`, `scan_status = 'clean'`, `scanned_at`, `sha256`.
- **Infected** → `status = 'quarantined'`, `scan_status = 'quarantined'`, the scanner's `scan_signature`. A quarantined
  document is never `available`, so every existing check across domains (attachments, consent forms, FHIR, links)
  already refuses it; the object stays in storage for the organization's incident handling (nothing is deleted). The
  completing call answers `422 upload_quarantined`; the change is audited `document.quarantine` (signature, never the
  title); `DocumentQuarantined` (ids only) → in-app `document.quarantine-notice` to the facility's holders of
  `document.archive` (the records office) and the staff uploader (`apps/api/src/app/document-notifications.ts`).
- **Scanner configured but unreachable** → `422 scan_unavailable`; the document stays `pending_upload` so the client
  can retry. Readiness reports `malwareScanner` `unreachable` (`200 degraded`).
- **No scanner configured** → `available` with `scan_status = 'not_scanned'`; readiness reports `unconfigured` and the
  API logs `documents.scanner_unconfigured` at start-up in production. Documents stored before `0098` carry
  `not_scanned` (uploads) or `clean` (generated); their `sha256` is null ("not recorded").
- **Generated documents** (`storeGenerated`) are clean by origin and hashed at storage time.
- `sha256` (optional, hex) may be declared at `POST /documents`; `declared_sha256` is kept on the row and never
  returned. Stored documents are verified against their hash by the integrity review (below).

Running clamd: `clamav` in the development compose file (`CLAMAV_HOST=localhost`); on Railway a private service from
the `clamav/clamav` image (`docs/deployment/railway.md`). clamd's `StreamMaxLength` must cover `MAX_DOCUMENT_BYTES`
(50 MB). Scanning is a safeguard, not a guarantee: signature updates, engine choice and incident handling are the
organization's (compliance register).

## Integrity review (migration `0105`, D7 phase 2)

The records office (`document.integrity.manage`: org_admin, records_officer; staff `/records/integrity`) starts a
review of the organization's **available** documents — every category or one — and `DocumentIntegrityService`
runs it in the background in the API process (a poller like the DOH rescan: one review at a time per organization,
claimed with `SKIP LOCKED`, resumable from its cursor after a restart, three attempts, cancellable). Each document is
read back from object storage (`ObjectStorage.get`, four at a time, pages of 50) and compared with its `sha256`
(`checkIntegrity`, `document-integrity.rules.ts`):

- **verified** — the bytes match; `document.integrity_status = 'verified'`, `integrity_checked_at`.
- **baselined** — the document has no recorded hash (stored before `0098`): the current hash is recorded as its
  baseline (audited `document.integrity.baseline`), reported separately and never counted as verified; the next
  review verifies it.
- **mismatch** — the bytes differ from the recorded hash (corruption, a failed restore, tampering); **missing** — no
  object at the key; **unreadable** — storage did not answer. Each becomes a `document_integrity_finding` (one open
  per document, so a repeated review adds nothing; recorded and computed hash; audited `document.integrity.finding`).
- A **mismatch or missing** finding withholds the document from every reader until it is resolved: `downloadUrl`,
  `downloadUrlForPatient` and `content` answer `422 document_integrity_failed`, so staff links, MyHealth, FHIR
  `Binary` and the laboratory's archived reports are all refused; `DocumentIntegrityFailed` (ids and outcome) →
  in-app `document.integrity-notice` to the facility's `document.archive` holders. **Unreadable never blocks.**
  Attaching a withheld document elsewhere (a consent, a referral, a message) is not refused by this phase: those
  checks look at `status` only, and the document view carries `integrityStatus` so screens can show it.
- **Resolving** a finding (`POST /document-integrity/findings/:id/resolve`, a note of 5–500 characters, once; the
  trigger refuses any other change and every delete; audited `document.integrity.resolve` with the note as reason)
  records the records office's decision and serves the document again. The platform never repairs, replaces or
  deletes a file: restoring from a backup or archiving the document with a reason is the organization's procedure.

`GET|POST /document-integrity/runs`, `GET /document-integrity/runs/:id`, `POST …/cancel`,
`GET /document-integrity/findings?status=open|resolved` (at most 200, metadata only; audited `document.integrity.view`).
Runs record `checked = verified + baselined + mismatched + missing + unreadable` and are audited
`document.integrity.run | cancel | completed | failed`. Archived and quarantined documents are outside the review (an
archived document's file may have been disposed of under the organization's procedure). No schedule is built: how
often to run a review, and what to do about a finding, are the organization's (compliance register).

## Not yet

Thumbnails and DICOM viewing (deferred with reasons: no screen shows an image inline today — every image opens behind
a signed link —, a thumbnail needs a native image dependency in the API and a second object per document, and would
still leave HEIC, PDF and DICOM without one; DICOM viewing needs a browser viewer and a decision on which modalities
the practice produces). Retention schedules beyond the per-category periods.
