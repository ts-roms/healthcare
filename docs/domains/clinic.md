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

| Table                                               | Notes                                                                                                                                                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `practitioner`                                      | Profession, specialty, PRC license (recorded, not verified), optional link to a staff account (`user_id`) — required to conduct encounters or prescribe                                                                                            |
| `room`, `visit_type`, `coding_system`               | Configuration. Coding systems (e.g. the ICD-10 edition in use) are data, not schema                                                                                                                                                                |
| `practitioner_schedule`                             | Weekly blocks per facility in local time, slot step, validity dates; overlapping active blocks are rejected                                                                                                                                        |
| `schedule_exception`                                | Practitioner leave or a whole-facility closure (e.g. a declared holiday) — holidays are configured, never hard-coded                                                                                                                               |
| `appointment`                                       | `booked → confirmed → checked_in → completed`, or `cancelled` / `no_show`. **Exclusion constraints** prevent double-booking a practitioner or a room                                                                                               |
| `appointment_waitlist_entry`                        | Waiting list, fulfilled by booking                                                                                                                                                                                                                 |
| `visit` (+ `facility_queue_counter`)                | One arrival = one queue entry. Daily ticket per facility (`A-001`). One active visit per patient per facility                                                                                                                                      |
| `triage_assessment`, `vital_sign_set`               | Corrections mark entered-in-error; never deleted                                                                                                                                                                                                   |
| `allergy_intolerance`, `allergy_review`             | Active allergies; "no known allergies" is a recorded review, distinct from "not reviewed". It holds only if asserted after the last change to the allergy list (a later allergy, even resolved or entered in error, makes it "not reviewed" again) |
| `encounter`, `encounter_note_revision`, `diagnosis` | Note revisions are append-only (trigger): drafts, the signed revision, amendments with reason                                                                                                                                                      |
| `external_history_entry`                            | External history accepted from a FHIR import (conditions, observations, medications, document descriptions); labelled external, never a diagnosis, result, vital sign or prescription                                                              |

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
  uploaded as a `consent_form` document). The consent is recorded against the procedure (`clinic_procedure_consent`, one
  per procedure, append-only): captured on paper, electronically (the wording version shown is required) or verbally;
  by the patient or a representative named as written with the relationship; who obtained it (the performer by default)
  and when (the performed time by default; never after it, `consent_after_procedure`); an optional scan (a `consent_form`
  document of the same patient, `document_not_consent_form`); notes. Given with the procedure (`consent` in the record
  body; `procedure_consent_required` when the entry requires it) or added once later (`POST /procedures/:id/consent`,
  `encounter.write` or `procedure.record`; `consent_already_recorded`). Audited `clinic.procedure-consent.record` (ids,
  how captured, wording version, whether a scan is linked — never names or notes). Refusals are not recorded: a procedure
  not performed has no record. What a valid informed consent must say and who may consent for a minor or an
  incapacitated patient are compliance dependencies; nothing here decides them.
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

- Queue order: priority (`emergency`, `urgent`, `routine`), then arrival. Transitions are a state machine
  (`domain/queue-state.ts`); closing without care requires a reason.
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
`AppointmentCheckedIn`, `QueueEntryUpdated`, `TriageCompleted`, `EncounterStarted`, `EncounterCompleted`,
`EncounterAmended`, `DiagnosisRecorded`, `ClinicProcedurePerformed`, `ClinicProcedureEnteredInError` (billing charges and
cancels). Consumers: appointment reminders (SMS 24 h before, withdrawn on
cancel/reschedule/no-show), the no-show follow-up (`AppointmentNoShow` → SMS + MyHealth "we missed you, book again" — skipped when the patient
already has another visit booked; one per appointment), the patient self-service confirmation (SMS `appointment.self-service` when the patient
booked, moved or cancelled in MyHealth; payload flags `bookedByPatient` / `changedByPatient`) and the realtime queue gateway.

## Permissions

`clinic.configure`, `appointment.read`, `appointment.manage`, `clinic.queue.read`, `clinic.queue.manage`,
`clinic.triage.write`, `clinical.read`, `allergy.manage`, `encounter.read`, `encounter.write`, `encounter.sign`,
`encounter.amend`, `clinic.dashboard.read`. Queue, check-in, walk-in and dashboard require facility context.

## API

`/clinic/{practitioners,rooms,visit-types,coding-systems,schedules,schedule-exceptions}`,
`/appointments` (+ `availability`, `:id/{confirm,reschedule,cancel,no-show,check-in}`), `/waitlist`,
`/queue` (+ `walk-ins`, `visits/:id/{move,call,assign,triage}`), `/vital-signs`, `/patients/:id/{allergies,allergy-reviews}`,
`/encounters` (+ `:id/{note,sign,amendments,revisions,entered-in-error,diagnoses}`), `/clinic/dashboard`.
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

- Room scheduling views are not built. Automatic no-shows and online check-in: see below.
- Diagnosis codes are not validated against a code catalog (no licensed ICD dataset is bundled).
- Procedures performed here are recorded in consultations (above); past procedures reported or documented from elsewhere
  are part of the [patient history](patient-history.md).

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
- Not built: rules per visit type or per practitioner, automatic offers or booking from the waiting list, waiting lists for online
  consultations' pre-consult, a fee or deposit rule.
