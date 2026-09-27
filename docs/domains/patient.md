# Patient Master (`libs/patient`)

## Purpose

The single canonical patient identity for an organization (CLAUDE.md §5–7):
registration, demographics, identifiers, contacts, addresses, relationships,
consent, communication preferences, lookup and duplicate detection.
**Not** responsible for clinical data (allergies, histories, encounters —
Phase 2), billing, or portal accounts.

## Entities

| Table                              | Notes                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `patient`                          | Demographics, `patient_number` (P + 8 digits, per-organization sequence), normalized name columns for search, status (`active`, `inactive`, `deceased`, `merged`), `version`                                  |
| `patient_identifier`               | PhilHealth PIN, PhilSys number, Senior Citizen ID, PWD ID, passport, driver's license, HMO member ID (issuer required), external MRN. An active `(type, issuer, normalized value)` is unique per organization |
| `patient_contact_point`            | mobile / phone / email; one active primary per system; mobiles stored as E.164                                                                                                                                |
| `patient_address`                  | Philippine format: line1, barangay, city/municipality, province, region, 4-digit postal code, optional PSGC code                                                                                              |
| `patient_relationship`             | Family, guardians, dependents and emergency contacts; may link another patient                                                                                                                                |
| `patient_consent`                  | Append-only decisions per consent type; current = latest                                                                                                                                                      |
| `patient_communication_preference` | Opt-in/out per channel × category                                                                                                                                                                             |

Sub-records are **retired**, never deleted. `merged_into_patient_id` exists so
merging can be added without schema changes.

## Commands

| Command                                                 | Rules                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Register                                                | Requires facility context. Runs duplicate detection in the transaction: shared identifier → `409 identifier_in_use` (no override); high/possible matches → `409 possible_duplicates` unless every candidate id is listed in `duplicateOverride.reviewedCandidateIds` with a reason (audited). Supports `Idempotency-Key` |
| Update demographics                                     | Optimistic lock on `version`; field-level diff audited                                                                                                                                                                                                                                                                   |
| Change status                                           | active / inactive / deceased (requires `deceasedAt`); reason required                                                                                                                                                                                                                                                    |
| Add / retire contact, address, identifier, relationship | Primary handling; identifiers unique; retire requires reason                                                                                                                                                                                                                                                             |
| Record consent                                          | Append-only; optional link to a consent document                                                                                                                                                                                                                                                                         |
| Set communication preferences                           | Upsert; before/after audited                                                                                                                                                                                                                                                                                             |

## Queries

- **Lookup** `GET /patients`: `q` is interpreted as patient number (`P123`),
  phone (any PH format) or name (trigram, accent-insensitive: "pena" finds
  "Peña"); plus birth date and identifier filters. Returns summaries with masked
  mobile only. Inactive and merged records are hidden unless `includeInactive=true`.
- **Duplicate check** `POST /patients/duplicate-check`.
- **Detail** `GET /patients/:id` (audited view), **consent history**.
- `resolveContact` — used by notifications through the app's `RecipientDirectory`.

## Duplicate detection policy

`duplicate-detection.ts` (unit-tested):

| Level    | Signals                                                                                  |
| -------- | ---------------------------------------------------------------------------------------- |
| certain  | Same active identifier                                                                   |
| high     | Same/similar name (trigram ≥ 0.55) and same birth date; or same contact and birth date   |
| possible | Similar name with day/month transposed; very similar name (≥ 0.8) in the same birth year |

## Communication policy

`communication-policy.ts`: recorded preference wins; without one, clinical and
administrative messages are allowed and outreach requires opt-in; deceased and
merged records are never contacted; inactive patients get no outreach.

## Events

None published yet. Planned: `PatientRegistered`, `PatientDemographicsChanged`,
`PatientMerged` (via outbox).

## Permissions

`patient.search`, `patient.read`, `patient.register` (+ facility context),
`patient.update`, `patient.consent.manage`.

## Integration points

- Documents reference patients by FK (`document.patient_id`); consent may link a document.
- Notifications resolve patient destinations via `PatientRecordService.resolveContact`.
- FHIR `Patient` mapping belongs in `libs/interoperability` (Phase 8).

## Open questions / assumptions

- Patient number format `P########` is a placeholder; organizations may need their own format.
- `sex` captures sex assigned at birth (`male`, `female`, `intersex`, `unknown`); gender identity is free text.
- Identifier formats are normalized but not validated against issuer rules
  (e.g. PhilHealth PIN check digits) until official specifications are confirmed.
- Patient merge (with survivor selection and record re-pointing) is not implemented.
