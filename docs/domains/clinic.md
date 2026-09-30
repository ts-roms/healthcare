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
(migration `0079`; permissions `immunization.read`, `immunization.record`; catalogue with `clinic.configure`): doses given
here (optionally from vaccine stock, in the same transaction), not given with the clinician's reason, reported with a
partial date, and accepted from FHIR imports; immutable, corrected by entered in error. No schedule or due dose is
encoded. See [immunizations](immunizations.md).

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
`EncounterAmended`, `DiagnosisRecorded`. Consumers: appointment reminders (SMS 24 h before, withdrawn on
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

- No-show automation (marking at end of day), online self check-in and room scheduling views are not built.
- Diagnosis codes are not validated against a code catalog (no licensed ICD dataset is bundled).
- Procedures and referrals are not modeled yet.

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
