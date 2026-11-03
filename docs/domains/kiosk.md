# Patient self-service kiosk

## Purpose

An unattended touchscreen in the waiting area where a patient checks in for an appointment, checks in as a walk-in for
a service the organization offers, or leaves a new-patient registration for reception to review. It produces a queue
ticket in the clinic's own queue; it is not a second queue and never reads or writes the patient record beyond
identification. Decision: ADR-0015. Brief: `docs/kiosk/`.

## Entities (migration `0137`)

- `kiosk_device` — one facility's kiosk: `code` (routes the page, not a credential), name, the staff account it signs
  in with (`user_id`, unique), status `active | maintenance | disabled`, heartbeat time, app version, printer status.
- `kiosk_session` — one person's time at a kiosk: token hash, device, status `active | ended | expired | locked`, the
  patient id once identified, failed attempts, deadline. Rows are kept; they hold no personal detail.
- `kiosk_registration` — a staged new-patient registration: reference `KR-XXXXXX`, status
  `pending | approved | linked | rejected | expired`, the sealed payload (erased on any decision or expiry), duplicate
  candidate ids, reviewer, reason, resulting patient and visit. A decided row never changes (trigger).
- `visit_type.kiosk_enabled` (which services a kiosk offers), `visit.checked_in_via = 'kiosk'`, `visit.queued_at` and
  `visit.skipped_count` (skip).

## Commands

Kiosk (`kiosk.session.use`, header `X-Kiosk-Session` after the first call): `GET /kiosk/me`, `POST /kiosk/heartbeat`,
`GET /kiosk/services`, `POST /kiosk/sessions`, `DELETE /kiosk/sessions`, `POST /kiosk/identify`,
`GET /kiosk/appointments`, `POST /kiosk/check-in` (`appointmentId` or `visitTypeId`), `POST /kiosk/registrations`.

Staff: `GET|POST /kiosk/admin/devices`, `PATCH …/devices/:id` (`kiosk.device.read | manage`);
`GET /kiosk/admin/registrations`, `GET …/:id` (audited view), `POST …/:id/approve | link | reject`
(`kiosk.registration.review`, plus `patient.register` to approve, `patient.read` to link, `clinic.queue.manage` to queue
the patient); `POST /queue/visits/:id/skip` (`clinic.queue.manage`).

Rules: identification needs number + exact birth date + given name to match one active patient; every miss gets the same
answer; three misses lock the session. Appointment check-in only for the identified patient's own in-person appointment
at this facility inside the facility's check-in window (outside it: "see the desk"); repeating returns the same ticket.
A walk-in is refused while the patient is already in the queue (`already_in_queue`). A kiosk in maintenance serves
nobody; a disabled one is refused. At most 50 registrations wait per kiosk.

## Events

`KioskDeviceStatusChanged`, `KioskRegistrationSubmitted`, `KioskRegistrationDecided` (ids and status only), plus the
existing `QueueEntryUpdated` / `AppointmentCheckedIn` raised by the visit code, so the board and the waiting-room
display update unchanged.

## Permissions

`kiosk.session.use` (role `kiosk_device` only), `kiosk.device.read` (receptionist, org_admin), `kiosk.device.manage`
(org_admin), `kiosk.registration.review` (receptionist, org_admin).

## Privacy and security

The API never returns a patient record: only initials and birth year after identification, today's appointments (time,
service, the doctor's display name, whether check-in is open) and the ticket. Failed identification is audited as a
denial without what was typed. Registration payloads are sealed (integration key ring), viewable only by reviewers
(audited), erased on decision or after 24 hours. A kiosk account must not hold `patient.read`. Rate limits are per
address (kiosks may share one); the effective guards are the per-session attempt limit and the per-kiosk registration
backlog. Keeping patient data out of the kiosk browser's storage is a rule of the web app (below).

## The kiosk web app (`apps/kiosk`, phase 3)

A Next.js app (`pnpm dev:kiosk`, port 3002; tags `scope:kiosk`, `type:app`; imports only `@healthcare/ui` and
`@healthcare/web-session`). **Set-up** (`/setup`): clinic staff sign the kiosk's own account in once (it must hold only
the Patient kiosk role at exactly one facility and be exempt from two-step verification); the device's tokens live in
httpOnly cookies and `proxy.ts` renews them, so a screen runs for days; a 401 sends it back to set-up. **The one
page** (`/`) learns only the kiosk's name, facility and walk-in services, then runs the flow as a reducer
(`src/lib/flow.ts`): KioskWelcomePage → PatientTypePage → ExistingPatientPage (number or mobile, birth date as day /
month / year fields, first name) → AppointmentCheckInPage or ServiceSelectionPage → QueueTicketPage, or
PatientRegistrationPage (React Hook Form + Zod: personal details, contact, address, PhilHealth number, emergency
contact, privacy notice) → RegistrationReviewPage → QueueTicketPage with the registration reference. All API calls are
server actions (`src/app/actions.ts`); the person's session token is an httpOnly `kc_ss` cookie that the page's scripts
never see; check-in and registration send an idempotency key kept for the session, so a second tap returns the same
ticket.

**Privacy rules, enforced:** no browser storage, script-readable cookie, URL state or service worker (a test scans the
source for them); typed details exist only in component memory and are dropped when sent; initials and birth year are
all that is shown about a patient; the screen clears itself 20 seconds after a 60-second idle warning, 45 seconds after
a ticket or reference and 15 seconds after a lock-out (all before the server's own 2-minute limit); **Start over** is
always on screen; responses are `no-store`; the app cannot be embedded. It requests full screen on the first touch,
reports a heartbeat every minute (and reloads when staff change the kiosk's status) and shows a connection notice after
two missed heartbeats. Touch targets are at least 4rem tall, type is 20px and up, errors are announced
(`role="alert"`) and every control has a text label. The privacy notice is `KIOSK_PRIVACY_NOTICE` (a plain statement of
what the kiosk does until the organization sets its own wording). Tested by unit tests in `apps/kiosk` and the browser
journey `apps/e2e/tests/27-kiosk.journey.ts`.

## Not built yet

Thermal ticket printing and the print agent (the kiosk reports its printer as `none`; there is no print button until an
approved mechanism exists), a QR code on the ticket, an on-screen keyboard (the device's own is expected), Filipino
wording, department grouping and voice settings on the public display, queue counters, staff screens for devices and
registration review, realtime push of kiosk status. Hardware behaviour (full screen, touch, printer) is verified only
on the target devices.

## Open questions / assumptions

Privacy notice wording, what a kiosk may collect and how long a pending registration may be kept (24 hours is a default
here) are the organization's decisions (`docs/security/compliance-dependencies.md`).
