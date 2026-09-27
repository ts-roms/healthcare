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
PatientRecordService · ClinicQueries.patientRecord · LabRecordQueries · PrescriptionService.allForPatient · CarePlanService.allForPatient
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

| Request                                                | Returns                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /metadata`                                        | `CapabilityStatement`                                                                                                                                   |
| `GET /Patient/{id}`                                    | `Patient`                                                                                                                                               |
| `GET /Patient/{id}/$everything`                        | `Bundle` (searchset): the patient and all clinical resources as `match`, organization, locations and practitioners as `include`                         |
| `GET /{Type}?patient={id}` (or `patient=Patient/{id}`) | `Bundle` of one type: Encounter, Condition, AllergyIntolerance, Observation, Appointment, ServiceRequest, DiagnosticReport, MedicationRequest, CarePlan |

Only patient-scoped searches exist: no queries across patients. Errors are `OperationOutcome` (`invalid` 400,
`login` 401, `forbidden` 403, `not-found` 404 — including another organization's patient — `throttled` 429).

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

**Laboratory results:** only the current **released** version of each result is exported. Unreleased, superseded and
cancelled results never leave the laboratory through this interface. (Unlike the patient portal, the `patient_releasable`
flag and critical-value acknowledgement do not filter here: this is a clinician-to-clinician exchange.)

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

Paging of large Bundles; `_lastUpdated`/`_since`; `DocumentReference` for stored documents and PDFs; dental
resources (Phase 6); write/transaction; SMART on FHIR app authorization and patient-facing access; bulk data export;
a Philippine national profile (conformance must be validated against the official specification when obtained).
