# Clinic / EMR (`libs/clinic`)

Rules: `libs/clinic/CLAUDE.md`. Decision to keep appointments, queue and encounters together: ADR-0007.

## Purpose

The outpatient clinical workflow: scheduling, arrival and queue, triage and vital signs, allergies, consultations
(encounters) with versioned notes, and coded diagnoses. **Not** responsible for prescriptions (`libs/prescription`),
care plans (`libs/care-plan`), laboratory orders (Phase 3) or billing.

## Workflow

```
Appointment (or walk-in) → check-in → queue (visit) → triage + vitals → encounter → diagnoses / prescriptions
  → sign → visit and appointment completed → amendments afterwards
```

## Entities

| Table                                               | Notes                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `practitioner`                                      | Profession, specialty, PRC license (recorded, not verified), optional link to a staff account (`user_id`) — required to conduct encounters or prescribe                                                                                                                                                                                        |
| `room`, `visit_type`, `coding_system`               | Configuration. Coding systems (e.g. the ICD-10 edition in use) are data, not schema; renamed, re-editioned or deactivated with `PATCH /clinic/coding-systems/:id` (`clinic.configure`, audited `coding-system.update`; the key never changes; an inactive system refuses new diagnoses, recorded ones keep it); staff `/clinic/coding-systems` |
| `practitioner_schedule`                             | Weekly blocks per facility in local time, slot step, validity dates; overlapping active blocks are rejected                                                                                                                                                                                                                                    |
| `schedule_exception`                                | Practitioner leave or a whole-facility closure (e.g. a declared holiday) — holidays are configured, never hard-coded                                                                                                                                                                                                                           |
| `appointment`                                       | `booked → confirmed → checked_in → completed`, or `cancelled` / `no_show`. **Exclusion constraints** prevent double-booking a practitioner or a room                                                                                                                                                                                           |
| `appointment_waitlist_entry`                        | Waiting list, fulfilled by booking                                                                                                                                                                                                                                                                                                             |
| `visit` (+ `facility_queue_counter`)                | One arrival = one queue entry. Daily ticket per facility (`A-001`). One active visit per patient per facility                                                                                                                                                                                                                                  |
| `service_point`, `visit_routing`                    | The facility's own service points (consultation, emergency, imaging, other) and the append-only history of a visit's moves between them; `visit.service_point_id` null = the ordinary consultation line (migration `0113`, "Service points" below)                                                                                             |
| `visit_route_step`, `service_point_setting`         | A visit's planned sequence of service points (one row per stop; the planning never rewritten, each step's progress forward only — trigger) and the facility's routing settings (call the patient automatically when a route sends them on); migration `0115`, "Visit routes" below                                                             |
| `triage_assessment`, `vital_sign_set`               | Corrections mark entered-in-error; never deleted                                                                                                                                                                                                                                                                                               |
| `allergy_intolerance`, `allergy_review`             | Active allergies; "no known allergies" is a recorded review, distinct from "not reviewed". It holds only if asserted after the last change to the allergy list (a later allergy, even resolved or entered in error, makes it "not reviewed" again)                                                                                             |
| `encounter`, `encounter_note_revision`, `diagnosis` | Note revisions are append-only (trigger): drafts, the signed revision, amendments with reason                                                                                                                                                                                                                                                  |
| `external_history_entry`                            | External history accepted from a FHIR import (conditions, observations, medications, document descriptions); labelled external, never a diagnosis, result, vital sign or prescription                                                                                                                                                          |

All references use composite keys so a record can only point at the same organization's — and where relevant the same
patient's — rows.

## Medical certificates

`medical_certificate` (migration `0068`; `libs/clinic/src/lib/certificates`) — issued from a **signed** consultation, in
person or online, by its **responsible practitioner** (`encounter.sign`; `encounter_not_signed`, 403 otherwise). The
practitioner writes the purpose, the findings or diagnosis as they will be printed (prefilled in the staff app from the
consultation's active diagnoses), optional recommendations and an optional rest period (both dates included, at most a
year); the platform supplies no wording any agency or employer requires. Numbered per organization `MC########`
(`medical_certificate_number_sequence`), with the consultation's local date (`examined_on`). **Immutable** (guard
trigger: content never changes, never deleted); a mistaken certificate is **voided** once with a reason (≥ 5 characters)
by the issuing practitioner or staff with `encounter.amend`, and another issued.

- **Printable copy**: a PDF (facility letterhead, number, date issued, patient name, number, age and sex, examined / seen
  online on, purpose, findings, recommendations, rest days, the practitioner's name and license number, a footer that the
  facility can confirm the number) stored once through `DocumentsService.storeGenerated` as a `medical_certificate`
  document of the patient **whose id is the certificate's** — idempotent, so a retry or a later request never makes a
  second copy. It appears with the patient's documents, in the timeline, Patient 360 and FHIR `DocumentReference`s like
  any document. Voiding archives it; the staff copy of a voided certificate is rendered fresh with a VOID watermark (not
  stored).
- **MyHealth**: the patient lists issued certificates (purpose, date, practitioner, rest days — not the findings) and
  downloads them through a short-lived link (`GET /portal/certificates/:id/link`, audited as the patient's download).
  `MedicalCertificateIssued` sends the `records.update` notice (in-app and SMS/email, no clinical detail).
- API: `GET|POST /encounters/:id/certificates` (`encounter.read` | `encounter.sign`), `GET /medical-certificates/:id`,
  `GET /medical-certificates/:id/certificate.pdf` (`encounter.read`, audited as a download or, for a void one,
  `encounter.certificate.print`), `POST /medical-certificates/:id/void`. Audit `encounter.certificate.issue | void`;
  events `MedicalCertificateIssued`, `MedicalCertificateVoided` (ids and the number only).

## Immunizations

The immunization history and the organization's vaccine catalogue live in `libs/clinic/src/lib/immunizations`
(migration `0081`; permissions `immunization.read`, `immunization.record`; catalogue with `clinic.configure`): doses given
here (optionally from vaccine stock, in the same transaction), not given with the clinician's reason, reported with a
partial date, and accepted from FHIR imports; immutable, corrected by entered in error. No schedule or due dose is
encoded. See [immunizations](immunizations.md).

## Procedures

Procedures performed at the clinic — wound dressing, suturing, incision and drainage, nebulization, injections given in
a consultation and the like; not dental work (`libs/dental`) or vaccinations (immunizations) — live in
`libs/clinic/src/lib/procedures` (migration `0085`).

- **Catalogue** `clinic_procedure_definition`: the organization's own code (letters, digits, `.`, `_`, `-`, up to 30;
  unique for good, never changed — retire an entry and add another), name, whether the body site is asked for, and
  optionally another code under a code-system key the organization names (for example a relative value scale edition it
  is licensed to use; exported under `FHIR_CODE_SYSTEMS[key]` when configured). Versioned, `active`/`inactive`. No
  national procedure code set, relative value scale or PhilHealth code is assumed (compliance and integration
  dependencies). `clinic.configure` changes it; clinical staff (`encounter.read`) read it. Staff `/clinic/procedures`.
- **Record** `clinic_procedure`: in a consultation of the patient at the selected facility — **in person** only (nothing
  is performed in an online consultation: `encounter_online`), not one entered in error. While the consultation is in
  progress, `encounter.write` records; once signed, only someone with `encounter.amend`, with a reason
  (`late_entry_reason`, `late_entry_reason_required`; without the permission `403`) — like diagnoses. The catalogue entry
  is copied (code, name, other code), with when it was performed (not in the future, not before the consultation began;
  5 minutes of clock tolerance), **who performed it** (an active practitioner of the organization — a nurse named by the
  recording physician, for example; the recorder's own practitioner record when left out), the body site as written
  (required when the catalogue asks), how many (1–99, the quantity billed) and notes. Immutable except being marked
  **entered in error** once with a reason (trigger `clinic_procedure_guard`; no DELETE or TRUNCATE) by the person who
  recorded it or someone with `encounter.amend`. Refused under a merged record (`PM001`); read through merged records.
- **Billing**: `ClinicProcedurePerformed` → a charge (source `clinic_procedure`, quantity as recorded) when a billing
  service is mapped to the procedure's code (`source_kind = 'clinic_procedure'`; billing settings "When a clinic
  procedure is performed"); `ClinicProcedureEnteredInError` → the charge is cancelled while not invoiced (an invoiced one
  needs a void, as for dental procedures).
- **Reading**: the encounter workspace **Procedures** section; timeline kind `procedure` (`encounter.read`; name,
  quantity and site, never notes); Patient 360 panel `procedures`; FHIR `Procedure` (local category `clinic-procedure`,
  the organization's code and the other code, performer, encounter, location, body site; notes not exported); the copy of
  the record lists them under each consultation.
- **API**: `GET|POST /clinic/procedure-definitions`, `PATCH /clinic/procedure-definitions/:id`, `GET|POST
/encounters/:id/procedures`, `GET /patients/:id/procedures`, `POST /procedures/:id/entered-in-error`. Audit
  `clinic.procedure-catalog.create|update`, `encounter.procedure.record` (the late-entry reason as the audit reason),
  `encounter.procedure.entered-in-error`, `encounter.procedure.view`. No new permission.
- **Supplies used** (migration `0089`, `ProcedureSuppliesService`, the dental pattern): each catalogue entry may list the
  supplies it usually uses (`clinic_procedure_supply_template_item`; `PUT /clinic/procedure-definitions/:id/supplies`,
  `clinic.configure`, audited `clinic.procedure-supply-template.update`; staff `/clinic/procedures`). After a procedure,
  staff with `encounter.write` confirm what was used (prefilled from the template) and the stock location of the
  selected facility: `POST /procedures/:id/supplies` issues it through inventory's own command
  (`InventoryStockService.issueForSource`, behind the `ProcedureSupplies` port, in the clinic's transaction: first expiry
  first out, never expired lots, all lines or none, controlled items with a reason and a reference, only
  `CLINIC_SUPPLY_CATEGORIES` — medical supply, medicine, PPE, other; never dental supplies, reagents or vaccines).
  Idempotent by key; a further use may follow. Unused supplies go back only through `POST /procedures/:id/supplies/returns`
  (a reason; never more than is still out per issued line, to the same lots and location), also after the procedure
  was entered in error; a procedure entered in error takes no new supplies (`procedure_entered_in_error`). Append-only
  `clinic_procedure_supply_use` / `_line` (item and lot snapshot for traceability); ledger source `clinic_procedure`,
  "Clinic procedure". `GET /encounters/:id/procedure-supplies`, `GET /clinic/procedure-supplies/options`. Audit
  `clinic.procedure-supplies.issue|return`; events `ClinicProcedureSuppliesIssued|Returned` (ids and counts). The pure
  rules are shared with dentistry (`libs/core`, `supplies/supply-use.ts`). No default stock location per facility (staff
  choose each time) and supplies are not charged automatically.
- **Consent** (migration `0095`): each catalogue entry may carry the organization's own consent wording, versioned
  and append-only (`clinic_procedure_consent_wording`; `GET|POST /clinic/procedure-definitions/:id/consent-wordings`,
  `clinic.configure`, audited `clinic.procedure-consent-wording.publish`; the platform ships none), and may require
  consent (`consent_required`). A printable form for one patient — letterhead, identification, the procedure, the current
  wording and its version, signature lines — comes from `GET /clinic/procedure-definitions/:id/consent-form.pdf?patientId=`
  (`encounter.read` + `patient.read`, audited `clinic.procedure-consent-form.print`, not stored; the signed form is
  uploaded as a `consent_form` document, or signed on screen — below). The consent is recorded against the procedure (`clinic_procedure_consent`, one
  per procedure, append-only): captured on paper, electronically (the wording version shown is required) or verbally;
  by the patient or a representative named as written with the relationship; who obtained it (the performer by default)
  and when (the performed time by default; never after it, `consent_after_procedure`); an optional scan (a `consent_form`
  document of the same patient, `document_not_consent_form`); notes. Given with the procedure (`consent` in the record
  body; `procedure_consent_required` when the entry requires it) or added once later (`POST /procedures/:id/consent`,
  `encounter.write` or `procedure.record`; `consent_already_recorded`). Audited `clinic.procedure-consent.record` (ids,
  how captured, wording version, whether a scan is linked — never names or notes). Refusals are not recorded: a procedure
  not performed has no record. What a valid informed consent must say and who may consent for a minor or an
  incapacitated patient are compliance dependencies; nothing here decides them.
- **Signing the consent form on screen** (electronic signatures phase 1, migration `0120`, `docs/architecture/electronic-signatures.md`): `POST /clinic/procedure-definitions/:id/consent-form/sign` (`procedure.record` + `patient.read`, facility) takes the patient, a client-chosen `requestId` (the document id; a retry finds the same document), who signed (`patient`, or `representative` with the relationship as written), the signer's name as printed, what the member of staff checked to identify them, and the drawn strokes (polylines of [x, y] in 0..1; some real ink, at most 64 strokes and 3000 points: `signature_empty`, `signature_too_large`). The same form is rendered with the mark, the name, the time, the witness and a verification line, stored once as a `consent_form` document of the patient (`DocumentsService.storeGenerated`), and the evidence is kept append-only in `document_signature` in the same transaction: signer, identity check, method `drawn`, the strokes, the witness, the device's user agent and the SHA-256 of the text agreed to (wording id, version, title and text, patient number, procedure code — recomputable from the records). The document id is then linked as the consent's `documentId` (captured electronically); nothing is signed or decided otherwise. Audited `document.sign` (ids and kinds only; never the strokes, names or what was checked). `GET /documents/:id/signatures` (`document.read`, audited `document.signatures.view`) lists the evidence without the strokes. Staff: **Sign on screen** in the consent part of the procedure form and of **Record consent…**; the paper route stays. Whether a drawn signature is valid for a given document, and who may sign for whom, are the organization's decisions (compliance register).
- **Signing in MyHealth and for minors** (electronic signatures phase 2, migration `0121`): the organization's choices (`consent_signing_setting`, `GET|PUT /clinic/consent-signing/settings`, `clinic.configure`, versioned, audited `clinic.consent-signing-settings.update`; staff `/clinic/procedures`) are the age under which a parent or guardian signs (`minor_age_years`, 18 as a reference until the organization confirms its own; null = no rule), whether patients sign in MyHealth (off by default) and how many days a request stays open (default 14). A **signature request** (`consent_signature_request`; `POST|GET /patients/:id/consent-signature-requests`, `POST /consent-signature-requests/:id/cancel` with a reason, `procedure.record`; staff patient **Procedures** page) fixes the wording version it asks the patient to read, records whether a representative must sign (`representative_required`, from the patient's age on the organization's rule), is open for one patient and procedure at a time (`request_already_open`) and moves only pending → signed or cancelled (trigger). The patient (and, with live guardian grants that allow "act", each guardian) is told in MyHealth, by SMS or email and push without detail (`records.update` kind `form-ready`, `ConsentSignatureRequested`). MyHealth `/forms` (`GET /portal/forms`, `/portal/forms/count`, `POST /portal/forms/:id/sign`, `@ProxyAllowed()`, audited `portal.consent-forms-view`, `portal.consent-form-sign`) shows the fixed wording and signs by drawing after the API has confirmed the account holder's password again (a wrong one counts toward the sign-in lockout; `invalid_credentials`). A minor's form is refused to the patient's own account and signed by a guardian acting for them (`minor_requires_representative`; the same rule applies to signing at the clinic, where the patient is refused as signer); a view-only guardian cannot sign. The signed form is stored as a `consent_form` document whose id is the request's ("signed in MyHealth"), the evidence records the account, the guardian grant and `identity_method = portal_password` (no witness) in `document_signature`, the request becomes `signed` in the same transaction, `ConsentSignatureSigned` (ids only). Expired requests are neither listed nor signable. Who may sign for whom stays the clinic's own guardian grant; nothing here decides age of majority, guardianship or validity (compliance register).
- **Practitioner signature on certificates and referral letters** (electronic signatures phase 3, migration `0122`, `docs/architecture/electronic-signatures.md`): a practitioner draws their own signature under My account (`GET|PUT /me/practitioner-signature`, `POST …/withdraw`; strokes, no upload; only they see or change it); the organization turns printing on (`practitioner_signature_setting`, off by default, `clinic.configure`; staff `/clinic/signatures`). The signature in force when a certificate or referral is issued is recorded on it (`practitioner_signature_id`, immutable) and the stored PDF is drawn from that record above the practitioner's name and license line, so a later change never alters an issued document; voiding or cancelling re-renders from the recorded one. Cosmetic: the issuer's authentication is the control.
- **Note template** (migration `0095`): the organization's own text per catalogue entry (`note_template`, ≤ 2000) that
  prefills the notes when the entry is chosen; the stored note is what the clinician submitted (an untouched template is
  replaced when another entry is chosen; typed text stays). No placeholders, no clinical rule.
- **Outside a consultation** (migration `0095`): a catalogue entry the organization allows
  (`allowed_outside_consultation`, off by default — which procedures a nurse carries out without a physician's
  consultation is the organization's clinical governance) may be recorded under an open, in-person **queue visit**
  instead of a consultation: `encounter_id` is nullable, `visit_id` names the visit, and a database CHECK keeps a
  procedure filed under one or the other, never free-floating. `POST /visits/:id/procedures` needs the new permission
  `procedure.record` (org_admin, physician, nurse) and the selected facility; the visit must be open
  (`visit_closed`), in person (`visit_online`) and the entry allowed (`procedure_requires_consultation`); performed not
  before check-in (`performed_before_visit`); no late entry (nothing is signed). `GET /visits/:id/procedures`
  (`encounter.read`). Billing, supplies, entered in error and consent work unchanged. Reads show it: the patient's list
  (`visitId`), timeline (`… · outside a consultation`, linked to the patient record), Patient 360, FHIR `Procedure`
  without `encounter`, and the copy of the record under "Procedures outside a consultation". Staff: **Procedures** on the
  queue ticket → `/queue/visits/[id]/procedures`; **Procedures done here** on the patient record → `/patients/[id]/procedures`.
- **Not built**: procedure-specific consent for the patient to give online, consent for a series of procedures, and
  recording a refusal of consent.

## Patient history

Past procedures and surgeries, past conditions diagnosed elsewhere (never diagnoses: the problem list is the diagnoses of
consultations), family history with its review state and social history as versions live in `libs/clinic/src/lib/history`
(migration `0082`; permissions `history.read`, `history.record`; substance use and sexual history also need
`encounter.write`); immutable, corrected by entered in error; nothing is scored. See [patient history](patient-history.md).

## Referrals

`referral` (migration `0079`; `libs/clinic/src/lib/referrals`) — made from a consultation (in progress or signed; not one
entered in error) by its **responsible practitioner** (`encounter.write`; 403 otherwise), either **internal** — to an
active practitioner of the organization, never oneself — or **external** — to an outside provider named as the referrer
writes it (facility and contact optional; not verified). The referrer writes the specialty or service asked for, the
urgency (routine, urgent, emergency — the referrer's own call), the reason (the question for the receiving provider) and
an optional clinical summary, and picks diagnoses of the consultation to list. Numbered per organization `RF########`.
What the referrer wrote **never changes** (guard trigger); status moves `sent → accepted | declined | completed |
cancelled`, `accepted → completed | cancelled`; declined, completed and cancelled are final; nothing is deleted.

- **Internal**: the practitioner referred to **accepts** or **declines** with a reason (`encounter.read` and being that
  practitioner); an appointment of this patient with them may be **linked** while open (`appointment.manage`); they
  **complete** it with a note of what came of it (`encounter.write`, after accepting).
- **External**: the letter goes through the channel the referrer chooses (printed, handed to the patient, sent); when the
  reply comes back it is **recorded** (`encounter.write`) with its summary and, optionally, the reply stored as a document
  of the patient (uploaded first). No referral network, form or electronic exchange of any agency or insurer is assumed
  (an integration dependency if one is required).
- **Cancel** while open with a reason (≥ 5 characters): the referrer, or staff with `encounter.amend`.
- **Letter**: a PDF (letterhead, number, date, to whom, contact, specialty, urgency, patient identification, when seen,
  reason, clinical summary, the listed diagnoses, the patient's **active allergies**, the referrer's name and license
  number) stored once as a `referral_letter` document of the patient whose id is the referral's; cancelling archives it
  and the staff copy of a cancelled referral is rendered fresh with a CANCELLED watermark.
- **Notices**: `ReferralCreated` (internal) → in-app `clinic.referral-notice` to the practitioner referred to;
  `ReferralAccepted | Declined | Completed` (internal) → to the referrer. The number only; a practitioner without a staff
  account is not told in the app.
- **Timeline**: kind `referral` (`encounter.read`): number, specialty, the practitioner or provider, urgency and status —
  never the reason or summary.
- API: `GET|POST /encounters/:id/referrals`, `GET /referrals?view=to_me|from_me|open|all[&patientId]`,
  `GET /referrals/:id` (audited `encounter.referral.view`), `GET /referrals/:id/letter.pdf` (audited
  `encounter.referral.print`), `POST /referrals/:id/{answer,appointment,complete,cancel}`. Audit
  `encounter.referral.create | accept | decline | appointment | complete | cancel`; events `ReferralCreated`,
  `ReferralAccepted`, `ReferralDeclined`, `ReferralCompleted`, `ReferralCancelled` (ids, number, kind and status only).
- **Overdue flag** (migration `0080`, `referral_setting`): the organization may choose a number of days (1–365) after
  which a referral still waiting for the recipient — status `sent`: an internal one not yet accepted or declined, an
  external one whose reply is not recorded — is flagged **overdue**. Off by default (no deadline is assumed; nothing is
  sent automatically). `GET /referrals/settings` (`encounter.read`), `PUT /referrals/settings` (`clinic.configure`,
  optimistic `version`, 0 while never saved; audited `encounter.referral.settings` with before and after).
  `overdue` is on every referral view, `GET /referrals?view=overdue` lists them oldest first (empty while off), and
  the Patient 360 panel carries it too (`referralOverdue` in `referral.rules.ts`; partial index `referral_awaiting`).
- **Merged records**: patient-scoped reads (`?patientId=`, timeline, Patient 360, FHIR, MyHealth) include referrals
  filed under records merged into the patient (`filedAsPatient`); a new referral under a retired record is refused by
  the 0068 trigger (`referral_not_for_merged_patient`, `422 patient_merged`); open referrals of the record to retire
  are a merge **warning** (`referral_open`: they stay under that number, whose letter names it), not a blocker.
- **Patient 360**: panel `referrals` (`encounter.read`, withheld otherwise): open ones first (oldest first), then the
  latest finished — number, recipient, specialty, urgency, status, referrer, issue time, overdue, `filedUnder`; never
  the reason or summary (`ClinicQueries.workspaceReferrals`).
- **FHIR R4**: each referral is a `ServiceRequest` (category SNOMED CT `3457005` Patient referral; see
  `docs/interoperability/fhir.md`), in `$everything` and `ServiceRequest?patient=` (`ClinicQueries.referralRecords`).
- **MyHealth**: `GET /portal/documents` lists the patient's referrals (number, recipient and specialty, issue time,
  urgency, referrer, status, whether a letter is available — not the reason or summary); `GET
/portal/referrals/:id/link` gives a short-lived link to the letter (not for a cancelled referral), audited as the
  patient's `document.download`. `ReferralCreated` → `records.update` (`referral-ready`) to the patient in the app,
  then push, else SMS, else email — "a referral letter from your visit is ready", no recipient, specialty or reason
  (`PatientRecordsNotices`; MyHealth users only).
- Staff: **Referrals** in the encounter workspace; `/clinic/referrals` (referred to me, made by me, all open, overdue,
  all; **Follow-up setting** for `clinic.configure`), `/clinic/referrals/[id]` (Overdue badge with icon and text),
  `/clinic/referrals/settings`, a **Referrals** card on the patient record and the Patient 360 panel.
- Care plan activities of kind `referral` are not linked to referral records (a follow-up, if needed, would add the
  link); the activity is tracked on the care plan as before.

## Rules

- Queue order: priority (`emergency`, `urgent`, `routine`), then arrival — within a service point too. Transitions are a state machine
  (`domain/queue-state.ts`); closing without care requires a reason. A visit is routed to a service point only from
  `in_triage` or `awaiting_consultation` ("Service points" below).
- Vital signs are validated against wide plausibility limits (`domain/vital-signs.ts`): impossible values are rejected,
  never corrected. The platform does **not** label values normal/abnormal. BMI is computed for display.
- Only a practitioner linked to the signed-in account (physician, dentist, midwife) can start an encounter; only the
  **responsible** practitioner can sign. Note saves carry `basedOnRevision` so concurrent edits are not lost.
- After signing: notes change only by amendment (reason required); adding or retracting diagnoses needs
  `encounter.amend` and a reason.
- **Patient self-booking** (MyHealth, `PatientBookingService`): only visit types with `online_booking` (set by
  `clinic.configure` via `PATCH /clinic/visit-types/:id`, audited, optimistic locking), only open slots of an active
  schedule (the schedule's slot grid, minus leave, closures and bookings), within the facility's booking rules (by default at
  least 2 hours ahead and at most 60 days out, at most 3 open self-bookings per patient, serialized per patient with an
  advisory lock); the patient may reschedule (the same practitioner or another one at the same facility who is on duty with an
  open time; online-bookable types) or cancel until the facility's cut-off (default 2 hours before) (`domain/patient-booking.ts`).
  See "Online booking rules and the waiting list" below.
  Rows record `booked_by_patient` / `updated_by_patient` instead of a staff user; checks enforce that exactly one is
  known. Another patient's appointment is "not found".
- Availability and check-in use the facility's time zone (`Asia/Manila` by default); only today's appointments can be
  checked in.

## Events

`AppointmentBooked`, `AppointmentConfirmed`, `AppointmentRescheduled`, `AppointmentCancelled`, `AppointmentNoShow`,
`AppointmentCheckedIn`, `QueueEntryUpdated`, `VisitRouted`, `TriageCompleted`, `EncounterStarted`, `EncounterCompleted`,
`EncounterAmended`, `DiagnosisRecorded`, `ClinicProcedurePerformed`, `ClinicProcedureEnteredInError` (billing charges and
cancels). Consumers: appointment reminders (SMS 24 h before, withdrawn on
cancel/reschedule/no-show), the no-show follow-up (`AppointmentNoShow` → SMS + MyHealth "we missed you, book again" — skipped when the patient
already has another visit booked; one per appointment), the patient self-service confirmation (SMS `appointment.self-service` when the patient
booked, moved or cancelled in MyHealth; payload flags `bookedByPatient` / `changedByPatient`) and the realtime queue gateway.

## Permissions

`clinic.configure`, `appointment.read`, `appointment.manage`, `clinic.queue.read`, `clinic.queue.manage`,
`clinic.queue.display` (the waiting-room display, below), `clinic.triage.write`, `clinical.read`, `allergy.manage`, `encounter.read`, `encounter.write`, `encounter.sign`,
`encounter.amend`, `clinic.dashboard.read`. Queue, check-in, walk-in and dashboard require facility context.

## API

`/clinic/{practitioners,rooms,visit-types,coding-systems,schedules,schedule-exceptions}`,
`/appointments` (+ `availability`, `:id/{confirm,reschedule,cancel,no-show,check-in}`), `/waitlist`,
`/clinic/service-points` (+ `:id`), `/queue` (+ `walk-ins`, `display`, `visits/:id/{move,call,assign,triage,route,routing}`), `/vital-signs`, `/patients/:id/{allergies,allergy-reviews}`,
`/encounters` (+ `:id/{note,sign,amendments,revisions,entered-in-error,diagnoses}`), `/clinic/dashboard`, `/clinic/dashboard/load` (`clinic.dashboard.read`, facility; `from`/`to` local dates, at most 62 days: per day the appointments scheduled and holding a slot against the slots the schedules offer less leave and closures; counts only, for the dashboard's calendar and week).
Realtime: Socket.IO namespace `/realtime`, event `queue.updated` (ids and status only; laboratory updates share the socket, see `docs/domains/laboratory.md`); browsers connect with a ticket from `POST /auth/realtime-tickets` (see `docs/security/access-control.md`).
Queue rows also carry the visit's `encounterId` once a consultation starts (entered-in-error encounters are ignored). Queue and schedule rows (`GET /queue`, `GET /appointments`) include a minimal patient brief (patient number, display name, sex, age) and
no contact or clinical details; listing a schedule is audited as `appointment.list`.

**Patient booking.** `PatientBookingService` (exported) serves `apps/api/src/app/portal/portal-booking.controller.ts`:
`GET /portal/booking/options`, `GET /portal/booking/slots`, `POST /portal/appointments`,
`POST /portal/appointments/:id/{reschedule,cancel}`. Migration `0017_online_booking.sql`.

**Online visits.** `OnlineVisitService` (exported for the telemedicine adapter) lists online appointments (visit type
modality `telemedicine`), checks a patient in from the MyHealth waiting room — no staff user (`visit.checked_in_via =
'patient_portal'`), straight to _awaiting consultation_, from 30 minutes before the start until the end, idempotent — and
starts the telemedicine encounter for the visit. See [telemedicine.md](telemedicine.md).

## Integration points

- Patient names for queue boards and schedules via the `PatientDirectory` port (adapter in `apps/api`).
- `ClinicQueries` (exported) serves the prescribing context and Patient 360.
- Reminders through `NotificationService`; templates carry no clinical detail.
- **FHIR imports** (`docs/interoperability/fhir.md`, "Inbound"): `ExternalRecordsService` (exported) is the command the
  interoperability layer reaches through a port. An accepted `AllergyIntolerance` goes through the staff allergy command
  (same validation, duplicate check and `allergy.add` audit) as `source = 'external_import'`, always `unconfirmed`, with
  `source_reference` `fhir-import:<import id>#<entry index>`; other accepted entries become `external_history_entry`
  rows (append-only except entered in error, migration 0048). `GET /patients/:id/external-history` (`clinical.read`,
  audited `external-history.view`); `POST /patients/:id/external-history/:entryId/entered-in-error`
  (`interop.fhir.import.review`, with a reason).

## Open questions / assumptions

- Room views (migration `0096`): `GET /appointments` takes `roomId` and each row carries `room { id, name }` when the booking names one;
  the staff day schedule (`/appointments?view=room`) and the calendar's day view (**By room**) lay the day out one column per active room
  of the facility, then "No room". Read-only: booking, rescheduling and the `appointment_room_no_overlap` constraint are unchanged;
  room equipment, turnover time and room bookings without a patient are not built. Automatic no-shows and online check-in: see below.
- Diagnosis codes are not validated against a code catalog (no licensed ICD dataset is bundled).
- Procedures performed here are recorded in consultations (above); past procedures reported or documented from elsewhere
  are part of the [patient history](patient-history.md).

## Waiting-room display

A screen in the waiting area shows the ticket being called and where to go ("A-007 → Room 2"), the tickets called
before it and how many wait (migration `0112`).

- `GET /queue/display` (`clinic.queue.display`, facility context): the facility's name, local date and time zone, the
  open in-person visits of today that staff called — ticket, the free text of **Call patient to**, call time — newest
  first (at most 8; `queueDisplay` in `domain/queue-state.ts`), and how many open in-person visits wait (`waiting` or
  `awaiting_consultation`). Never a name, patient number, visit id, visit type, priority or complaint, and never the
  order of those waiting (priority would make it appear to jump). It holds no patient detail, so reading it is not
  audited (the full queue read is, `queue.view`). Closed visits leave it; online visits never appear.
- The realtime gateway lets a holder of `clinic.queue.display` join the facility's `queue.updated` messages (ids and
  statuses only); the screen re-reads the display on each one and every 15 seconds while the socket is down.
- Built-in role `queue_display` holds only this permission: a staff account per screen, granted for the screen's
  facility, signs in on the screen and lands on the display (the staff app sends a display-only account nowhere else).
  Where staff two-step verification is required, the account is exempted with a reason. Receptionists and
  organization administrators hold the permission too and open the display from the queue page.
- Staff app `/display/queue`: no navigation; current call in large type, earlier calls, the waiting count, the
  facility's local time, an optional bell-like chime (Web Audio, turned on with one click at the screen; quiet, normal or
  loud) and an optional spoken announcement after it through the browser's speech synthesis — "Number A 0 0 7, please
  proceed to Room 2", in English, Filipino or both, the ticket spelled out character by character and the place as
  typed; the device's installed voices, nothing sent anywhere — with the level and voice choice kept in the screen's
  browser storage (`apps/staff/src/lib/queue-display.ts`, `queue-display-sound.ts`), a screen wake lock and full screen.
  English labels; the room text is whatever staff typed.
- Not built: ticket printing or a kiosk, announcements over a public-address system, and priority lanes (which the organization would first
  confirm against current rules). Service points (below) do not change the display: a call still shows the ticket and the
  place typed, never the service point.

## Service points

Migration `0113` (ADR-0014). An LGU hospital's outpatient department is not one line: after triage a patient goes to
the consultation line, the emergency room, X-ray or another station. The organization defines its own **service
points** per facility; a visit is sent to one at the end of triage (or later from the queue board) and the board shows
one service point at a time. Nothing national is assumed: no ESI or Manchester triage scale, no emergency-care rule, no
list of stations.

- `service_point` (per facility): `code` (lower-case, fixed), `name`, `kind` `consultation` | `emergency` | `imaging` |
  `other` (how the staff app labels and orders it; nothing else hangs on it), `status` active/inactive, `version`.
  `GET /clinic/service-points?facilityId=` (`clinic.queue.read`; `includeInactive=true` for all), `POST
/clinic/service-points` and `PATCH /clinic/service-points/:id` (name, kind, status; `clinic.configure`; audited
  `service-point.create` / `service-point.update` with before and after). Deactivating one keeps every visit that
  names it; it only refuses new routing (`service_point_inactive`). Staff `/admin/service-points` (the selected
  facility's list; add, rename, change the kind, deactivate, reactivate).
- `visit.service_point_id` (nullable, same facility by composite key). **Null is the single consultation line that
  existed before** — every earlier visit and every screen keeps working, and an organization that never sets up
  service points sees no change.
- `visit_routing` (append-only, trigger): one row per move — visit, from and to service point (from null for the
  first), who routed, an optional reason, when. The visit's past is never rewritten; `GET /queue/visits/:id/routing`
  (`clinic.queue.read`) lists it with the service points' names.
- Routing: `POST /queue/visits/:id/route` `{ servicePointId, reason?, version }` (`clinic.queue.manage`, the
  permission that moves and calls visits), or `servicePointId` on `POST /queue/visits/:id/triage`
  (`clinic.triage.write`): triage records the assessment, advances the visit and routes it in **one transaction**.
  Allowed from `in_triage` and `awaiting_consultation` only (`canRouteVisit` in `domain/queue-state.ts`): a waiting
  patient is triaged first, a patient with the provider is not moved, a closed visit cannot be routed
  (`visit_not_routable`). The target must be an active service point of the visit's facility; routing to the one
  the visit is already at is refused by the command (`already_at_service_point`) and skipped by triage (the picker
  shows the current one). Audited `visit.route` (from → to, reason); `VisitRouted` event (ids only) beside
  `QueueEntryUpdated`, whose payload now carries `servicePointId`.
- The queue of a service point is the facility queue filtered to it, in the same service order — priority
  (`emergency`, `urgent`, `routine`), then arrival (`servicePointQueue` in `domain/queue-state.ts`). `GET
/queue?servicePointId=` returns one service point's visits; without it, the whole facility. Rows carry
  `servicePointId` and `servicePoint { id, code, name, kind }`. Staff `/queue` has a service-point switcher (**All
  service points** or one of them, kept in the URL so live refreshes keep it), the ticket panel shows where the
  patient was sent and offers **Send to** for routable visits, and the triage page ends with **Send to**
  (defaulting to the visit's service point, else the first `consultation` service point, else the ordinary
  consultation line).
- The waiting-room display is unchanged: ticket and the place typed at the call, never the service point.

Out of scope for this slice, each its own decision later: imaging orders and a radiology worklist (a service point of
kind `imaging` is a queue, not an order), triage scales (ESI, Manchester) and any rule about who goes to the
emergency room, beds and observation, a ticket series per service point, kiosks, and routing on check-in (a visit
always starts on the facility's line; the nurse decides at triage). Who may send a patient where is the
organization's policy, recorded in the [compliance register](../security/compliance-dependencies.md).

## Visit routes

Migration `0115`. After triage a patient often has more than one stop ahead — the laboratory, then X-ray, then back
to the doctor — and the desk had to remember the sequence and move the ticket by hand each time. A **route** is the
planned sequence of service points for one visit. Finishing the step at the current service point is a person's click
(**Done here, send on**): the visit moves to the next planned service point through the ordinary routing history, and
the facility may choose to have the patient **called there automatically**, so the waiting-room display shows and
announces it ("A-002 → Laboratory, 2nd floor") with no change to the display itself.

- `service_point.location` (≤ 60 characters, optional): what the display says when a route sends a patient to the
  service point; the name when unset. Set with the service point (`POST`/`PATCH /clinic/service-points`; audited with
  before and after).
- `service_point_setting` (per facility; defaults without a row): `call_on_triage_to`, `call_on_consultation_to`, `call_on_procedure_to` (migration `0127`; the facility's own text, ≤ 60 characters, null = nothing is called for that step): when staff with `clinic.queue.manage` select **Triage & vitals**, **Start consultation** or **Procedures** on a ticket, the staff app first calls the patient to that place through the ordinary `POST /queue/visits/:id/call` (`called_at` / `called_to`, so the display announces it) unless they are already called there, then opens the step whatever the call's outcome (no new endpoint, permission or event); `auto_call_on_route`, off by default; `seniors_first` (migration `0123`), off by default: a routine visit of a patient aged 60 or older (`SENIOR_AGE`, an indicator, not a legal test) is listed before other routine visits, urgent and emergency visits stay ahead, arrival order within each group (`compareQueueOrder` with `senior`; only the order of `GET /queue` changes, the waiting-room display shows no order). Staff see a Senior badge on tickets of patients 60 or older whether or not the lane is on. `GET
/clinic/service-point-settings?facilityId=` (`clinic.queue.read`; the queue page reads it to say what "send on"
  will do) and `PUT /clinic/service-point-settings` `{ facilityId, autoCallOnRoute, version? }` (`clinic.configure`;
  audited `service-point-setting.update`; stale `version` → `409`). Staff `/admin/service-points`, **Routes**.
- `visit_route_step`: visit, `position`, service point, `status` `planned` | `current` | `done` | `skipped` |
  `removed`, who planned it and when, `started_at` (the visit arrived there), `completed_at` / `completed_by`, and
  `note` — the note left at "done here" or the reason for skipping (required then). A trigger keeps the planning
  itself immutable (which service point, where in the order, by whom) and lets a step's progress move forward only:
  planned → current → done; planned or current → skipped; planned → removed (dropped from the plan by a re-plan,
  never a current or finished step); done, skipped and removed are final; never deleted. Positions are unique among
  the steps still in the plan (a removed step frees its position); one `current` step per visit. Rules in
  `domain/queue-state.ts`: `currentRouteStep`, `nextRouteStep` (the planned step with the lowest position),
  `routeInPlan`, `routeComplete`, `canAdvanceRoute` and `routePlanProblem` (unit-tested).
- Planning. At triage: `servicePointId` is the first stop and `route` (≤ 10 service point ids, in order) the stops
  after it — `POST /queue/visits/:id/triage` routes to the first stop, makes it the route's `current` step and plans
  the rest in the same transaction (a `route` without `servicePointId` is a validation error). From the queue board:
  `PUT /queue/visits/:id/route-plan` `{ servicePointIds, version }` (`clinic.queue.manage`) sets the stops still
  ahead — planned steps become `removed`, done, skipped and the current step stay — allowed in the routable states
  only (`visit_not_routable`); each stop must be an active service point of the facility (`service_point_inactive`)
  and may not repeat the stop before it, nor the one the visit is at (`route_step_repeated`). Audited
  `visit.route-plan` (step ids and codes); event `VisitRoutePlanned` (ids). `GET /queue/visits/:id/route` lists the
  steps in plan order with their service points (removed ones left out); `GET /queue` rows carry the same as `route`.
- **Done here, send on**: `POST /queue/visits/:id/route/next` `{ note?, version }` (`clinic.queue.manage`). The
  current step (if the visit is at one) is marked `done` with the note; the next planned step's service point is
  routed to through `VisitService.routeIn` — so `visit_routing`, `VisitRouted`, the `visit.route` audit and
  `QueueEntryUpdated` stay the single record of where a visit went — and becomes `current`; when the facility's
  `auto_call_on_route` is on, the patient is called there (`called_at` / `called_to` = the service point's
  `location` or name, audited `visit.call` with `automatic: true`, the same `QueueEntryUpdated`), so the display
  announces it. At the last stop the step is marked done and the visit stays (`called: false`); with nothing current
  or planned the command is refused (`route_complete`; `no_route` when nothing was ever planned). A visit on a line
  that is not in its plan (say, the consultation line with a plan made from the board) is sent to its first planned
  stop. Audited `visit.route-advance`; event `VisitRouteAdvanced` `{ doneStepId, nextStepId, called }`. The answer
  carries the visit, the route and `called`.
- **Skip**: `POST /queue/visits/:id/route/skip` `{ stepId, reason, version }` — a planned step is marked `skipped`
  and nothing moves; the current step is marked `skipped` and the visit moves on to the next planned stop exactly as
  "done here" would (with the call when the facility calls automatically). A finished step cannot be skipped
  (`route_step_final`). Audited `visit.route-skip` with the reason.
- Staff `/queue`: cards show "next: X-ray" while a stop is ahead; the ticket panel's **Route** section lists the stops
  (done, skipped, here, planned — colour, icon and text) and offers **Done here, send on** (with an optional note and
  a line saying where the patient goes and whether they will be called), **Skip step…** (step and reason) and
  **Plan route…** / **Change next stops…** (`route-panel.tsx`, `components/route-stops-editor.tsx`). The triage
  **Send to** card is now **Route**: the first stop plus **Then** the stops after it (the existing single-stop
  behaviour is unchanged when none is added; a repeat triage starts from the stops already planned).
- The waiting-room display is unchanged: a call made by a route is a call like any other (ticket and the location
  typed or configured), never the route.

**Nothing clinical moves a patient.** A specimen collected, a procedure recorded or an encounter signed completes no
step: every move is a person's click, so the person at the station confirms the patient really is done there. Automatic
completion from clinical events is a documented follow-up (each event would need its own rule about what "done here"
means — a specimen collected is not a laboratory visit finished); so are a timer on a step, routes planned at check-in
or from an appointment's visit type. Who may plan or change a route is the
organization's policy ([compliance register](../security/compliance-dependencies.md)).

## Route templates

Migration `0116`. A facility names the routes it plans again and again — "Annual check-up: Triage Room → Laboratory → X-ray
→ Consultation" — so the nurse picks one instead of adding each stop by hand.

- **A recipe, not a route.** `route_template` (code and name per facility, status, version) with `route_template_step`
  (the service points in order, at most 10; the same one may return later but never twice in a row — the same
  `routePlanProblem` rule as a visit's own route). Applying a template writes the ordinary `visit_route_step` rows through
  triage (`servicePointId` + `route`) or `PUT /queue/visits/:id/route-plan`, so the progress, the announcements and every
  rule above are unchanged, and editing a template later never changes a route already planned.
- **Offered, never imposed.** `route_template_default` names the template offered first for a visit type at a facility
  (one per visit type and facility; visit types belong to the organization, routes to a facility). At triage it is
  pre-selected only while the visit has no service point or planned stops yet, and the nurse can change or clear it. Nothing
  clinical chooses a template.
- **Usable.** A template whose stop was deactivated since is `usable: false`: listed for the administrator with a warning,
  not offered to nurses, and it cannot be saved with an inactive stop.
- **API.** `GET /clinic/route-templates?facilityId=&includeInactive=` (`clinic.queue.read`; steps as the service points are
  named now, `usable`, `defaultForVisitTypeIds`), `POST /clinic/route-templates` (`clinic.configure`; `409 route_template_exists`,
  `422 route_step_repeated | service_point_unknown | service_point_inactive | visit_type_unknown`), `PATCH
/clinic/route-templates/:id` (name, status, the whole list of stops, the visit types it is offered for; optimistic
  `version`). Audited `route-template.create` and `route-template.update` (stops before and after). No domain event: nothing
  else reacts to a template.
- **Staff.** `/admin/service-points` → **Route templates** (add, edit, deactivate; **Offer first for these visit types**);
  triage's **Route** card has a **Route template** select that fills **Send to** and **Then**; the ticket panel's **Plan
  route…** has **Fill in from a template…** (the first stop is dropped when the patient is already there).
- **Not built.** Completing a step from a clinical event, conditional or branching routes, and suggesting a route from the
  complaint or the vitals (that would be decision support and needs its own labelling and override rules).

## Automatic no-shows and online check-in

Migration `0088`. Both are part of each facility's booking rules (`facility_booking_rule`, same endpoints, versioning and
`facility.booking-rules-update` audit as below) and **off by default**.

- **Automatic no-shows** (`auto_no_show`, `auto_no_show_hour` 12–23, default 20:00): `AutomaticNoShows` runs hourly in the API
  and, at facilities that turned it on, marks booked or confirmed appointments that have ended without a check-in as no-shows
  once the facility's local time is past the hour **on the appointment's own day** (`autoNoShowDue`, `libs/clinic/src/lib/domain/patient-booking.ts`).
  It only looks at appointments that started in the last 48 hours, so turning it on never reaches into old history. Each
  appointment is locked and re-checked (`AppointmentService.markNoShowAutomatically`), so several API instances mark it once. The
  transition, the `appointment.no-show` audit (system actor, `metadata.automatic = true`) and the `AppointmentNoShow` event
  (`payload.automatic`) are those of a no-show recorded by staff, so the "we missed you" follow-up and reminder withdrawal apply.
  `appointment.no_show_automatic` marks it (only on a no-show, by constraint); who last changed the appointment is left as it was.
- **Online check-in** (`online_check_in`, `check_in_opens_minutes` 0–240 before the start, default 60; `check_in_closes_minutes`
  0–120 after it, default 15): `POST /portal/appointments/:id/check-in` (`PatientAccessGuard`, proxy `act`) checks the patient in
  for their own **in-person** appointment (`VisitService.checkInByPatient`; an online consultation's waiting room is separate).
  The visit joins the queue **waiting for triage** like any arrival, with `checked_in_via = 'patient_portal'` and no staff user;
  the appointment is `checked_in` (`updated_by_patient`), audited `appointment.check-in` as the patient (`via: patient_portal`),
  with `AppointmentCheckedIn` (`byPatient`) and `QueueEntryUpdated`. Checking in again returns the same visit. Refusals:
  `online_check_in_not_offered`, `check_in_too_early`, `check_in_too_late`, `not_in_person`, `invalid_appointment_status`,
  `already_in_queue`; another patient's appointment is not found. `GET /portal/appointments` gives each upcoming visit
  `canCheckIn`, `checkInOpensAt` and, once checked in, its `queueTicket`. The staff queue shows "Checked in online".
- The platform cannot tell whether the patient is really at the clinic; the window is the clinic's control, and the desk sees who
  checked in online. No location check is made.

## Online booking rules and the waiting list

Migration `0077`.

- **Rules per facility** (`facility_booking_rule`, `BookingRulesService`; `GET /clinic/booking-rules` needs `appointment.read`,
  `PUT /clinic/booking-rules/:facilityId` needs `clinic.configure`, versioned and audited as `facility.booking-rules-update` with
  before/after): notice (`min_lead_minutes`, 0–7 days), horizon (`max_advance_days`, 1–365), upcoming self-bookings per patient
  (1–20), the change and cancellation cut-off (`change_cutoff_minutes`, 0–7 days), whether patients may join a waiting list, and
  waiting-list requests per patient (1–10). A facility without a row keeps the platform's defaults (120 minutes, 60 days, 3, 120
  minutes, no waiting list), so nothing changes until a clinic sets its own. Which visit types are bookable online stays
  organization-wide (`visit_type.online_booking`). MyHealth reads each facility's rules from `GET /portal/booking/options`
  (`facilities[].rules`); patients' `canCancel` / `canReschedule` use the appointment's facility.
- **Choosing another doctor when rescheduling:** `POST /portal/appointments/:id/reschedule` takes an optional `practitionerId`. The
  same facility and visit type stay; the new practitioner needs an active schedule that day and an open time (a colliding
  booking is refused by the exclusion constraint and by the slot check; the appointment's own time counts as free only for the
  same practitioner). The change is audited (`practitionerId` from/to) and the event `AppointmentRescheduled` carries
  `previousPractitionerId`.
- **Patient waiting list for full days** (`PatientWaitlistService`; `GET/POST /portal/booking/waitlist`, `POST …/:id/leave`): where the
  facility allows it, a patient who finds no open time may ask to be told when one opens. It is for full days only (asking while
  a time is open is refused with `open_times_available`), for at most 14 consecutive days starting today or later within the
  horizon, for a bookable visit type and optionally one practitioner; no duplicates or overlaps (`already_on_waitlist`) and
  at most the facility's number of requests (`too_many_waitlist_entries`). The entry is an ordinary `appointment_waitlist_entry`
  with `created_by_patient` (and no staff `created_by`; the database keeps exactly one), so staff see it on `/waitlist` (staff
  `/appointments/waitlist`, marked "By the patient") with the patient's name; days that have passed no longer count as waiting.
  The patient can take the request back; booking a time in the requested days closes the entry as booked.
- **Notice when a time opens** (`WaitlistNotices`, on `AppointmentCancelled` and `AppointmentRescheduled`, by staff or patient):
  patients waiting for that day (practitioner and visit type matching, "any" when unset) at that facility are texted, or emailed when
  SMS is not possible, that a time may have opened and to sign in and book it (`appointment.waitlist-opened`: the clinic and the
  day only), once per entry per day, never to the patient who freed the time, and only while the facility's waiting list is on and the
  time is still bookable. Nothing is booked automatically: first come, first served.
- **Rules per visit type or practitioner** (migration `0096`, `waitlist_rule`, `WaitlistRulesService`; `GET /clinic/waitlist-rules?facilityId=`
  with `appointment.read`, `PUT /clinic/waitlist-rules` with `clinic.configure`, versioned and audited `facility.waitlist-rule-update`): whether
  patients may join, how many requests and how far ahead (never beyond the facility's horizon) for one visit type or one practitioner at a
  facility. The facility's own rule stays the default; a practitioner's rule wins over a visit type's (`resolveWaitlistRule`). A request the
  rule refuses answers `waitlist_not_offered`; a rule's limit counts the patient's requests under that rule. MyHealth asks
  `GET /portal/booking/waitlist-allowance?facilityId&visitTypeId&practitionerId` before offering the button. Staff: **Waiting-list rules per
  visit type or practitioner** on `/appointments/visit-types` (selected facility).
- **Offers from the waiting list** (migration `0096`, `waitlist_offer`, `WaitlistOffersService`): a facility chooses `waitlist_mode` `notice`
  (above, the default) or `offer`, with `offer_hold_minutes` (15–1440, default 120) and `offer_batch` (1–5, default 1). In `offer` mode an opened
  time (a cancellation, or a visit moved away; the visit type's length) is **held** for the first matching patient-made entries — urgent first,
  then oldest; never the patient who freed it; one offer per entry per day (`offerCandidates`) — until the hold runs out or the online lead time
  before the start, whichever is first (`offerExpiry`). The patient is texted or emailed that a time is being held (`appointment.waitlist-offer`:
  the clinic, the day and the hold; the time is shown after sign-in) and in MyHealth accepts it (`POST /portal/booking/offers/:id/accept`:
  booked through the ordinary patient booking, so lead time, limits and the exclusion constraints apply; the first acceptance wins, the other
  offers of that time become `taken`) or declines it (`…/decline`: the entry stays on the list and the time goes to the next entries at once).
  Staff (`/appointments/waitlist`, **Times being held**) accept it for the patient after speaking to them (`POST /waitlist/offers/:id/accept`,
  `appointment.manage`: booked at the front desk, the entry closed as booked) or withdraw it with a reason (`…/withdraw`; not handed on).
  `GET /waitlist/offers?facilityId=&includeClosed=` lists them (audited `waitlist.offers.view`). The hourly `WaitlistOffersService.expire`
  (started in `main.ts`) expires offers whose hold ran out and hands each time on while it is still free. Audit `waitlist.offer.accept |
decline | withdraw`; events `WaitlistOfferMade | Accepted | Expired` (ids only). **Fully automatic booking without the patient's or staff's
  acceptance is deliberately not built**: it would create appointments nobody agreed to, which the reminder and no-show rules then act on.
- Not built: waiting lists for online consultations' pre-consult, a fee or deposit rule, offers to entries staff added (they have no MyHealth
  side; staff book those by phone as before).
