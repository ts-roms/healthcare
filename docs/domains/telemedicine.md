# Telemedicine (`libs/telemedicine`)

## Purpose

Online consultations as a complete clinical workflow (CLAUDE.md §10), not a video button:

```
Patient: booked online visit → pre-consult questionnaire → waiting room → video consultation
Clinician: online queue → questionnaire → start (telemedicine encounter) → video → notes, diagnosis, prescription,
           lab order, follow-up (the ordinary encounter workspace) → end with instructions, or escalate to in-person care
```

The clinical record is the clinic's **ordinary encounter** with `modality = 'telemedicine'`, so documentation, signing,
amendments, prescriptions, laboratory orders, care plans and follow-up booking work exactly as in person.
Telemedicine owns what is specific to being online: the session, questionnaire, waiting room, video and escalation.

Patients book online consultations themselves in MyHealth when the clinic opens the telemedicine visit type for online
booking (see [portal-app.md](../architecture/portal-app.md)); staff can also book them.

Payment before the waiting room and a text chat during the call are built (below); online payment itself is billing's payment provider port
(PayMongo when configured, otherwise the patient pays at the cashier).
Medical certificates are issued from the signed online consultation like any other (see
[clinic.md](clinic.md#medical-certificates)); the printed certificate says the patient was seen online.

## Entities

- `telemedicine_session` — one per online appointment (created on first use): opaque video room name (`tm-` + 32 hex;
  no patient data reaches the video provider), status `scheduled → waiting → in_consultation → ended | escalated`, the
  questionnaire (JSONB, versioned payload) with its submission time, red flags, the patient's electronic
  acknowledgement of an online consultation, join/start/end times and who, escalation reason, and patient
  instructions. Same-patient FKs tie it to the appointment, visit and encounter; checks enforce the lifecycle.
- `visit.checked_in_via` (`staff | patient_portal`): a patient entering the waiting room checks the visit in without
  a staff user; the visit goes straight to _awaiting consultation_ (no triage online).

An online appointment is an appointment whose visit type has `modality = 'telemedicine'`.

## Rules

- **Questionnaire first.** The waiting room opens only after the questionnaire is submitted, from 30 minutes before
  the start until the appointment ends. Answers: reason, symptoms and duration, current medicines, new allergies, red
  flags, where the patient is during the call, and a callback number for when video fails.
- **Red flags are decision support.** Chest pain, difficulty breathing, heavy bleeding, fainting, stroke signs,
  seizure, sudden severe pain, pregnancy warning signs or thoughts of self-harm make the portal urge emergency care
  (PH emergency hotline 911) at once and are shown to the clinician. The platform never decides that a patient is
  safe to be seen online; the clinician does.
- **Acknowledgement.** The questionnaire includes the patient's acknowledgement of an online consultation's limits,
  stored with the time and audited. The formal `telemedicine` consent type remains available for staff to record.
  Whether an electronic acknowledgement satisfies DOH/NPC requirements for a given facility must be validated
  before production use.
- **Start** needs the patient in the waiting room, `telemedicine.conduct` and `encounter.write`, and a practitioner
  linked to the account; it opens the telemedicine encounter for the visit (retrying adopts an encounter already
  opened). It is the only way to open an online visit's encounter: the ordinary `POST /encounters` refuses a visit
  whose visit type is online (`online_consultation`), and the queue marks each visit's `modality` so the staff app
  offers **Open in Telemedicine** there. Online appointments are checked in by the waiting room, not at the desk. **End** closes the call; the encounter stays open for documentation and is signed in the workspace.
- **Escalate to in-person care** (reason required) ends the online consultation; the clinician books the in-person
  visit with the usual booking flow. The patient sees that in-person care is recommended and the instructions, not the
  internal reason.
- **Video** tokens are issued only while the consultation runs, for one room, valid 2 hours, without recording or
  room administration rights. Identities are opaque (`patient:<id>`, `staff:<userId>`); display names are shown to
  the other participant. Calls are not recorded.
- Without a configured provider, everything but the video works; the clinician calls the callback number.

## Video readiness

`VideoProvider.check()` (LiveKit: one HTTP GET to the WebSocket address, 3 s timeout, cached for 30 s; no room is created and no credential is sent) tells
whether video is set up and answering. `GET /telemedicine/consultations/video-status` (`telemedicine.read`) returns `{ configured, reachable, checkedAt,
detail }` (never an address or a key); the staff `/telemedicine` page shows a notice when video is not set up or not answering, and **Settings → Clinical →
Online consultations** (`/telemedicine/settings`) shows the same. Patients are told "Your doctor will call you" when video is unavailable, as before.

## The acknowledgement wording (migration 0125)

The questionnaire's acknowledgement is the organization's own `telemedicine` consent wording (`consent_text`, staff `/admin/consent-wording`) while it has
one offered: the patient sees its title and text and confirms its statement, must send the id of the version offered now
(`acknowledgementTextId`; `422 acknowledgement_wording_changed` if it changed while they read), and the session records `acknowledgement_text_id`. With no
wording the platform's plain statement stands (`acknowledgement_text_id` null). Staff see which one on the pre-consult answers. Port methods
`currentAcknowledgement` / `acknowledgementById` on `TelemedicineClinic`, wired to `ConsentTextService`.

## Payment before the waiting room (migrations 0125, 0126)

`telemedicine_setting.payment_required` (organization, default off; `GET|PUT /telemedicine/settings`, `clinic.configure`, optimistic `version`, audited
`telemedicine.setting.update`). When on, `POST /portal/teleconsults/:id/waiting-room` (and `POST …/payment`) ask billing's `PrepaymentService` (through the
`TelemedicinePayments` port, `apps/api/src/app/adapters/telemedicine-adapters.ts`) to charge the visit once — a charge sourced from the appointment for the
service mapped to the visit type, invoiced and issued at once as a system actor (`billing_invoice.created_via = 'system'`, no staff creator) — and refuse
with `422 payment_required` until the invoice balance is zero (paid online, or at the counter). A visit type with no service or price is not charged
(`not_required`). `GET /portal/teleconsults/:id` and the staff consultation detail carry `payment`; reading never charges. The signed consultation does not
charge the visit type again (`ChargeService.captureEncounter` skips an appointment already charged). Refunds for a visit not held are the cashier's.

## Chat (migration 0125)

`telemedicine_message` (append-only; trigger): plain text, 1–1,000 characters, sender patient or clinician with the name as shown. Open while the session is
`waiting` or `in_consultation` (`422 chat_closed` otherwise), readable afterwards; at most 20 messages a minute per side (`422 message_rate_limited`).
`GET|POST /telemedicine/consultations/:appointmentId/messages` (read: `telemedicine.read`; write: `telemedicine.conduct`) and `GET|POST
/portal/teleconsults/:appointmentId/messages` (`after` = id of the last message shown; the clients poll every 4 s). Sending is audited (`telemedicine.message-send`,
`portal.teleconsult-message`) without the text; no domain event, no notification. `ConsultChat` in `libs/ui/src/healthcare`, `ConsultChatPanel` in the staff
app, the MyHealth consultation page. Whether a transcript is part of the medical record and how long it is kept are compliance dependencies.

## Commands

Patient (portal): submit questionnaire, enter waiting room, get video token. Staff: start, join, end (with
instructions), escalate (reason, instructions), set instructions.

## Queries

Staff: the facility's online consultations for a day, with session state, red flags and the visit/encounter; one
consultation with the questionnaire (audited). Patient: their online consultations from yesterday on; one
consultation (status, whether the questionnaire is done, when the waiting room opens, instructions).

## Events

`TelemedicineQuestionnaireSubmitted` (number of red flags), `TelemedicinePatientWaiting`,
`TelemedicineConsultationStarted`, `TelemedicineConsultationEnded`, `TelemedicineEscalatedToInPerson`. Payloads carry
ids and statuses only. The waiting-room check-in also emits the clinic's `AppointmentCheckedIn` and `QueueEntryUpdated`
(so live queue screens update).

## Permissions

`telemedicine.read` (physician, nurse, receptionist) — the online queue and questionnaires; `telemedicine.conduct`
(physician) — start, join, end, escalate, instructions. Organization administrators hold both.

## API

Staff (`X-Facility-Id` required): `GET /telemedicine/consultations?date=`, `GET /telemedicine/consultations/:appointmentId`,
`POST /telemedicine/consultations/:appointmentId/{start,join,end,escalate}`,
`PUT /telemedicine/consultations/:appointmentId/instructions`.

Patient (portal token): `GET /portal/teleconsults`, `GET /portal/teleconsults/:appointmentId`,
`PUT /portal/teleconsults/:appointmentId/questionnaire`, `POST /portal/teleconsults/:appointmentId/{waiting-room,video}`.
Patient actions are audited with actor type `patient`.

## Database relationships

Migration `0016_telemedicine.sql`. `visit.checked_in_by` is required unless `checked_in_via = 'patient_portal'`
(`visit_checked_in_by_staff`).

## Integration points

- `TelemedicineClinic` port (online appointments, waiting-room check-in, telemedicine encounter, patient name),
  implemented in `apps/api/src/app/adapters/telemedicine-adapters.ts` over the clinic's `OnlineVisitService` and
  `PatientRecordService`.
- `VideoProvider` port with `LiveKitVideoProvider` (`livekit-server-sdk`; `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
  `LIVEKIT_API_SECRET`). A LiveKit dev server is in `infrastructure/docker/docker-compose.yml`. Replace the adapter to
  change provider.

## Screens

Staff: `/telemedicine`, `/telemedicine/[appointmentId]` and the telemedicine panel in the encounter workspace
([staff-app.md](../architecture/staff-app.md#online-consultations)). Patient: `/consultations/[appointmentId]` in
MyHealth ([portal-app.md](../architecture/portal-app.md)). Verified end to end against a local LiveKit server (two
browsers exchanging audio and video).

## Open questions / assumptions

- Facility-specific telemedicine requirements (DOH, PRC, NPC) — consent wording, identity verification, record
  retention, cross-border data — must be confirmed against current official guidance.
- Online visits share the facility's queue numbering; a separate online queue number series may be preferred.
