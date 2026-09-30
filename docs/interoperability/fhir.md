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
PatientRecordService · ClinicQueries.patientRecord (incl. external history) · LabRecordQueries · PrescriptionService.allForPatient · CarePlanService.allForPatient · DocumentRecordQueries · DentalRecordQueries
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

| Request                                                | Returns                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /metadata`                                        | `CapabilityStatement`                                                                                                                                                                                                                                                                                                                                              |
| `GET /Patient/{id}`                                    | `Patient`                                                                                                                                                                                                                                                                                                                                                          |
| `GET /Patient/{id}/$everything`                        | `Bundle` (searchset, paged): the patient and all clinical resources as `match`, the organization, locations and practitioners the page references as `include`                                                                                                                                                                                                     |
| `GET /{Type}?patient={id}` (or `patient=Patient/{id}`) | `Bundle` of one type (paged): Encounter, Condition, AllergyIntolerance, Observation, Appointment, ServiceRequest, DiagnosticReport, MedicationRequest, MedicationStatement, CarePlan, DocumentReference, Procedure (dental ones require `dental.record.read`, withheld with a notice otherwise; past procedures of the history), Immunization, FamilyMemberHistory |
| `GET /Binary/{documentId}`                             | The content of a `DocumentReference`: `302` to a short-lived (5 min) signed download of the file. Requires `document.read`; audited as `document.download`                                                                                                                                                                                                         |

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

| Type                                                                      | `_lastUpdated`  | Why                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MedicationRequest`                                                       | Supported       | Prescriptions are immutable once issued (database triggers); cancel/replace is the only change and records `cancelled_at`. Last updated = `cancelled_at`, else `issued_at`.                                                                                                                                                                                                |
| `DocumentReference`                                                       | Supported       | An exported document never changes after upload (archiving withdraws it); an archived lab report version is superseded when the next version is stored. Last updated = that time, else `uploaded_at`. An imported document description: as below. A dental image: also the time the dental record described it (`dental_image.recorded_at`) or marked it entered in error. |
| `MedicationStatement`                                                     | Supported       | External history (below) and medications taken (patient history): rows are immutable (database triggers) except being marked entered in error and, for a medication taken, marked stopped once. Last updated = the latest of `entered_in_error_at`, `stop_recorded_at` and `recorded_at`.                                                                                  |
| `Procedure`                                                               | Supported       | Dental procedures and past procedures of the history: immutable except for being marked entered in error (triggers `dental_record_guard`, `patient_history_guard`; `performed_at` is the insert time). Last updated = `entered_in_error_at`, else `performed_at`. The code's display is the catalog's current name; the code never changes.                                |
| `Immunization`                                                            | Supported       | Immunization records are immutable except for being marked entered in error and a reaction added once (trigger `immunization_guard`). Last updated = the latest of `recorded_at`, `adverse_reaction_recorded_at` and `entered_in_error_at`.                                                                                                                                |
| `FamilyMemberHistory`                                                     | Supported       | Family history entries are immutable except for being marked entered in error (trigger `patient_history_guard`). Last updated = `entered_in_error_at`, else `recorded_at`.                                                                                                                                                                                                 |
| `Encounter`, `Condition`, `AllergyIntolerance`, `Appointment`, `CarePlan` | Refused (`400`) | `updated_at` is maintained by application code, not the database, and the resource also shows related rows (an Encounter's diagnoses, a CarePlan's activities) that change without touching it.                                                                                                                                                                            |
| `Observation`                                                             | Refused (`400`) | Vital signs marked entered-in-error record no time of that change (released laboratory results, external history and dental observations would qualify; one type cannot be filtered only in part).                                                                                                                                                                         |
| `ServiceRequest`, `DiagnosticReport`                                      | Refused (`400`) | Their status derives from laboratory item and result progress; no single row holds a change time for everything shown.                                                                                                                                                                                                                                                     |

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
| Referral (libs/clinic)                 | `ServiceRequest`, category SNOMED CT `3457005` Patient referral (see "Referrals")                              |
| Released laboratory result             | `Observation` (LOINC when the test has one; `corrected` for a later version); interpretation from the flag     |
| Laboratory order with released results | `DiagnosticReport` (`partial` while tests are pending)                                                         |
| Prescription line                      | `MedicationRequest` (prescription number as group identifier; superseded → `stopped`)                          |
| Care plan                              | `CarePlan` with activities                                                                                     |
| Stored document (libs/documents)       | `DocumentReference` (see below)                                                                                |
| Result performed by a reference lab    | `Observation.performer` → contained `Organization` (see "Performing laboratory")                               |
| Merged records (patient merge)         | Retired `Patient`: `active: false`, `link` `replaced-by` the survivor; survivor: `link` `replaces` each        |

**Patient merge (ADR-0009).** `Patient/{survivor}/$everything` and `{Type}?patient={survivor}` include the resources
filed under every record merged into it, all with `subject`/`patient` referencing the survivor (nothing was moved in
the platform; the export presents one patient). `Patient/{retired}` stays readable (inactive, `replaced-by`) and its
`$everything` holds only what is filed under it.
| Allergy accepted from an import | `AllergyIntolerance`, tagged external, always `unconfirmed` (see "Records from other systems") |
| External history (accepted imports) | `Condition` / `Observation` / `MedicationStatement` / `DocumentReference`, tagged external (see below) |
| Dental record (libs/dental) | `Procedure`, `CarePlan`, `Observation`, `DocumentReference` (see "Dental record") |
| Immunization (clinic) | `Immunization` (see "Immunizations") |
| Patient history (clinic) | `Procedure`, `Condition`, `MedicationStatement` (medications taken), `FamilyMemberHistory`, social-history `Observation` (see "Patient history") |

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

### Referrals

Each referral made from a consultation (`docs/domains/clinic.md`, "Referrals") is a `ServiceRequest`
(`libs/interoperability/src/lib/fhir/referrals.ts`, composed from `ClinicQueries.referralRecords`; merged records
included):

- `category` SNOMED CT `3457005` _Patient referral_ (text "Referral"); `intent` `order`; the referral number as
  identifier (`…/referral-number` in the organization's local namespace); `code` and `performerType` the specialty or
  service as the referrer wrote it (text only; no code set is assumed).
- `status`: sent and accepted → `active`; completed → `completed`; declined and cancelled → `revoked` (the platform's
  own status in a `note`).
- `priority` from the referrer's urgency: routine → `routine`, urgent → `urgent`, **emergency → `stat`**. R4 ranks
  `routine < urgent < asap < stat`; `stat` ("with the highest priority") is the only code that says the recipient should
  act immediately, which is what an emergency referral asks. The referrer's own word is also kept in a `note`, so a
  receiving system that ranks differently can read it.
- `subject`, `encounter` (the referring consultation), `authoredOn` (issued at), `requester` (the referring
  `Practitioner`); `performer`: the practitioner referred to (internal), or for an outside provider contained
  resources exactly as written (not verified): an `Organization` for the facility (or the provider when no facility is
  named; the contact as `telecom` `other`) and, when both are named, a `Practitioner` for the provider.
- `reasonCode` the reason in the referrer's words; `reasonReference` the diagnoses they listed (`Condition`); the
  clinical summary as a `note`; `supportingInfo` the letter (`referral_letter` document, same id as the referral) and
  the outside provider's reply document — only when those are exported too (`document.read`; never a dangling
  reference; a cancelled referral's letter is archived and not exported).
- `_lastUpdated` stays refused for `ServiceRequest` (a referral's status changes in place without a separate change
  time for everything shown).

### Performing laboratory (send-outs)

A released result performed by a reference laboratory ([reference-laboratories.md](reference-laboratories.md): the
result's `reference_laboratory_id` and `performing_laboratory`, migration `0047`) names it as the Observation's
`performer`: a **contained** `Organization` (`id` `reference-lab-{reference laboratory id}`, `type.text` "Reference
laboratory", `name` = the name the result was attributed to), referenced as `#reference-lab-…` with the name as
`display`. It is contained rather than a readable `Organization/{id}`: a reference laboratory is the organization's own
configuration record (nothing about it is verified), not a resource this server serves, so no new resource type, access
rule or audit action was added. Its accreditation / licence reference (as recorded by staff) is exported **only** as an
`identifier` whose system is configured in `FHIR_IDENTIFIER_SYSTEMS` under the key
`reference_laboratory_accreditation`; without that key the laboratory is exported by name only (no local namespace is
used: it would suggest the platform issued or verified the reference). The order's `DiagnosticReport` keeps the
organization as its first performer (it releases the report) and adds each reference laboratory that performed one of
its results (contained, the same way). In-house results are unchanged: `performer` → `Organization/{organization}`.

### Records from other systems (external-source tag)

Content accepted from FHIR imports (below, "Inbound") is exported, but never as the organization's own record. Every
such resource carries in `meta.tag` the platform-defined code

| `system`                                                              | `code`            | `display`                    |
| --------------------------------------------------------------------- | ----------------- | ---------------------------- |
| `{FHIR_IDENTIFIER_BASE}/{organization code}/codesystem/record-source` | `external-import` | Imported from another system |

— a local code system built like the platform's other local namespaces (`FhirContext.identifierBase`; e.g.
`https://api.example.ph/fhir/identifiers/demo/codesystem/record-source` by default). Resources recorded by staff carry
no tag.

- **Imported allergies** (`allergy_intolerance.source = external_import`): the tag, and `verificationStatus`
  `unconfirmed` whatever the row says. Everything else as for any allergy; entered in error as for any allergy.
- **External history** (`external_history_entry`, migration `0048`): additionally `meta.lastUpdated`
  (`entered_in_error_at`, else `recorded_at` — reliable, the table is append-only), `meta.source` = the sender's
  declared `Bundle.meta.source` when it is an absolute URI (as declared, **not verified**), and a first `note`
  "Imported from another system; not verified by this organization." Values are exported as they were kept (text as
  received); nothing is re-coded.

| Kind          | Exported as           | Details                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `condition`   | `Condition`           | `verificationStatus` **`unconfirmed`** (the sender's statuses in a note); `clinicalStatus` as received when it was a condition-clinical code; category `problem-list-item`/`encounter-diagnosis` as received (else text); code as received (system, code, name); onset as `onsetDateTime` when it is a FHIR dateTime, else `onsetString`. No encounter               |
| `observation` | `Observation`         | `status` **as received** (else `unknown`); category `laboratory`/`vital-signs` as received; code as received; the kept value text (value, interpretation, reference range) as `valueString`; `effectiveDateTime`. No performer, issued time, `basedOn` or encounter: never a released laboratory result or a vital sign set (the vital signs profile is not claimed) |
| `medication`  | `MedicationStatement` | Both received MedicationStatements and MedicationRequests ("prescribed elsewhere", said in a note): never a `MedicationRequest` of the platform. `status` as received when it is a MedicationStatement status, else `unknown` (the received one in a note); dosage text; `effectiveDateTime` (the statement's date or the request's authoring date)                  |
| `document`    | `DocumentReference`   | Metadata only: `status` as received, type as text, description, `date` (an instant), and one attachment whose `title` summarises the received attachments. No URL, data or `custodian` (the file was never fetched). Withheld with the documents from callers without `document.read`                                                                                |

**Entered in error:** an entry marked entered in error follows the rule for the platform's own records (as a diagnosis
in error): exported with the `entered-in-error` status (`verificationStatus` for a Condition, which then has no
`clinicalStatus`), still tagged.

### Dental record

`DentalRecordQueries` (libs/dental, unaudited; the controller audits) supplies every examination, procedure, treatment
plan and periodontal chart of the patient (including those entered in error), the **current derived chart** and the
dental image descriptions; `apps/api/src/app/fhir/fhir-record.ts` composes them into `DentalRecordSource`, and
`libs/interoperability/src/lib/fhir/dental.ts` maps them. A dental visit is a clinic encounter, so every dental resource
references the clinic `Encounter` and the dentist as a `Practitioner` (exported like every practitioner).

| Internal (libs/dental)                           | FHIR R4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Performed procedure (`dental_procedure`)         | `Procedure`: `completed` (entered in error → `entered-in-error`); `category.text` "Dental procedure"; `code` = the organization's procedure code (`…/codesystem/dental-procedure`, catalog name as display); `bodySite` = the tooth (`…/codesystem/fdi-tooth`) then each treated surface (`…/codesystem/tooth-surface`), none for a mouth-level procedure; `performer.actor` the dentist; `encounter`; `location` the facility; `performedDateTime`; `basedOn` → the `CarePlan` whose item it carried out; notes as `note`; `meta.lastUpdated` (reliable, see above)                                                                                                                                                                                                                                                                     |
| Treatment plan (`dental_treatment_plan` + items) | `CarePlan`, `intent` `plan`, `category.text` "dental". Status: proposed → `draft` (awaiting the patient's decision), accepted / in progress → `active`, completed → `completed`, declined / discontinued → `revoked` (which one, and the reason, in a `note`); the patient's decision note as a `note` (time = decided at). One `activity` per item: `detail.kind` `ServiceRequest`, `detail.code` the procedure code, `detail.description` "Phase 2: Crown — tooth 26. note", `detail.status` (proposed / accepted → `not-started`, completed → `completed`, declined / cancelled → `cancelled`) with the decision as `detail.statusReason` ("Awaiting the patient's decision", "Accepted by the patient", "Declined by the patient", "Cancelled"), and `outcomeReference` → the `Procedure` that carried it out. No prices (billing's) |
| Examination (`dental_examination`)               | `Observation` category `exam`, code `…/codesystem/dental-observation#dental-examination`, oral hygiene as a component (`…/codesystem/oral-hygiene` good / fair / poor), the notes as `note`; entered in error → `entered-in-error`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Current chart (derived, one state per tooth)     | One `Observation` per charted tooth (id = the tooth state row), category `exam`, code `dental-observation#tooth-state`, `bodySite` the tooth. A tooth charted with no findings has `valueCodeableConcept` `…/codesystem/tooth-condition#sound`; otherwise one `component` per finding and surface (code = the condition, `valueCodeableConcept` = the surface) or per whole-tooth finding (`valueBoolean` `true`). `derivedFrom` → the examination Observation, or `partOf` → the `Procedure` that left the state. Only the current chart is exported: states superseded later, or of an examination or procedure entered in error, are not (the tooth's history stays in the dental record)                                                                                                                                             |
| Periodontal chart (`dental_perio_*`)             | A panel `Observation` (code `dental-observation#periodontal-chart`, notes, `hasMember`) and one `Observation` per examined tooth (code `periodontal-tooth`, `bodySite` the tooth) whose components are `tooth-mobility` (Miller, integer), `furcation` (Glickman, integer) and per site (`MB B DB ML L DL`) `probing-depth-{site}` and `gingival-margin-{site}` (UCUM `mm`; margin positive = recession) and `bleeding-on-probing-{site}`, `plaque-{site}`, `suppuration-{site}` (boolean, as recorded). Derived values (attachment level, summaries, changes) are not exported: they follow from these, and the platform never stages or grades periodontitis. Entered in error → `entered-in-error` on the panel and its members                                                                                                       |
| Dental image (`dental_image` over a document)    | The document's `DocumentReference` (as every document, with `Binary/{id}` content) plus the kind as `category` (`…/codesystem/dental-image-kind`, e.g. `bitewing` "Bitewing radiograph"), the teeth in the `description` ("Bitewing right (teeth 16, 46, FDI)" — DocumentReference has no body site), `context.encounter` and `context.period.start` = the date taken. An image entered in error → `entered-in-error`                                                                                                                                                                                                                                                                                                                                                                                                                    |

Tooth findings are chart states, not diagnoses: they are never exported as `Condition` (a dentist's diagnoses are clinic
diagnoses of the dental visit and are exported as `Condition` like any other).

**Code systems.** No licensed dental code set is on record — not CDT (ADA), not SNOMED CT body-structure codes for
teeth, not PhilHealth dental benefit codes (see [dependencies.md](dependencies.md)) — so every dental code is a
platform-defined **local** code system under the organization's namespace, built like the others
(`{FHIR_IDENTIFIER_BASE}/{organization code}/codesystem/{key}`):

| Key                  | Codes                                                                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dental-procedure`   | The organization's procedure catalog codes (`dental_procedure_type.code`)                                                                                                                                         |
| `fdi-tooth`          | FDI / ISO 3950 two-digit tooth codes as stored (11–48, primary 51–85)                                                                                                                                             |
| `tooth-surface`      | `M` mesial, `D` distal, `O` occlusal, `I` incisal, `B` buccal / facial, `L` lingual / palatal                                                                                                                     |
| `tooth-condition`    | The charted conditions (`caries`, `restoration`, `sealant`, `fracture`, `crown`, `root_canal`, `missing`, `implant`, `pontic`, `impacted`, `unerupted`, `watch`) and `sound`                                      |
| `dental-observation` | `dental-examination`, `oral-hygiene`, `tooth-state`, `periodontal-chart`, `periodontal-tooth`, `tooth-mobility`, `furcation`, `{probing-depth, gingival-margin, bleeding-on-probing, plaque, suppuration}-{site}` |
| `oral-hygiene`       | `good`, `fair`, `poor`                                                                                                                                                                                            |
| `dental-image-kind`  | `periapical`, `bitewing`, `panoramic`, `cephalometric`, `occlusal`, `cbct`, `intraoral_photo`, `extraoral_photo`, `other`                                                                                         |

Each key can be pointed at another URI with `FHIR_CODE_SYSTEMS` (e.g. `{"dental-procedure": "<URI>"}`) — **only** when
the stored codes are that system's codes, e.g. an organization whose procedure catalog uses a licensed code set it holds
a licence for. The platform does not translate codes: exporting SNOMED CT tooth or surface codes would need a licensed
mapping from FDI numbers (a follow-up for an organization that licenses and configures SNOMED CT), so `fdi-tooth` stays
local unless a URI for FDI numbers themselves is designated.

**Access.** The dental record needs **`dental.record.read`** in addition to `interop.fhir.read` (the permission the
dental API requires; org_admin, dentist, dental assistant, physician and nurse hold it — grant it deliberately to an
integration account's role). Without it, `Procedure?patient=` is `403`, `$everything` leaves the dental Procedures,
CarePlans and Observations out, and `$everything`, `Observation?patient=` and `CarePlan?patient=` say so in an
`OperationOutcome` entry (`search.mode = outcome`, `suppressed`). Dental images are documents: they follow
`document.read` exactly like every other document (their `Binary` too), with or without the dental permission. No
new permission was added. Every access is audited as for other types (`fhir.search`, `fhir.patient-everything` with
the resource types and counts disclosed).

### Immunizations

`Immunization` (clinic, migration `0081`; [immunizations](../domains/immunizations.md)): `status` `completed`,
`not-done` (with `statusReason`: HL7 v3 ActReason `PATOBJ` refused, `MEDPREC` contraindicated, `OSTOCK` unavailable,
text only for "other", and the clinician's words as `text`) or `entered-in-error`; `vaccineCode` the catalogue code
under `FHIR_CODE_SYSTEMS[key]` when configured, else `{identifierBase}/codesystem/{key}` (default key `vaccine`), with
the name as `text` (an imported one keeps the sender's system URI); `occurrenceDateTime` at its precision (`2019`,
`2019-05`, a date, or an instant); `recorded`; `primarySource` true only for doses given here, else `reportOrigin` as
text (where the information came from); `location` the facility; `performer` the practitioner, or a display for a
reported giver; `lotNumber`, `expirationDate`, `site` and `route` as text, `doseQuantity`; `reaction.detail.display`
for a recorded reaction; `protocolApplied.doseNumberString` the dose as recorded (no series or target disease is
inferred). Imported records carry the external-source tag. Staff notes are never exported. No official vaccine code
set (CVX, a Philippine code set) is assumed: an organization licensed for one names its key and configures its URI.

### Procedures performed at the clinic

Procedures recorded in consultations (clinic, migration `0085`; [clinic](../domains/clinic.md) "Procedures") →
`Procedure` (`completed` / `entered-in-error`; category `{identifierBase}/codesystem/procedure-category#clinic-procedure`;
`code` the organization's own code under `…/codesystem/clinic-procedure` with the name as `text`, plus the other code of a
system the organization names when its catalogue gives one, under `FHIR_CODE_SYSTEMS[key]` or a local namespace;
`encounter`, `performer` (the practitioner who performed it), `location`, `performedDateTime`, `bodySite` as text, the
quantity as a note when more than one). The clinician's notes are not exported. `meta.lastUpdated` is when it was marked
entered in error, else when it was recorded (rows are immutable otherwise), so `_lastUpdated` applies. Exported to any
`interop.fhir.read` caller, like diagnoses; a Procedure search withholds only the dental ones from callers without
`dental.record.read`.

### Patient history

The patient history (clinic, migration `0082`; [patient history](../domains/patient-history.md)): **past procedures** →
`Procedure` (`completed`, or `entered-in-error`; category `{identifierBase}/codesystem/history-category#past-procedure`;
`code` the organization's code under its key, an import's under the URI as received, the name as `text`;
`performedDateTime` at its precision — omitted when not known; `asserter` the Patient when the patient reported it, a
display ("A relative of the patient", "Another healthcare provider") otherwise, or the documenting Practitioner;
`recorder` the Practitioner who recorded it; `performer` and `bodySite` as text; the source description as a note).
**Past conditions** → `Condition` with category `…/codesystem/history-category#past-medical-history`,
`verificationStatus` `unconfirmed` (or `entered-in-error`), `clinicalStatus` `active`/`resolved` as reported (none when
not known), `onsetDateTime` at its precision and a note that it is not a diagnosis made here — deliberately **not**
`problem-list-item` (the problem list is the diagnoses of consultations) nor `encounter-diagnosis`. **Medications
taken** (not prescribed here; migration `0083`) → `MedicationStatement` (`status` `active` while taken, `stopped`,
`unknown`, or `entered-in-error`; category `…/codesystem/history-category#medication-taken`; `medicationCodeableConcept`
the name as `text` with the organization's code when given; `effectivePeriod` start and end at their precisions;
`dateAsserted` when recorded; `informationSource` like a past procedure's `asserter`; `reasonCode` and `dosage.text` as
written; notes saying it is not a prescription of this organization, with who prescribed it or where it came from and
the source description; the note on marking it stopped is not exported). Never a `MedicationRequest`. **Family history**
→ `FamilyMemberHistory` (`completed` / `entered-in-error`; `relationship` in HL7 v3 RoleCode — MTH, FTH, SIS, BRO,
SIB, HSIB, DAUC, SONC, CHILD, MGRMTH, MGRFTH, PGRMTH, PGRFTH, MAUNT, MUNCLE, PAUNT, PUNCLE, COUSN, FAMMEMB for "other"
— with the relative as text; `deceasedBoolean` when stated; the condition with `onsetAge` in UCUM `a`; a cause of death
as a second condition with `contributedToDeath: true`); searchable by `patient` with `_lastUpdated`. The family history
review is not exported. **Social history** → one `Observation` per part of each version (`final`, or
`entered-in-error`; category `social-history`; code `…/codesystem/social-history#tobacco|alcohol|substance-use|occupation|occupational-exposure|living-situation|physical-activity|diet|sexual-history`;
tobacco and alcohol as `valueCodeableConcept` `…/codesystem/use-status#never|former|current|unknown` with the details
as text, the rest as `valueString`; `effectiveDateTime` the version's date; id `{version id}-{part}`). No LOINC or
SNOMED CT code is assumed for these. Substance use and sexual history are exported only to a caller with
`history.read` **and** `encounter.write`; otherwise they are left out with an informational notice (given only when the
patient has a social history, so it never tells whether anything sensitive is recorded). Reported entries carry
`meta.tag` `…/codesystem/record-source#reported`, imported ones `#external-import`. Staff notes are never exported. The
rest of the history is exported to any `interop.fhir.read` caller, like diagnoses and immunizations.

## Identifier and code systems

No official URIs for Philippine national identifiers are on record, so none are invented:

- The platform's own identifiers (patient number, facility code, order, prescription and referral numbers) use a local
  namespace: `FHIR_IDENTIFIER_BASE/{organization code}/…` (defaults to `{API origin}/fhir/identifiers`).
- National identifiers (PhilHealth PIN, PhilSys number, PRC license, facility license) default to
  `…/identifier/{type}` under that namespace until **configured** with `FHIR_IDENTIFIER_SYSTEMS`, a JSON map from the
  internal identifier type to the official URI, e.g. `{"philhealth_pin": "<official URI>"}`.
- Diagnosis coding keys other than ICD-10 map through `FHIR_CODE_SYSTEMS` in the same way.
- A reference laboratory's accreditation / licence reference is exported only with a system configured under
  `FHIR_IDENTIFIER_SYSTEMS.reference_laboratory_accreditation` (no local default; see "Performing laboratory").
- Platform-defined code systems use the same namespace: `…/codesystem/document-category`, `…/codesystem/lab-test`
  and `…/codesystem/record-source` (`external-import`, the tag of resources received from other systems), and the
  dental ones (`dental-procedure`, `fdi-tooth`, `tooth-surface`, `tooth-condition`, `dental-observation`, `oral-hygiene`,
  `dental-image-kind`; see "Dental record" — configurable through `FHIR_CODE_SYSTEMS`).
- `FHIR_BASE_URL` sets the public base used in `Bundle` links (defaults to the request URL).

## Not yet

Cursor (snapshot) paging; `_since` on `$everything` and `_lastUpdated` for the types above (each needs a reliable
change time first, e.g. database-maintained timestamps); `DocumentReference` for invoices and receipts (rendered on
request, not stored); `DiagnosticReport.presentedForm` for the archived report; `Binary` as a FHIR resource (only the native
content is served); laboratory result attachments (laboratory-managed documents, not exported yet); the dental tooth history (only the current chart is exported) and licensed dental codes (CDT, SNOMED CT tooth and surface codes); write/transaction; SMART on FHIR app authorization and patient-facing access; bulk data export;
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

| Received                                   | On accept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Not acceptable when                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Patient`                                  | Used to match (or register) the patient. Demographics of an existing patient are **never changed**. Identifiers are recognised only for systems configured in `FHIR_IDENTIFIER_SYSTEMS`; given names are kept together (FHIR does not say which is a middle name)                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                    |
| `AllergyIntolerance`                       | An **allergy** through the clinic's staff command (same validation, duplicate check, `allergy.add` audit): `source = external_import`, **always unconfirmed**, `source_reference = fhir-import:{id}#{entry}`. An active allergy to the same substance is never replaced (`409 allergy_exists`: reject the entry as already recorded)                                                                                                                                                                                                                                                                                   | Refuted or entered in error; inactive/resolved; "no known allergy" codes (NKA is only a staff review); no substance; another patient |
| `Condition`                                | **External history** (`external_history_entry`, kind `condition`): name, code, status and onset as sent. Not a diagnosis; no encounter is created. Deliberately not a past condition of the patient history: the sender's own statuses and categories do not fit a condition "as reported", and the external history already labels it                                                                                                                                                                                                                                                                                 | Refuted or entered in error; no name; another patient                                                                                |
| `Observation` (laboratory, vital signs)    | **External history** (kind `observation`, category as sent): value, interpretation, reference range as text. Never a laboratory result (released or not) or a vital sign set                                                                                                                                                                                                                                                                                                                                                                                                                                           | `entered-in-error`, `cancelled`; another patient                                                                                     |
| `MedicationStatement`, `MedicationRequest` | **External history** (kind `medication`, `reported` or `prescribed_elsewhere`): medication, dosage text, status. Never a prescription                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Entered in error; medication only by reference without a name; another patient                                                       |
| `DocumentReference`                        | **External history** (kind `document`): description, type, date and attachment metadata. The file is **not fetched or stored**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Entered in error; another patient                                                                                                    |
| `Procedure`                                | A **past procedure** of the patient history (`source = external_import`, import reference, declared source) through the clinic's command: the procedure as named and coded by the sender, the date part of `performedDateTime` / `performedPeriod.start` at its precision; a date given only as text or an age, and the outcome, kept as a note; performer and location displays; body site. Only `completed` procedures (migration `0082`; before, "not supported")                                                                                                                                                   | Not `completed`; no procedure named; another patient                                                                                 |
| `FamilyMemberHistory`                      | **Family history entries**, one per condition of the relative (`source = external_import`): the relationship when its HL7 v3 RoleCode is in the platform's list, else "other" with the text as written; age at onset when given in years, else the onset text as a note; `deceased[x]` as deceased; a condition with `contributedToDeath` is also the cause of death (migration `0082`; before, "not supported")                                                                                                                                                                                                       | Entered in error; no condition named (e.g. `health-unknown`: record the family history review instead); another patient              |
| `Immunization`                             | An **immunization record** (`source = external_import`, `source_reference = fhir-import:{id}#{entry}`, declared source) through the clinic's command: the vaccine as named and coded by the sender (never matched to the catalogue), the date at the precision sent (`occurrenceDateTime`, or an `occurrenceString` that is a FHIR date), `not-done` with the sender's reason, lot, expiry, route, site, amount, performer display; `primarySource: false` is kept as "Reported to the sender (reportOrigin)". Imported before migration `0081`, an Immunization was "not supported"; nothing already accepted changes | Entered in error; no vaccine; a date only in words ("childhood"); another patient                                                    |
| Anything else                              | Kept and shown as "not supported for import"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Always                                                                                                                               |

"Another patient": the entry's subject reference points to something other than the import's Patient (`fullUrl` or
`Patient/{id}`). With no subject reference, or no Patient in the import, the entry is acceptable with a note to check
it belongs to the matched patient.

External history appears on the patient record as **External history (imported)** (`GET /patients/{id}/external-history`,
`clinical.read`); imported allergies carry an "External record" badge. A mistaken acceptance is corrected by marking the
allergy entered in error (`allergy.manage`) or the external history entry entered in error (`interop.fhir.import.review`,
with a reason); nothing is deleted. Both are exported by the read interface with the external-source tag (see "Records
from other systems" above).
