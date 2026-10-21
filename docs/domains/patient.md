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
| `patient_merge`                    | Append-only merge history (migration 0068): `merged` (with the retired record's previous status), `unmerged`, `repointed` (chains kept flat); reason, who, when, a small snapshot of what was reviewed        |

Sub-records are **retired**, never deleted. A merged record has `status = 'merged'` and `merged_into_patient_id` = its
survivor (see [Patient merge](#patient-merge-link-dont-move)).

## Commands

| Command                                                 | Rules                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Register                                                | Requires facility context. Runs duplicate detection in the transaction: shared identifier → `409 identifier_in_use` (no override); high/possible matches → `409 possible_duplicates` unless every candidate id is listed in `duplicateOverride.reviewedCandidateIds` with a reason (audited). Supports `Idempotency-Key` |
| Update demographics                                     | Optimistic lock on `version`; field-level diff audited                                                                                                                                                                                                                                                                   |
| Change status                                           | active / inactive / deceased (requires `deceasedAt`); reason required                                                                                                                                                                                                                                                    |
| Add / retire contact, address, identifier, relationship | Primary handling; identifiers unique; retire requires reason                                                                                                                                                                                                                                                             |
| Record consent                                          | Append-only; optional `documentId`, which must be this patient's uploaded `consent_form` document (else `422 consent_document_invalid`). Migration 0014 also enforces the same patient with a composite foreign key                                                                                                      |
| Set communication preferences                           | Upsert; before/after audited. The patient sets text message and email choices through MyHealth (`PUT /portal/communication-preferences`, `portal.communication-preferences`); each row keeps the last setter (staff user or portal account, exactly one) — see `docs/architecture/portal-app.md`                         |
| Invite to portal / disable portal access                | Invite requires an active patient and granted `portal_access` consent; returns the activation code once. Disable requires a reason and revokes all portal sessions. See `docs/architecture/portal-app.md`                                                                                                                |
| Portal activate / login / refresh / logout              | Patient-facing, `@Public()` to the staff guard, protected by `PatientAccessGuard` (session, account and consent re-checked on every request). Rate-limited; failures audited                                                                                                                                             |
| Merge / unmerge                                         | `patient.merge`; see [Patient merge](#patient-merge-link-dont-move)                                                                                                                                                                                                                                                      |

## Queries

- **Lookup** `GET /patients`: without any criterion, the organization's patients in name order (paged; audited as
  `queryKind: browse`); `q` is interpreted as patient number (`P123`),
  phone (any PH format) or name (trigram, accent-insensitive: "pena" finds
  "Peña"); plus birth date and identifier filters. Returns summaries with masked
  mobile only. Inactive and merged records are hidden unless `includeInactive=true`. A patient number, phone or
  identifier held by a merged record resolves to its survivor (`resolvedFrom: { id, patientNumber }` on the row).
- **Duplicate check** `POST /patients/duplicate-check`.
- **Detail** `GET /patients/:id` (audited view), **consent history**. A retired record is returned read only with
  `mergedInto`; a survivor lists `mergedRecords` (id, number, name, when and by whom).
- **Merge preview** `GET /patients/:id/merge-preview?into=`, **merge history** `GET /patients/:id/merges`.
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

Duplicate detection resolves an identifier or contact still held by a merged record to its survivor (the candidate
carries `resolvedFrom`), so registering someone with a retired record's PhilHealth PIN finds the surviving record
(`identifier_in_use`).

## Patient merge (link, don't move)

Decision: [ADR-0009](../architecture/decisions.md#adr-0009-patient-merge-link-dont-move). Merging a duplicate never
rewrites what is filed under it. The duplicate (the **retired** record) gets `status = 'merged'` and
`merged_into_patient_id` = the **survivor**; every patient view reads the survivor's records and those of every record
merged into it, and marks rows filed under another number. An unmerge is exact because nothing moved.

**Preview** (`GET /patients/:id/merge-preview?into=:survivorId`, `patient.read` + `patient.merge`, audited
`patient.merge-preview`): both records side by side (demographics, identifiers, contacts, MyHealth account, current
consent, records already merged into each), `ineligibility` (same record, other organization, retired already
merged, survivor merged), flagged `differences` (family/given/middle name and suffix — case and accents ignored —,
birth date, sex, deceased vs not, identifiers of the same type and issuer with different values), `blockers` and
`warnings` from the `PatientMergeContext` port (adapter `apps/api/src/app/adapters/patient-merge-adapters.ts`), the
MyHealth handling and the records that will be re-pointed. Pure rules in `merge/patient-merge.rules.ts` (unit-tested).

| Work under the record to retire                                      | Kind                                                       | Why it blocks                                                                                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Encounter in progress (in person or online)                          | `encounter_in_progress`, `online_consultation_in_progress` | New notes, orders and prescriptions cannot be filed under it                                                           |
| Queue visit not ended                                                | `queue_visit`                                              | Triage and the consultation would start under it                                                                       |
| Booked or confirmed appointment not yet ended                        | `upcoming_appointment`                                     | Reminders are never sent to a merged record; check-in refused                                                          |
| Laboratory order still active (to collect, receive, result, release) | `lab_order_open`                                           | Results would be released to a retired record                                                                          |
| Draft invoice; charge not yet invoiced                               | `draft_invoice`, `uninvoiced_charge`                       | Invoices of the survivor cannot take the retired's charges                                                             |
| Deposit or credit balance at a facility                              | `account_balance`                                          | Applying and refunding use one record's own ledger                                                                     |
| Active care plan                                                     | `care_plan_active` (warning only)                          | Stays under the retired number; its reminders are not sent                                                             |
| Open referral (sent or accepted)                                     | `referral_open` (warning only)                             | Stays under the retired number (its letter names it); answers and replies are still recorded; no new referral under it |

**Merge** (`POST /patients/:id/merge`, body `survivorPatientId`, `reason`, `retiredVersion`, `survivorVersion`,
`acknowledgedDifferences`): refused unless both records are in the caller's organization (404 otherwise), neither is
merged, the versions match (`409 version_conflict`), every flagged difference is acknowledged
(`422 differences_not_acknowledged`) and no blocker remains (`409 merge_blocked` with the blockers). In one
transaction (both rows locked in id order): the `merged` history row with the retired record's previous status and a
snapshot (numbers, versions, differences, acknowledgements, MyHealth handling); records merged into the retired
record re-pointed to the survivor (`repointed` rows naming the merge — chains stay flat, a deferred check in the
database enforces it); the retired record set `merged`; both versions bumped; MyHealth: an account only the retired
record has moves to the survivor (sessions revoked; the survivor's consent governs), with two accounts the retired
one is disabled (reason `merged`); `PatientMerged` recorded (ids only); `patient.merge` audited on both records with
the reason.

Identifiers, contacts, addresses, relationships, consents and communication preferences stay on the retired record
as history; the survivor's current consent and preferences govern. An identifier the retired record holds stays
active there, so it cannot be added to the survivor as well (`identifier_in_use`).

**Unmerge** (`POST /patients/:id/unmerge`, `reason`): only while the record is merged (its latest history entry is
`merged` or `repointed`). Restores the status stored with its latest merge, clears the link, re-points back the
records that the merge had re-pointed (if that is still their latest history), moves a MyHealth account that was
moved at the merge back (if it is still on the survivor; sessions revoked), records `PatientUnmerged`, audits
`patient.unmerge` on both records. **Records created on the survivor after the merge stay on the survivor**; staff
check and correct them.

**Writes to a merged record.** The Patient Master refuses its own changes (`422 patient_merged`, details
`survivorPatientId`). New care filed under a merged record is refused by the database (migration 0068 trigger on
appointments, waitlist, visits, triage, vitals, allergies and allergy reviews, encounters, prescriptions, care plans,
laboratory orders, dental examinations, plans, images and periodontal charts, imported history, PhilHealth answers
and package enrollments; SQLSTATE `PM001` → `422 patient_merged`), and staff uploads by the documents service.
Corrections to what already exists (amendments, entered in error, results of work finished before the merge, billing
of existing charges, generated reports) are not refused.

**Reading linked records.** Domains read "the ids filed as this patient" through `filedAsPatient(column, patientId)`
from `libs/core` (the SQL function `patient_record_ids`); counts of distinct patients use `canonicalPatientId`.
Portal ownership checks use `isFiledAs` — documents, and also acting on what the retired record holds: paying one of its
invoices online (the new payment is recorded under the survivor), reading a payment started before the merge and
deciding one of its dental plans (`apps/api/test/patient-merge-portal-actions.int.spec.ts`). The API composers mark rows: timeline entries and Patient 360
panels carry `filedUnder` (the retired patient number), the summary lists `linkedRecords`, domain rows keep their
`patientId`.

## Guardian access (migration 0080)

`portal_proxy_grant` (guardian and dependent patients of one organization, relationship, basis, scopes `view`/`act`, what was checked, granter, optional end
date, revocation with reason and who ended it; one live grant per pair; append-only in practice: ended grants stay). `PortalProxyService` in
`libs/patient/src/lib/proxy`: `actingFor` (per request, used by `PatientAccessGuard` with `X-Acting-For` on `@ProxyAllowed()` routes), the account holder's
`dependentsOf`/`guardiansOf`/`endByPortal` (`/portal/proxy/*`, own account only) and the clinic's `overview`/`grant`/`revoke`
(`/patients/:id/portal-proxies`). Rules and the reasons access stops are in `docs/architecture/portal-app.md` ("Guardians and dependents"). Conversation
messages carry `via_guardian`.

## Consents recorded by the patient (migration 0069)

A `patient_consent` decision is recorded by exactly one of a staff user (`recorded_by`) or the patient's MyHealth account
(`recorded_by_portal_account`); a patient's account records only electronic withdrawals (CHECK constraints). MyHealth
(`GET /portal/consents`, `POST /portal/consents/:type/withdraw`; `libs/patient/src/lib/consents`) lists each consent with its
history and withdraws those in `PATIENT_WITHDRAWABLE_CONSENTS` while in effect; withdrawing `portal_access` revokes the account's
sessions in the same transaction. Staff views carry `recordedVia` (`staff` | `myhealth`).

## Patient QR codes (migration 0117)

A QR code on a patient card or wristband that staff scan to open the record or check the patient in. `libs/patient/src/lib/qr`.

- **Setting** (`patient_qr_setting`, per organization, versioned; `GET|PUT /patient-qr/setting`, read with `patient.search`, changed with `patient.qr.manage`, org_admin; audited `patient.qr-setting.update`): `enabled` (**off by default**), `issueAtRegistration`, and `content`: `token` (an opaque random key of 128 bits, the default), `patient_number`, or `portal_link` (migration 0118; below). The choice applies to codes issued from then on; each code records what it holds.
- **What a code holds** is only a key, in a version-tagged text (`HPQ1:T:<26 base32 characters>` or `HPQ1:N:<patient number>`). Never a name, birth date, contact, PhilHealth PIN, diagnosis or result, and no URL (so nothing reaches browser history, access logs or referrers). Nobody can read patient details from a card; a scan only helps a signed-in member of staff find the record. **A code grants no access by itself**, to staff screens or to MyHealth.
- **Codes** (`patient_qr_code`, append-only; the one allowed change is active → revoked, by trigger; one active code per patient; refused under a merged record): issued at registration (`RegisterPatientDto.issueQrCode`, default the organization's setting, ignored while QR codes are off; the response says `qrCodeIssued`) or from the patient record (`POST /patient-qr/patients/:id`, `patient.qr.issue` + `patient.read`: org_admin, receptionist, records_officer, nurse), revoked with a reason (`POST …/revoke`; a lost card), replaced by issuing again. History stays on the record. The stored key is meaningless without access to the platform; a patient-number code is accepted by a scan only while the patient has an active code (revoking stops the platform accepting it, but anyone can make a number code from the number, which is why the key is the default).
- **Card**: `GET /patient-qr/patients/:id/card.pdf` (`libs/pdf` `renderQrCards`, ID-1 size; organization name, patient name and number; the QR symbol; `qrcode` supplies the matrix) is audited `patient.qr.print`; staff patient record, **MyHealth** tab → **Patient QR code** (view, print, revoke, issue).
- **Scan**: `POST /patient-qr/scan` (`patient.search`; body `{ payload }`) answers the minimal patient summary (a merged record resolves to its survivor, with `resolvedFrom`) or `qr_not_recognised`, `qr_disabled`, `qr_revoked` (422) / 404. Audited `patient.qr.scan` (success, or denied with the reason). **Neither payloads nor keys are written to the audit trail, logs or events.** Staff `/patients/scan` (hand-held scanner into the field, or the browser's camera where `BarcodeDetector` exists) lands on **Open record** and **Check in**; **Scan QR code** on `/patients`.
- Events (outbox, ids only): `PatientQrIssued`, `PatientQrRevoked` (`qrCodeId`, `patientId`).
- Staff: `/admin/patient-qr` (setting), the **Patient card** choice on `/patients/new` (shown only while on).
- **MyHealth link** (content `portal_link`, migration 0118; needs `PORTAL_BASE_URL` for the API, else `422 portal_link_unavailable`): the QR symbol is `<portal>/activate#HPQ1:T:<key>`, the key in the URL fragment, which browsers never send to a server or log. The patient scans the card with their phone; MyHealth `/activate` reads the fragment (and clears it from the address), asks `POST /portal/auth/activation-card` (public, throttled, `{ organizationCode, payload }`) and shows "Hello, <first name>" with the patient number filled in (read-only). That answers only while the clinic's invitation is open (the patient `invited`, the activation code unexpired) and only with the patient number and first name; every other case is the same `404` (audited `portal.activation-card`, never the key). **The card alone opens nothing**: activation still requires the date of birth and the one-time activation code the clinic gives (`patient.portal.manage` invite, requires `portal_access` consent), and the patient then chooses their own email and password as before. Staff scanners read the same link. Passkeys, the mobile app and a card for a guardian are not covered.
- Not built: scanning from the mobile app (the phone's camera opens the website; the app can be added to open this link).
- Rules the organization decides: who may carry a card for a patient (a minor, a dependent), how cards are handed out and replaced, whether wristbands are used, and how an unrevoked lost card is treated; no national identifier or card format is assumed.

## Events

`PortalProxyGranted` / `PortalProxyEnded` (guardian access; ids only). `PatientConsentWithdrawn` (recorded in MyHealth; ids and the consent type only). `PatientQrIssued` and `PatientQrRevoked` (ids only). `PatientMerged` and `PatientUnmerged` (outbox; aggregate: the retired record; payload: merge/unmerge id, retired and
survivor ids, re-pointed ids). No handler subscribes yet. Planned: `PatientRegistered`, `PatientDemographicsChanged`.

## Permissions

`patient.search`, `patient.read`, `patient.register` (+ facility context),
`patient.update`, `patient.consent.manage`, `patient.portal.manage` (invite and
disable portal accounts; org admin, receptionist, records officer), `patient.portal.proxy.manage` (give and end guardian access; same roles; migration 0080), `patient.merge`
(merge and unmerge; org admin, records officer; migration 0068), `patient.qr.issue` (issue, print and revoke a patient QR code; org admin, receptionist, records officer, nurse) and `patient.qr.manage` (the organization's QR setting; org admin; migration 0117).

## Integration points

- Documents reference patients by FK (`document.patient_id`); consent may link a document.
- Notifications resolve patient destinations via `PatientRecordService.resolveContact`.
- FHIR `Patient` mapping belongs in `libs/interoperability` (Phase 8).
- The patient timeline (`GET /patients/:id/timeline`) is composed in the API from every domain's timeline read query; see [patient-timeline.md](patient-timeline.md).

## Open questions / assumptions

- Patient number format `P########` is a placeholder; organizations may need their own format.
- `sex` captures sex assigned at birth (`male`, `female`, `intersex`, `unknown`); gender identity is free text.
- Identifier formats are normalized but not validated against issuer rules
  (e.g. PhilHealth PIN check digits) until official specifications are confirmed.
- Merging never moves records, so a domain's own write paths keep the retired id (e.g. amending an old note). Reads
  of a retired record show only its own records; its timeline and Patient 360 open the survivor's in the staff app.
- Care plans left active under a retired record keep their activities but are not reminded; the preview warns.
- Portal: guardian and dependent access exists as clinic-recorded proxy grants (migration `0080`,
  `docs/architecture/portal-app.md`). One portal deployment serves one
  organization (`PORTAL_ORGANIZATION_CODE`).
- MyHealth offers withdrawal of telemedicine, HMO and PhilHealth data sharing, research and portal access consents only; data processing and
  general treatment consent are withdrawn at the clinic (assumption to confirm with the organization's data protection officer). Patients may
  give the same four online, but only against the organization's own wording (`consent_text`, migration `0078`; the platform ships none) and only while it
  offers them; the consent records the wording version. See `docs/architecture/portal-app.md`.
