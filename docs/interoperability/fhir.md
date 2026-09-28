# FHIR R4 interface

A FHIR view of a patient's record, for exchange with other systems (referral partners, HIEs, patient-directed apps once
authorised). The internal model stays the source of truth; FHIR resources are produced on request by a mapping layer
and never stored (root `CLAUDE.md` §19–20, `libs/interoperability/CLAUDE.md`). Inbound content is received into a
**review queue** and reaches a record only when staff accept it (see "Inbound" below).

| Item               | Value                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Specification      | HL7 FHIR **R4, 4.0.1** (`FHIR_VERSION` in `libs/interoperability/src/lib/fhir/terminology.ts`)                           |
| Profiles           | Base R4 resources; vital signs follow the R4 vital signs profile codes. **No national profile claimed.**                 |
| Format             | `application/fhir+json` only                                                                                             |
| Validation         | Every mapper output is tested against the official R4 JSON schema (unit and integration tests)                           |
| Status             | Implemented: read; inbound imports into a review queue. Transaction/batch, SMART on FHIR, subscriptions: not implemented |
| Philippine profile | Integration dependency — see [dependencies.md](dependencies.md)                                                          |

## Architecture

```
PatientRecordService · ClinicQueries.patientRecord · LabRecordQueries · PrescriptionService.allForPatient · CarePlanService.allForPatient · DocumentRecordQueries
        │  (each domain's own read query, unaudited; no domain knows FHIR)
        ▼
apps/api/src/app/fhir/fhir-record.ts  — FhirRecordComposer: domain rows → PatientRecordSource (interop's own terms)
        ▼
libs/interoperability (scope:interoperability, type:domain) — pure functions: sources → FHIR R4 resources, Bundles
        ▼
apps/api/src/app/fhir/fhir.controller.ts — /api/v1/fhir/r4, permission, audit, OperationOutcome errors
```

`libs/interoperability` depends only on `@types/fhir` (types). It imports no domain; the API composes the source.

## Endpoints

All under `/api/v1/fhir/r4`, bearer token of a staff account holding **`interop.fhir.read`** with the organization
selected (migration `0020_fhir_read.sql`; `org_admin` holds it — grant it deliberately to an integration account's
role). Every access is audited (`fhir.patient-read`, `fhir.patient-everything`, `fhir.search`) with the patient, the
resource types and the number of resources returned.

| Request                                                | Returns                                                                                                                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /metadata`                                        | `CapabilityStatement`                                                                                                                                                              |
| `GET /Patient/{id}`                                    | `Patient`                                                                                                                                                                          |
| `GET /Patient/{id}/$everything`                        | `Bundle` (searchset, paged): the patient and all clinical resources as `match`, the organization, locations and practitioners the page references as `include`                     |
| `GET /{Type}?patient={id}` (or `patient=Patient/{id}`) | `Bundle` of one type (paged): Encounter, Condition, AllergyIntolerance, Observation, Appointment, ServiceRequest, DiagnosticReport, MedicationRequest, CarePlan, DocumentReference |
| `GET /Binary/{documentId}`                             | The content of a `DocumentReference`: `302` to a short-lived (5 min) signed download of the file. Requires `document.read`; audited as `document.download`                         |

Only patient-scoped searches exist: no queries across patients. Errors are `OperationOutcome` (`invalid` 400,
`not-supported` 400, `login` 401, `forbidden` 403, `not-found` 404 — including another organization's patient —
`throttled` 429). The audit metadata records the resource types and number of resources on the page returned, the
full `total`, `_count`, `_offset` and any `_lastUpdated` filter.

## Paging

`$everything` and every search are paged with `_count` and `_offset`:

- `_count`: matches per page, default **50**, at most **200** (a larger value is reduced to 200, as FHIR allows);
  `_count=0` returns only `total`. `_offset`: matches skipped (default 0). Anything else is `invalid`.
- `total` is always the number of matches in the whole result, not in the page. `link` has `self` and, where they
  exist, `next` and `previous` (URLs repeat the request's parameters with explicit `_count` and `_offset`).
- Matches are in a **stable order**: in `$everything` the Patient first, then by resource type (the order of the table
  above) and id; a search orders by id. Pages neither overlap nor skip while the record is unchanged. Offset paging is
  not a snapshot: a record changed between two page requests can shift later pages; re-read from the first page when
  consistency matters.
- `$everything` includes on each page only the shared resources (Organization, Location, Practitioner) that page's
  matches reference. A reference from one match to another (e.g. an Encounter to its Appointment) may resolve on
  another page.
- `$everything` does not support `_since`, `_type`, `start` or `end`; they are refused (`not-supported`) rather than
  ignored.

## `_lastUpdated`

Searches accept `_lastUpdated` with the `ge` and/or `le` prefix, at most one of each
(`_lastUpdated=ge2026-09-01&_lastUpdated=le2026-09-30`). A value is a date (`YYYY-MM-DD`, a whole day in Asia/Manila
time; `le` includes that day) or an instant with a time zone (`2026-09-01T08:00:00+08:00`), compared exactly. Other
prefixes (and none) are `not-supported`. The filter applies to `meta.lastUpdated`, which is set only where the
underlying record has a reliable last-updated time:

| Type                                                                      | `_lastUpdated`  | Why                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MedicationRequest`                                                       | Supported       | Prescriptions are immutable once issued (database triggers); cancel/replace is the only change and records `cancelled_at`. Last updated = `cancelled_at`, else `issued_at`.                           |
| `DocumentReference`                                                       | Supported       | An exported document never changes after upload (archiving withdraws it); an archived lab report version is superseded when the next version is stored. Last updated = that time, else `uploaded_at`. |
| `Encounter`, `Condition`, `AllergyIntolerance`, `Appointment`, `CarePlan` | Refused (`400`) | `updated_at` is maintained by application code, not the database, and the resource also shows related rows (an Encounter's diagnoses, a CarePlan's activities) that change without touching it.       |
| `Observation`                                                             | Refused (`400`) | Vital signs marked entered-in-error record no time of that change (released laboratory results would qualify; one type cannot be filtered only in part).                                              |
| `ServiceRequest`, `DiagnosticReport`                                      | Refused (`400`) | Their status derives from laboratory item and result progress; no single row holds a change time for everything shown.                                                                                |

Refusing is deliberate: silently ignoring the filter, or answering it approximately, would let a client miss changes.
The Patient resource carries `meta.lastUpdated` (the patient row's `updated_at`) for information; `_lastUpdated` is not
a parameter of `$everything`.

## Mapping

| Internal                               | FHIR R4                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Patient (Patient Master)               | `Patient`: patient number as `MR` identifier; other identifiers; name; telecom; PH address; emergency contacts |
| Organization / facility                | `Organization` / `Location` (facility license as identifier)                                                   |
| Practitioner                           | `Practitioner` (PRC license as identifier)                                                                     |
| Encounter                              | `Encounter`: class `AMB`, or `VR` for telemedicine; diagnoses ranked                                           |
| Diagnosis                              | `Condition` (encounter-diagnosis); ICD-10 → `http://hl7.org/fhir/sid/icd-10`                                   |
| Allergy / "no known allergies" review  | `AllergyIntolerance`; a recorded NKA review with nothing active → SNOMED CT `716186003`                        |
| Vital sign set                         | One `Observation` per measurement (LOINC, UCUM); blood pressure as components; BMI computed                    |
| Appointment                            | `Appointment`                                                                                                  |
| Laboratory order item                  | `ServiceRequest` (order number as requisition)                                                                 |
| Released laboratory result             | `Observation` (LOINC when the test has one; `corrected` for a later version); interpretation from the flag     |
| Laboratory order with released results | `DiagnosticReport` (`partial` while tests are pending)                                                         |
| Prescription line                      | `MedicationRequest` (prescription number as group identifier; superseded → `stopped`)                          |
| Care plan                              | `CarePlan` with activities                                                                                     |
| Stored document (libs/documents)       | `DocumentReference` (see below)                                                                                |

**Laboratory results:** only the current **released** version of each result is exported. Unreleased, superseded and
cancelled results never leave the laboratory through this interface. (Unlike the patient portal, the `patient_releasable`
flag and critical-value acknowledgement do not filter here: this is a clinician-to-clinician exchange.)

**Documents:** `DocumentRecordQueries` (libs/documents) returns the metadata of the patient's **available**
documents; the file stays in private object storage and its storage key never leaves the documents library. Each
becomes a `DocumentReference` (`current`; type from the platform's document category, a local code system; title as
`description`; `custodian` the organization) whose attachment gives content type, size, file name and upload time and
a `url` on this endpoint, `{base}/Binary/{id}`. That URL needs the caller's bearer token and `document.read`, and
answers with a redirect to a signed download that expires in 5 minutes; no object-store URL is ever put in a resource.

- **Who sees documents:** only callers holding `document.read` (the permission the documents API requires). For
  other callers, `DocumentReference?patient=` and `Binary/{id}` are `403`, and `$everything` leaves documents out and
  says so in an `OperationOutcome` entry (`search.mode = outcome`, severity `information`, code `suppressed`).
- **Archived documents are not exported,** and their `Binary` is `404`. Archiving (with a reason) withdraws a
  document — e.g. uploaded to the wrong patient or replaced — and its file is no longer served by the documents API
  either. FHIR's `superseded` and `entered-in-error` each claim a specific reason the platform does not record, so
  neither is asserted. Pending uploads (no verified file) are not exported.
- **Archived laboratory reports** (generated documents, one per released result set of an order — see
  [printable-documents.md](../architecture/printable-documents.md)) carry LOINC `11502-2` _Laboratory report_ in
  their type and `context.related` → the order's `DiagnosticReport`. Every version but the latest is `superseded`
  (from the time the next version was stored; stored archives never change), and each later version `relatesTo`
  `replaces` → the previous one when that one is exported. `LabRecordQueries.reportArchives` supplies the versions.

**Entered in error:** resources keep their `entered-in-error` status (FHIR expects them to be visible as such), and
conditions/allergies in error carry no clinical status (invariants `con-5`, `ait-2`).

## Identifier and code systems

No official URIs for Philippine national identifiers are on record, so none are invented:

- The platform's own identifiers (patient number, facility code, order and prescription numbers) use a local
  namespace: `FHIR_IDENTIFIER_BASE/{organization code}/…` (defaults to `{API origin}/fhir/identifiers`).
- National identifiers (PhilHealth PIN, PhilSys number, PRC license, facility license) default to
  `…/identifier/{type}` under that namespace until **configured** with `FHIR_IDENTIFIER_SYSTEMS`, a JSON map from the
  internal identifier type to the official URI, e.g. `{"philhealth_pin": "<official URI>"}`.
- Diagnosis coding keys other than ICD-10 map through `FHIR_CODE_SYSTEMS` in the same way.
- `FHIR_BASE_URL` sets the public base used in `Bundle` links (defaults to the request URL).

## Not yet

Cursor (snapshot) paging; `_since` on `$everything` and `_lastUpdated` for the types above (each needs a reliable
change time first, e.g. database-maintained timestamps); `DocumentReference` for invoices and receipts (rendered on
request, not stored); `DiagnosticReport.presentedForm` for the archived report; `Binary` as a FHIR resource (only the native
content is served); laboratory result attachments (laboratory-managed documents, not exported yet); dental resources (the dental record exists — [dental.md](../domains/dental.md) — but is not mapped yet); write/transaction; SMART on FHIR app authorization and patient-facing access; bulk data export;
a Philippine national profile (conformance must be validated against the official specification when obtained).
Inbound: importing documents' files, vital signs or laboratory results as internal records; a retention period for
accepted imports' sealed originals. Patient matching stays a person's decision.

## Inbound: imports into a review queue

Other systems send FHIR R4 content; nothing is written into a patient's record on receipt. Staff match the patient
and accept or reject each entry; accepting writes through the owning domain's own command, validation and audit.

```
POST /api/v1/fhir/r4/imports  (interop.fhir.import)
  → parseImport: targeted R4 validation, limits          (libs/interoperability, pure)
  → fhir_import + fhir_import_entry (types, counts, digests — no PHI) + fhir_import_content (sealed)
/api/v1/fhir-imports  (interop.fhir.import.review)     (staff: /records/imports)
  → open the sealed content → inbound mappers → readable entries
  → match the patient (duplicate detection / search / register) → accept | reject with a reason
  → FhirImportTargets port → apps/api adapter → libs/clinic ExternalRecordsService / libs/patient registration
```

### Receiving

`POST /api/v1/fhir/r4/imports`, `Content-Type: application/fhir+json` (or `application/json`), bearer token of an
account holding **`interop.fhir.import`** (org_admin; grant it to an integration account's role). Errors are
`OperationOutcome` resources, one issue per problem with its location in `expression`.

| Item                                     | Rule                                                                                                                                                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accepted                                 | Bundle `collection`, `document` or `searchset`, or a single resource (one entry)                                                                                                                                                                               |
| Refused (`422 not-supported`)            | Bundle `transaction`, `batch`, `message`, `history` and responses: they ask the receiver to execute or route content, which a review queue does not do. More than one `Patient` resource (one import holds one patient's records; send one Bundle per patient) |
| Limits (`413 too-costly`)                | At most **512 KiB** of JSON and **100 entries** per import (the API's 1 MB body limit is the outer bound)                                                                                                                                                      |
| Idempotency (`400 required` without one) | `Idempotency-Key` header (8–128 characters of `[A-Za-z0-9._:-]`), else `Bundle.identifier` (system + value). The same key with the same content returns the first import (`200`); with other content, `409 conflict`. Only SHA-256 digests of keys are stored  |
| Answer                                   | `201` (`200` for a repeat) with an `OperationOutcome` (`information`: the import id in `details.coding`, resource counts; `warning` when entries are not supported) and `Location: /api/v1/fhir-imports/{id}`                                                  |

Within 24 hours, a repeated request with the same `Idempotency-Key` from the same account is also answered by the
platform's general idempotency interceptor (it replays the first answer; a different body is refused with `422`).

**Validation.** The official R4 JSON schema is a test-only dependency (a large compiled schema, and it cannot express
required primitives, choice-element cardinality or minimum repeats). At runtime, `parseImport`
(`libs/interoperability/src/lib/fhir-import/inbound-validation.ts`) checks, for each supported type, every element the
mappers read: R4 primitive formats (`id`, `code`, `uri`, `date`, `dateTime`, `instant`, `base64Binary`), required
elements, cardinality, choice types (`value[x]`, `onset[x]`, `medication[x]`, …) and required bindings (e.g.
`Observation.status`, `MedicationRequest.intent`, `DocumentReference.status`). Elements the platform does not read
(extensions, narrative, …) are kept in the sealed original but neither interpreted nor validated; unsupported resource
types are checked only for a `resourceType` and a valid `id`. Unit tests hold the samples to both this validation and
the official schema.

### Storage (sealed)

| Table                 | Holds                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fhir_import`         | Status (`pending_review` → `accepted` / `partially_accepted` / `rejected`), the declared source (`Bundle.meta.source`, not verified), resource types and counts, digests, the matched patient, who/when |
| `fhir_import_entry`   | One row per entry: resource type, kind, outcome (`pending`, `accepted`, `rejected` with a reason, `not_supported`), what accepting created (`result_type`, `result_id`)                                 |
| `fhir_import_content` | The received JSON sealed with the **integration payload key ring** (`sealWithKeyring`, AES-256-GCM, `v2.<key id>.…`, key id recorded as in `integration_exchange_payload`)                              |

The received content is PHI from outside: it is never stored as plaintext or JSONB, and no PHI is kept in clear (the
list shows metadata only; audit metadata carries types, counts and digests). A key must stay in the key ring while
imports sealed with it are kept (see `docs/runbooks/integration-payload-key-rotation.md`).

**Retention.** The sealed content of a **rejected** import is deleted **30 days** after the rejection
(`FhirImportRetention`, hourly in the API process, audited `fhir.import.purge`); the import row, its entries and the
decisions remain. Accepted and partially accepted imports keep the sealed original as provenance of what was accepted
(no automatic deletion yet — to be set with the organization's records-retention policy). Pending imports are never
purged.

### Review (staff)

`/api/v1/fhir-imports` requires **`interop.fhir.import.review`** (org_admin, records_officer); staff screens
`/records/imports` and `/records/imports/{id}`. Every list, view, candidate check, match, accept and reject is audited
(`fhir.import.*`) with the patient once matched.

| Route                                              | Does                                                                                                                                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /fhir-imports?status=`                        | Imports, pending first (metadata, pending entry count, matched patient's number and name)                                                                                                                        |
| `GET /fhir-imports/{id}`                           | Each entry in readable form (the inbound model), its outcome, what accepting creates, notes (why it cannot be accepted, what to check)                                                                           |
| `GET /fhir-imports/{id}/candidates`                | The patient domain's **duplicate detection** for the imported Patient (identifier, name and birth date, contact) — audited there as `patient.duplicate-check`                                                    |
| `POST /fhir-imports/{id}/match`                    | Links the import to an existing patient (`version` checked). **Nothing is linked automatically.** The match can change until an entry was accepted for the patient                                               |
| `POST /fhir-imports/{id}/register-patient`         | Registers the imported Patient through the normal registration (also needs `patient.register` and a selected facility): possible duplicates are refused unless reviewed with a reason; a shared identifier never |
| `POST /fhir-imports/{id}/entries/{entryId}/accept` | Writes through the owning domain for the matched patient, in one transaction with the outcome                                                                                                                    |
| `POST /fhir-imports/{id}/entries/{entryId}/reject` | With a reason (3–500 characters)                                                                                                                                                                                 |
| `POST /fhir-imports/{id}/reject`                   | Rejects every pending entry with one reason and closes the import                                                                                                                                                |

The import completes when no entry is pending: `accepted` (every reviewed clinical entry accepted), `partially_accepted`
or `rejected`. The Patient entry is decided by the match; unsupported entries are shown, never accepted.

### What each resource becomes

| Received                                   | On accept                                                                                                                                                                                                                                                                                                                            | Not acceptable when                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Patient`                                  | Used to match (or register) the patient. Demographics of an existing patient are **never changed**. Identifiers are recognised only for systems configured in `FHIR_IDENTIFIER_SYSTEMS`; given names are kept together (FHIR does not say which is a middle name)                                                                    | —                                                                                                                                    |
| `AllergyIntolerance`                       | An **allergy** through the clinic's staff command (same validation, duplicate check, `allergy.add` audit): `source = external_import`, **always unconfirmed**, `source_reference = fhir-import:{id}#{entry}`. An active allergy to the same substance is never replaced (`409 allergy_exists`: reject the entry as already recorded) | Refuted or entered in error; inactive/resolved; "no known allergy" codes (NKA is only a staff review); no substance; another patient |
| `Condition`                                | **External history** (`external_history_entry`, kind `condition`): name, code, status and onset as sent. Not a diagnosis; no encounter is created                                                                                                                                                                                    | Refuted or entered in error; no name; another patient                                                                                |
| `Observation` (laboratory, vital signs)    | **External history** (kind `observation`, category as sent): value, interpretation, reference range as text. Never a laboratory result (released or not) or a vital sign set                                                                                                                                                         | `entered-in-error`, `cancelled`; another patient                                                                                     |
| `MedicationStatement`, `MedicationRequest` | **External history** (kind `medication`, `reported` or `prescribed_elsewhere`): medication, dosage text, status. Never a prescription                                                                                                                                                                                                | Entered in error; medication only by reference without a name; another patient                                                       |
| `DocumentReference`                        | **External history** (kind `document`): description, type, date and attachment metadata. The file is **not fetched or stored**                                                                                                                                                                                                       | Entered in error; another patient                                                                                                    |
| Anything else                              | Kept and shown as "not supported for import"                                                                                                                                                                                                                                                                                         | Always                                                                                                                               |

"Another patient": the entry's subject reference points to something other than the import's Patient (`fullUrl` or
`Patient/{id}`). With no subject reference, or no Patient in the import, the entry is acceptable with a note to check
it belongs to the matched patient.

External history appears on the patient record as **External history (imported)** (`GET /patients/{id}/external-history`,
`clinical.read`); imported allergies carry an "External record" badge. A mistaken acceptance is corrected by marking the
allergy entered in error (`allergy.manage`) or the external history entry entered in error (`interop.fhir.import.review`,
with a reason); nothing is deleted.
