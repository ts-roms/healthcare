# Patient Master (`libs/patient`)

## Purpose

The single canonical patient identity for an organization (CLAUDE.md §5–7):
registration, demographics, identifiers, contacts, addresses, relationships,
consent, communication preferences, lookup and duplicate detection, and the
patient's own **portal account** (sign-in to MyHealth).
**Not** responsible for clinical data (allergies, histories, encounters live in
`libs/clinic`) or billing.

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
| `patient_portal_account`           | One per patient: `invited` (hashed one-time code, expiry, attempts) → `active` (email, argon2id password, lockout) → `disabled` (who, when, reason). Email unique per organization                            |
| `patient_portal_session`           | Portal refresh sessions (hashed, rotated; reuse of a rotated token revokes the session)                                                                                                                       |

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
| Invite to portal / disable portal access                | Invite requires an active patient and granted `portal_access` consent; returns the activation code once. Disable requires a reason and revokes all portal sessions. See `docs/architecture/portal-app.md`                                                                                                                |
| Portal activate / login / refresh / logout              | Patient-facing, `@Public()` to the staff guard, protected by `PatientAccessGuard` (session, account and consent re-checked on every request). Rate-limited; failures audited                                                                                                                                             |

## Queries

- **Lookup** `GET /patients`: `q` is interpreted as patient number (`P123`),
  phone (any PH format) or name (trigram, accent-insensitive: "pena" finds
  "Peña"); plus birth date and identifier filters. Returns summaries with masked
  mobile only. Inactive and merged records are hidden unless `includeInactive=true`.
- **Duplicate check** `POST /patients/duplicate-check`.
- **Detail** `GET /patients/:id` (audited view), **consent history**.
- **Portal account status** `GET /patients/:id/portal-account` (`patient.read`), **portal profile** `GET /portal/me` (the signed-in patient's identity only).
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
`patient.update`, `patient.consent.manage`, `patient.portal.manage` (invite and
disable portal accounts; org admin, receptionist, records officer).

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
- Portal: no self-service password reset, email verification, patient MFA, or
  guardian/dependent proxy access yet. One portal deployment serves one
  organization (`PORTAL_ORGANIZATION_CODE`).
