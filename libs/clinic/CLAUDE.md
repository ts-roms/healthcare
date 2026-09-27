# Clinic / EMR — domain instructions

Extends the root `CLAUDE.md`. Root rules win on conflict.

## Scope

Registration, appointments, queue, triage, vital signs, encounters, diagnosis, clinical notes, procedures, referrals, follow-up, and prescriptions. Appointment, queue, encounter, and prescription may live in their own libs (`libs/appointment`, `libs/queue`, `libs/encounter`, `libs/prescription`); this file governs the clinical workflow across them.

## Workflow

```
Walk-in / Appointment → Check-in → Queue → Triage (vitals, chief complaint, risk)
  → Consultation (encounter) → Diagnosis → Orders / Prescription / Referral → Follow-up → Close encounter
```

- Queue state changes publish realtime updates (Socket.IO) and are audited.
- An encounter belongs to exactly one patient, one facility, and one responsible practitioner.

## Rules

- **Encounters:** once signed/closed, changes are **amendments** (new version + reason + author), never in-place edits. Keep full version history.
- **Documentation:** support SOAP-style notes, but specialty templates are configurable (structured sections + JSONB extension fields). Do not force one rigid template on every specialty.
- **Diagnosis coding:** never hard-code one coding system. Store `code_system`, `code`, `display`, and version. The coding system (e.g. ICD-10 as used locally) is configuration, not schema.
- **Prescriptions:** medication, dose, route, frequency, duration, quantity, instructions, refills, status, prescriber, history. An issued prescription is immutable; changes go through cancel/replace with a reason.
- **Allergies and alerts** must be visible at triage, consultation, and prescribing. Drug–allergy checks, if added, are _decision support_: warn, show evidence, allow documented override, never block silently.
- **Vital signs:** store value + unit + measured-at + measured-by. Validate physiologically impossible values server-side; flag, don't auto-correct.
- **Appointments:** prevent double-booking with DB constraints (provider/room/time), not only UI checks. Times stored in UTC, displayed in Asia/Manila.
- **Orders to other domains** (lab, imaging, referral) go through that domain's application contract — clinic never writes laboratory tables.
- **Care plans** are a separate domain (`libs/care-plan`); clinic creates/links them via its contract.
- **Telemedicine** encounters reuse the same encounter model with a `modality` field; providers can escalate to in-person.

## Key events

`AppointmentBooked`, `AppointmentCheckedIn`, `QueueEntryUpdated`, `TriageCompleted`, `EncounterStarted`, `EncounterCompleted`, `EncounterAmended`, `DiagnosisRecorded`, `PrescriptionIssued`, `PrescriptionCancelled`, `ReferralCreated`, `FollowUpDue`.

## Permissions

`clinic.configure`, `appointment.read`, `appointment.manage`, `clinic.queue.read`, `clinic.queue.manage`, `clinic.triage.write`, `clinical.read`, `allergy.manage`, `encounter.read`, `encounter.write`, `encounter.sign`, `encounter.amend`, `clinic.dashboard.read`; prescriptions: `prescription.read`, `prescription.issue`, `prescription.cancel` (`libs/prescription`). Access is scoped by organization → facility → department.

## Docs

Keep `docs/domains/clinic.md` current (use `docs/domains/_template.md`). Implementation layout: `libs/clinic` holds scheduling, queue, triage, allergies and encounters (ADR-0007); `libs/prescription` and `libs/care-plan` are separate domains reached through ports.
