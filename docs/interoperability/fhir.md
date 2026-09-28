# FHIR R4 interface

A **read-only** FHIR view of a patient's record, for exchange with other systems (referral partners, HIEs,
patient-directed apps once authorised). The internal model stays the source of truth; FHIR resources are produced
on request by a mapping layer and never stored (root `CLAUDE.md` §19–20, `libs/interoperability/CLAUDE.md`).

| Item               | Value                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| Specification      | HL7 FHIR **R4, 4.0.1** (`FHIR_VERSION` in `libs/interoperability/src/lib/fhir/terminology.ts`)           |
| Profiles           | Base R4 resources; vital signs follow the R4 vital signs profile codes. **No national profile claimed.** |
| Format             | `application/fhir+json` only                                                                             |
| Validation         | Every mapper output is tested against the official R4 JSON schema (unit and integration tests)           |
| Status             | Implemented (read). Write/transaction, SMART on FHIR and subscriptions: not implemented                  |
| Philippine profile | Integration dependency — see [dependencies.md](dependencies.md)                                          |

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
content is served); laboratory result attachments (laboratory-managed documents, not exported yet); dental resources (Phase 6); write/transaction; SMART on FHIR app authorization and patient-facing access; bulk data export;
a Philippine national profile (conformance must be validated against the official specification when obtained).
