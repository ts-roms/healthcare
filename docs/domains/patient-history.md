# Patient history (medical, surgical, medications taken, family and social)

## Purpose

The patient's background as one longitudinal record (root `CLAUDE.md` §6): **past procedures and surgeries**, **past
conditions diagnosed elsewhere**, **medications taken** that were not prescribed here, **family history** with its review state, and **social history** kept as versions.
What the patient, a relative or another provider **reported**, what a clinician **documented here** from records they
saw, or what staff **accepted from a FHIR import**.

It is not a clinical judgement of the organization and never scores, classifies or infers anything: no risk
calculation, no pack-years, no hereditary-risk rule, no alert. In particular:

- a **past condition is never a diagnosis**. The problem list is the diagnoses recorded in consultations (`diagnosis`,
  `is_chronic`, status active/resolved); a past condition is a separate, labelled entry with the status **as reported**,
  never billed, never matched by DOH reporting rules and never shown as a problem-list item (FHIR: local category,
  `unconfirmed`);
- a **past procedure is not a procedure performed by the organization**: procedures done here are dental procedures
  (`libs/dental`) and procedures recorded in consultations (`clinic_procedure`, [clinic](clinic.md) "Procedures");
- a **medication taken is never a prescription** of the organization: it is not dispensed, billed or charged, is not
  checked by drug–allergy decision support (names are as written; no drug terminology is assumed) and is exported as a
  `MedicationStatement`, never a `MedicationRequest`. Prescriptions issued here stay in `libs/prescription`.

**Placement.** The history lives in `libs/clinic` (`src/lib/history`), next to allergies and immunizations: it is
taken at triage and in the consultation (entries may be linked to the encounter), read in the encounter workspace and
Patient 360, and needs the clinic's encounters and practitioners. A separate library would have needed ports back
into the clinic. Staff names come through the same adapter as immunizations (`HISTORY_STAFF_NAMES`, provided with
`useExisting: IMMUNIZATION_CONTEXT`).

## Entities

All rows carry `organization_id` and `patient_id` (composite same-organization FK to `patient`) and, when taken in a
consultation, `encounter_id` (same-patient FK `(patient_id, encounter_id)` → `encounter`). Migration `0082`.

- **`past_procedure`** — the procedure as written (`description`), an optional code with a code-system key of the
  organization (or the system URI as received for an import; no national code set), when it was done at the precision
  known (`performed_date` + `performed_precision` `year` | `month` | `day`; a year is kept as 1 January, a month as its
  first day; unknown: both null; never in the future in the facility's time zone), where/by whom as reported
  (`performer`), laterality or body site as written, staff notes, `source` `reported` (with `reported_by` `patient` |
  `relative` | `other_provider`) | `recorded_here` | `external_import` (import reference and declared source), an
  optional "where the information comes from" text, and the recording clinician's practitioner record (`recorder`).
- **`past_condition`** — the condition as written, optional code, onset at the precision known, `reported_status`
  `active` | `resolved` | `unknown` (as reported), where it was diagnosed or treated, notes, `source` `reported` |
  `recorded_here`, recorder.
- **`reported_medication`** (migration `0083`) — a medicine the patient takes that was **not prescribed here**
  (prescribed elsewhere, over the counter, a supplement or a traditional remedy): the medicine as written
  (`medication`, e.g. "Losartan 50 mg tablet", "Lagundi syrup"), an optional code, how it is taken as said
  (`dose_text`), what for (`reason`), who prescribed it or where it came from (`prescribed_by`), since when
  (`started_date` + precision), `reported_status` `taking` | `stopped` | `unknown` as reported when recorded, when it was
  stopped (`stopped_date` + precision; only for a medicine recorded as stopped, or later when marked stopped), notes,
  `source` `reported` (by whom) | `recorded_here`, recorder; and, once, **marked stopped** after it was recorded
  (`stop_recorded_at`/`_by`, an optional `stop_note`, the stop date as known) — not for a medicine recorded as stopped.
  The status as it stands is `stopped` once marked stopped, otherwise as reported. A stop date is not before the start
  at the precisions known ("2019" may follow "May 2019"; checked by the API, `stop_before_start`); neither is in the
  future.
- **`family_history_entry`** — the relative from a fixed clinical list (mother, father, sister, brother, sibling,
  half-sibling, daughter, son, child, maternal/paternal grandmother and grandfather, maternal/paternal aunt and uncle,
  cousin, other) plus free text (detail, or who for "other" — required then), the condition as written with an optional
  code, age at onset, deceased (null: not stated) and the cause of death (only for a relative who died), notes,
  `source` `reported` (by whom) | `external_import`.
- **`family_history_review`** — append-only: the family history was asked about with the outcome `reviewed` (complete
  as listed), `none_known`, or `unknown` with the reason `adopted` | `not_known` | `declined_to_answer`; optional
  note and encounter.
- **`social_history`** — one **version** = a whole snapshot with an `effective_date` (the day the information was given,
  facility time zone; never in the future, never before the version it replaces) and `supersedes_id` (the version it
  replaced): tobacco (`never` | `former` | `current` | `unknown`, type and amount as text for former/current use, the
  year stopped for former use), alcohol (status, frequency as text), **other substance use** (sensitive), occupation
  and occupational exposures, living situation / household, physical activity, diet, **sexual history** (sensitive),
  notes. At least one part is recorded.

Every row of `past_procedure`, `past_condition`, `family_history_entry` and `social_history` is immutable except being
marked **entered in error** once with a reason (`patient_history_guard` trigger; no DELETE or TRUNCATE); a
`reported_medication` also accepts being marked stopped once (`reported_medication_guard`); a correction is
the mistake marked in error plus a new entry. Reviews are append-only (`prevent_mutation`). New rows are refused under a
merged patient record (`PM001` → `422 patient_merged`, ADR-0009); reads include records merged into the patient
(`filedAsPatient`), each row keeping the record it is filed under.

### States

- **Family history**: `recorded` when any entry is not in error (whatever the latest review says); otherwise the latest
  review's answer — `none_known` ("No known family history", only ever after a recorded review, like allergies) or
  `unknown` (with the reason); otherwise `not_recorded` ("Family history not recorded — ask the patient"). A review that
  contradicts the list is refused (`family_review_conflict`: "none known" while entries are listed, "reviewed" with
  nothing listed).
- **Social history**: the current version is the latest recorded that is not in error. A new version is recorded on top
  of the current one (`basedOn`, its id, or null for the first): fields given replace, `null` clears, fields left out
  are carried over; details a status no longer allows are dropped (tobacco type/amount unless former/current, the year
  stopped unless former, alcohol frequency unless former/current). Recording on a stale version is refused
  (`409 social_history_changed`; also enforced by a unique index on `supersedes_id` among versions not in error), as is
  a version identical to the current one (`social_history_unchanged`). A version marked in error stops being current:
  the previous one is current again and may be replaced again.

## Sensitive parts

Substance use and sexual history are **sensitive**. The API shows them only to users who hold `history.read` **and**
`encounter.write` (the clinicians who write consultation notes: physicians and dentists by default, organization
administrators); for everyone else they are `null` with `sensitiveWithheld: true` — the response never says whether
anything is recorded. Such users can record new versions; the sensitive parts are then carried over unchanged (sending
them is refused `403`). They never appear in patient notices, the timeline, dashboards, search or audit metadata
(audits of a new version list the **names** of the fields that changed, never values). They are shown to the patient
themself in MyHealth (it is their record, marked "private"), never to a guardian acting for them, and included in a
copy of the record prepared for the patient's own request. FHIR exports them only to a caller with the same two
permissions (withheld otherwise, with a notice that does not say whether any exist). How the organization handles
sensitive personal information under the Data Privacy Act is its own policy (compliance register).

## Commands

| Command                   | Preconditions                                                                                                                              | Result                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Record a past procedure   | `history.record`; reported (who) or documented here; partial date not in the future; encounter (if any) of the patient                     | `PatientHistoryRecorded` (section `procedure`); audited `history.record`                                        |
| Record a past condition   | as above, with the status as reported                                                                                                      | `PatientHistoryRecorded` (`condition`)                                                                          |
| Record a medication taken | as above, with the status as reported; a stop date only when stopped, not before the start                                                 | `PatientHistoryRecorded` (`medication`)                                                                         |
| Mark a medication stopped | `history.record`; taken or not known, not marked stopped before, not in error; stop date not in the future nor before the start            | `PatientHistoryMedicationStopped`; audited `history.medication-stopped` (status from → `stopped`)               |
| Answer in MyHealth        | A MyHealth session with portal consent (a guardian needs `act`); entries as reported by the patient or a relative, dates not in the future | `PatientHistoryRecorded` per entry; audited `history.record` (`recordedVia`) and `portal.health-history-submit` |
| Stop a medicine (patient) | The patient's own MyHealth entry, not stopped, not in error; stop date rules as above                                                      | `PatientHistoryMedicationStopped`; audited `history.medication-stopped` as the patient                          |
| Record a relative's entry | `history.record`; relative ("other" needs the text); cause of death only when deceased                                                     | `PatientHistoryRecorded` (`family`)                                                                             |
| Review the family history | `history.record`; no contradiction with the list; the reason when not known                                                                | `PatientHistoryRecorded` (`family_review`); audited with the outcome                                            |
| Record a social history   | `history.record`; `basedOn` is the current version; sensitive parts only with `encounter.write`                                            | `PatientHistoryRecorded` (`social`); audited with the changed field names                                       |
| Mark entered in error     | `history.record`; not already in error                                                                                                     | `PatientHistoryEnteredInError`; audited `history.entered-in-error` with the reason                              |
| Accept an imported entry  | FHIR import review (`interop.fhir.import.review`), patient matched; Procedure `completed`; FamilyMemberHistory with a named condition      | `recordImportedProcedureIn` / `recordImportedFamilyIn` in the review transaction, `source = external_import`    |

## Queries

- `history(actor, patientId)` — every section (entries in error listed, marked), family state and reviews, social
  versions with the current one; one `history.view` audit per read (counts, whether sensitive parts were shown).
- `patientRecord(organizationId, patientId)` — every row, for the FHIR export and the copy of the record (callers audit).
- `patientView(…, { sensitive })` — MyHealth: entries not in error, the family state and the current social history;
  no staff notes, no one's names, no import references.
- `workspace(…, limit, { sensitive })` — Patient 360: the latest procedures and conditions, medications taken (not
  stopped, not in error; also shown under "Also taking" in the active medications panel), family state and entries,
  and the current social history (tobacco, alcohol, occupation; sensitive parts only with the permission).

## Events

`PatientHistoryRecorded` `{ entryId, section }`, `PatientHistoryMedicationStopped` `{ entryId, section: "medication" }`
and `PatientHistoryEnteredInError` `{ entryId, section }` (outbox, ids and
the section only — never content). No handler subscribes yet.

## Permissions

| Permission       | Default roles                                         | Allows                                                                                                                         |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `history.read`   | physician, nurse, dentist, records_officer, org_admin | Read the history (substance use and sexual history also need `encounter.write`)                                                |
| `history.record` | physician, nurse, dentist, org_admin                  | Record entries (and mark medications taken stopped), family reviews and social history versions; mark entries entered in error |

Organization-scoped (not tied to a facility). Migration `0082` adds both (and the `PERMISSIONS` catalogue in
`libs/core`).

## API

| Method and path                                   | Permission       | Notes                                                                                                           |
| ------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/patients/:id/history`                | `history.read`   | Every section; audited                                                                                          |
| `POST /api/v1/patients/:id/history/procedures`    | `history.record` | `description`, `performed` (`YYYY` / `YYYY-MM` / `YYYY-MM-DD`), `source` …                                      |
| `POST /api/v1/patients/:id/history/conditions`    | `history.record` | `description`, `status`, `onset` …                                                                              |
| `POST /api/v1/patients/:id/history/medications`   | `history.record` | `medication`, `status` (`taking`/`stopped`/`unknown`), `dose`, `reason`, `prescribedBy`, `started`, `stopped` … |
| `POST /api/v1/history/medications/:id/stopped`    | `history.record` | `stopped` (partial date, optional), `note`; once                                                                |
| `POST /api/v1/patients/:id/history/family`        | `history.record` | `relationship`, `condition`, `onsetAge`, `deceased`, `causeOfDeath` …                                           |
| `POST /api/v1/patients/:id/history/family/review` | `history.record` | `outcome`, `unknownReason`                                                                                      |
| `POST /api/v1/patients/:id/history/social`        | `history.record` | `basedOn` + changed fields (`null` clears); `effectiveDate`                                                     |
| `POST /api/v1/history/:entryId/entered-in-error`  | `history.record` | `reason`; any section but reviews                                                                               |
| `GET /api/v1/portal/health-history`               | patient          | MyHealth (guardians may read it without the sensitive parts); audited `portal.health-history-view`              |

## Database relationships

See Entities. Indexes on `(organization_id, patient_id, recorded_at DESC)` per table; the reviews by `reviewed_at`.
`fhir_import_entry` kinds gain `procedure` and `family_history` and result types `past_procedure` and
`family_history_entry`; `records_request_export.sections` gains `history` (which also lists medications taken).

## Integration points

- **Patient 360** (`apps/api/src/app/patient-360`): panel `history` (`history.read`), sensitive parts only with
  `encounter.write`; see [patient-360](patient-360.md).
- **Timeline** — deliberately **not** a timeline kind: history entries describe the past as reported (often a year or
  "not known"), so a row at the time of recording adds little to the care journey, and the timeline must never carry
  sensitive content. The history page lists them instead.
- **FHIR R4 export** (`libs/interoperability/src/lib/fhir/history.ts`): past procedures → `Procedure` (status
  `completed` / `entered-in-error`, local category `past-procedure`, `performedDateTime` at its precision, `asserter`
  the patient or "a relative"/"another provider" as text or the documenting practitioner, `recorder` the practitioner,
  `performer` and `bodySite` as text); past conditions → `Condition` with a local category `past-medical-history`,
  `verificationStatus` `unconfirmed`, `clinicalStatus` as reported (none when unknown or in error) — deliberately not
  `problem-list-item`; family history → `FamilyMemberHistory` (relationship in HL7 v3 RoleCode, age at onset in UCUM
  `a`, cause of death as a condition with `contributedToDeath`); social history → one `Observation` per part of each
  version (category `social-history`, local codes `…/codesystem/social-history`, statuses under
  `…/codesystem/use-status`; no LOINC/SNOMED CT code is assumed); medications taken → `MedicationStatement` (local
  category `medication-taken`, `active`/`stopped`/`unknown`, `effectivePeriod` at its precisions). Reported entries carry `record-source#reported`,
  imported ones `record-source#external-import`. `FamilyMemberHistory` and `Procedure` support `_lastUpdated`. The
  family history review and staff notes are not exported. A Procedure search now answers without `dental.record.read`
  (past procedures), withholding the dental ones with a notice. See [FHIR](../interoperability/fhir.md).
- **FHIR import**: accepted `Procedure` (status `completed`) → a past procedure (date part of `performedDateTime` /
  `performedPeriod.start`; a date given as text, an age or the outcome kept as a note); accepted `FamilyMemberHistory` →
  one family history entry per condition (a condition with `contributedToDeath` is also the cause of death; a
  RoleCode outside the list is kept as "other" with the text). **Conditions stay external history** (as before): an
  imported Condition carries the sender's own statuses and categories (encounter diagnosis, problem list, verification)
  that do not fit a condition "as reported" by the patient, and the external history already labels it; entries
  accepted before are untouched.
- **MyHealth** `/health-history` ([portal](../architecture/portal-app.md)).
- **Copy of the record**: section `history` ([records requests](records-requests.md)).
- **Staff app**: History card on the patient record, `/patients/[id]/history`, encounter workspace panel, Patient 360
  panel ([staff app](../architecture/staff-app.md)).

## Reported by the patient in MyHealth

Patients answer a **history questionnaire** in MyHealth (`/health-history`) and add **medicines they take** that the
clinic did not prescribe (migration `0103`, `PatientHistoryPortalService` in `libs/clinic/src/lib/history`):

- The answers are written as ordinary history rows — `source = reported`, `reported_by = patient` (or `relative` when a
  guardian with `act` scope answers for a dependent) — with `recorded_via = patient_portal`, the MyHealth account
  (`portal_account_id`) and, when acting, the grant (`proxy_grant_id`) instead of a staff user (`recorded_by` is null
  then; database checks keep the two shapes apart). No code, clinician's notes, recorder or consultation: a portal
  entry is only ever "as told". Nothing is reviewed into the record automatically, and nothing needs to be: the
  history was never a clinical judgement of the organization. The clinic corrects a mistake the usual way (entered in
  error, a new entry) and sees "reported in MyHealth" instead of a recorder on the patient record, the encounter
  workspace, Patient 360 and in the API (`recordedVia`).
- **Daily life** (social history) from MyHealth is a new version on top of the current one: the non-sensitive parts
  the patient answered replace the clinic's, the rest is carried over — **substance use and sexual history are not
  asked in MyHealth** and a portal version never sets them, nor the clinician's notes. Nothing is written when
  nothing changed.
- Each questionnaire sent is an append-only **`patient_history_submission`** (who, when, which sections, the entry
  ids; `Idempotency-Key` per account, so a retry returns the first submission). MyHealth lists them; the clinic does
  not get a notice (the entries wait on the record for the next visit).
- The patient may mark a medicine **they reported in MyHealth** as stopped, once (`stop_portal_account_id`; the same
  rules as the staff command); what the clinic recorded is changed at the clinic (`recorded_by_clinic`).
- Dates are read in Asia/Manila (a portal request has no facility). Every write is audited with actor type `patient`
  (`history.record` with `recordedVia`, `portal.health-history-submit`, `history.medication-stopped`) and raises the
  same events as a staff record (`PatientHistoryRecorded`, `PatientHistoryMedicationStopped`).
- API: `POST /portal/health-history/submissions` (≤ 10 an hour; `422 date_in_future`, `stop_before_start`,
  `history_submission_empty`; `403 proxy_view_only` for a view-only guardian), `POST /portal/health-history/medications/:id/stopped`
  (≤ 20 an hour); `GET /portal/health-history` now carries `recordedVia`, `canStop`, `prescribedBy`, the parts of the
  current social history the questionnaire starts from, and `submissions`. FHIR export is unchanged: a portal entry
  is asserted by the patient (or a relative) like any reported entry.
- What a patient may be asked online, and the notice given, are the organization's under the Data Privacy Act
  ([compliance register](../security/compliance-dependencies.md)); the platform asks for no sensitive personal
  information in MyHealth.

## Open questions / assumptions

- No national code set for procedures or conditions is assumed; organizations name a code-system key (e.g. `icd-10`)
  and configure its URI (`FHIR_CODE_SYSTEMS`).
- Triage does not have its own history form: nurses record the history from the patient record or the encounter
  workspace.
- The sensitive-field rule (`encounter.write`) is a platform default; organizations change who sees them through roles.
- A structured obstetric history is not built (its fields await a clinical review). Medications taken are not
  reconciled against prescriptions issued here, and imported `MedicationStatement`s stay external history. The clinic
  is not told when a patient sends a questionnaire; a guardian's answers are recorded as reported by a relative
  whatever the relationship on the grant.
