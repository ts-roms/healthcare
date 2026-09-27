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

| Table                                               | Notes                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `practitioner`                                      | Profession, specialty, PRC license (recorded, not verified), optional link to a staff account (`user_id`) — required to conduct encounters or prescribe |
| `room`, `visit_type`, `coding_system`               | Configuration. Coding systems (e.g. the ICD-10 edition in use) are data, not schema                                                                     |
| `practitioner_schedule`                             | Weekly blocks per facility in local time, slot step, validity dates; overlapping active blocks are rejected                                             |
| `schedule_exception`                                | Practitioner leave or a whole-facility closure (e.g. a declared holiday) — holidays are configured, never hard-coded                                    |
| `appointment`                                       | `booked → confirmed → checked_in → completed`, or `cancelled` / `no_show`. **Exclusion constraints** prevent double-booking a practitioner or a room    |
| `appointment_waitlist_entry`                        | Waiting list, fulfilled by booking                                                                                                                      |
| `visit` (+ `facility_queue_counter`)                | One arrival = one queue entry. Daily ticket per facility (`A-001`). One active visit per patient per facility                                           |
| `triage_assessment`, `vital_sign_set`               | Corrections mark entered-in-error; never deleted                                                                                                        |
| `allergy_intolerance`, `allergy_review`             | Active allergies; "no known allergies" is a recorded review, distinct from "not reviewed"                                                               |
| `encounter`, `encounter_note_revision`, `diagnosis` | Note revisions are append-only (trigger): drafts, the signed revision, amendments with reason                                                           |

All references use composite keys so a record can only point at the same organization's — and where relevant the same
patient's — rows.

## Rules

- Queue order: priority (`emergency`, `urgent`, `routine`), then arrival. Transitions are a state machine
  (`domain/queue-state.ts`); closing without care requires a reason.
- Vital signs are validated against wide plausibility limits (`domain/vital-signs.ts`): impossible values are rejected,
  never corrected. The platform does **not** label values normal/abnormal. BMI is computed for display.
- Only a practitioner linked to the signed-in account (physician, dentist, midwife) can start an encounter; only the
  **responsible** practitioner can sign. Note saves carry `basedOnRevision` so concurrent edits are not lost.
- After signing: notes change only by amendment (reason required); adding or retracting diagnoses needs
  `encounter.amend` and a reason.
- Availability and check-in use the facility's time zone (`Asia/Manila` by default); only today's appointments can be
  checked in.

## Events

`AppointmentBooked`, `AppointmentConfirmed`, `AppointmentRescheduled`, `AppointmentCancelled`, `AppointmentNoShow`,
`AppointmentCheckedIn`, `QueueEntryUpdated`, `TriageCompleted`, `EncounterStarted`, `EncounterCompleted`,
`EncounterAmended`, `DiagnosisRecorded`. Consumers: appointment reminders (SMS 24 h before, withdrawn on
cancel/reschedule/no-show) and the realtime queue gateway.

## Permissions

`clinic.configure`, `appointment.read`, `appointment.manage`, `clinic.queue.read`, `clinic.queue.manage`,
`clinic.triage.write`, `clinical.read`, `allergy.manage`, `encounter.read`, `encounter.write`, `encounter.sign`,
`encounter.amend`, `clinic.dashboard.read`. Queue, check-in, walk-in and dashboard require facility context.

## API

`/clinic/{practitioners,rooms,visit-types,coding-systems,schedules,schedule-exceptions}`,
`/appointments` (+ `availability`, `:id/{confirm,reschedule,cancel,no-show,check-in}`), `/waitlist`,
`/queue` (+ `walk-ins`, `visits/:id/{move,call,assign,triage}`), `/vital-signs`, `/patients/:id/{allergies,allergy-reviews}`,
`/encounters` (+ `:id/{note,sign,amendments,revisions,entered-in-error,diagnoses}`), `/clinic/dashboard`.
Realtime: Socket.IO namespace `/realtime`, event `queue.updated` (ids and status only).
Queue and schedule rows (`GET /queue`, `GET /appointments`) include a minimal patient brief (patient number, display name, sex, age) and
no contact or clinical details; listing a schedule is audited as `appointment.list`.

## Integration points

- Patient names for queue boards and schedules via the `PatientDirectory` port (adapter in `apps/api`).
- `ClinicQueries` (exported) serves the prescribing context and Patient 360.
- Reminders through `NotificationService`; templates carry no clinical detail.

## Open questions / assumptions

- No-show automation (marking at end of day), online self check-in and room scheduling views are not built.
- Diagnosis codes are not validated against a code catalog (no licensed ICD dataset is bundled).
- Procedures and referrals are not modeled yet.
