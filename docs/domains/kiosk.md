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

## Reception review (phase 4)

Staff `/queue/registrations` (tab **Registrations** of the Queue module, with a count that updates at once): the open
list for the selected facility (`GET /kiosk/admin/registrations`: reference, time, kiosk, number of possible
duplicates, when it will be erased; no personal data), live through the realtime channel `registrations.updated`
(`kiosk.registration.review`; the socket joins it at connect; a registration arriving or decided tells reviewers' open
pages to refetch, nothing about it travels) and the badge `kioskRegistrations` in `/me/badges`. Opening one
(`/queue/registrations/[id]`, audited as a view of personal data) shows what the person typed, the Patient Master's
possible existing records with their match reasons, and the decision: **Patient verification** (the reviewer confirms they
checked the person's identification against the details, and may say how: the API refuses to approve or link without
`identityChecked: true`, and the confirmation and note are kept in the audit trail of the decision), **Approve and register**
(the ordinary registration with its duplicate rules: with possible matches the reviewer must confirm the candidates are
a different person and say why; optionally queues the new patient for a walk-in service), **Same person — link**
(closes the submission against an existing record), or **Decline** with a reason. A detail the person mistyped is
corrected after approval on the patient record (**Edit details**); the submission itself is never edited. The typed
payload is erased on any decision. The queue board's actions (recall, no-show, put back in line) are in
[clinic](clinic.md#queue-actions-at-the-desk). The board also has a **Now serving** card (tickets being called, with their place) and a search box and view filter
(ticket, name, patient number, complaint or place; all, being called, self check-in). Counters are not a separate entity: a counter is a service point
(its `location` is where the call sends the patient).

## Printing and devices (phase 5, migration `0139`)

**Ticket printing.** A kiosk check-in queues one `kiosk_print_job` per visit (a unique index; asking for the same ticket
again returns the job already queued; a kiosk queues nothing unless staff turned **Prints tickets** on for it). A job holds only what is on
the ticket — number, service, facility, time, a plain instruction — never a patient; its content is fixed by a trigger
and it moves forward only (`queued → printing → printed | failed`, back to `queued` for a retry, `cancelled` while it
waits). A **local print agent** (`tools/kiosk-print-agent`, below) pulls the jobs: `POST /kiosk/print/claim` (permission
`kiosk.print.agent`, role `kiosk_print_agent`) hands out the oldest waiting job of one kiosk under a 30-second lease
(`FOR UPDATE SKIP LOCKED`: two agents never get one ticket; a job whose lease ran out is offered again; after 3 attempts
it fails), `POST /kiosk/print/jobs/:id/result` records printed or failed with a short cause (`paper_out`, `offline`,
`error`) and whether to retry, `POST /kiosk/print/heartbeat` reports the printer's state. A ticket not printed within 10
minutes is dropped (`KioskHousekeeping`). The kiosk screen asks `GET /kiosk/print-jobs/:id` (its own jobs only, status
only) every 2 seconds and says "Printing your ticket…", "Your ticket is printed", or — if it failed, was dropped or
nothing happened within 40 seconds — to remember the number and ask the desk; the number is on screen either way. **Reprint**
(`POST /kiosk/admin/print-jobs/:id/reprint`, `kiosk.print.reprint`: receptionist, org_admin): only after the earlier print
finished, with a reason, at most twice per ticket, only while the visit is open and the kiosk in service, audited
`kiosk.print.reprint`; the list of the last 24 hours (`GET /kiosk/admin/print-jobs`, `kiosk.device.read`) shows how each
print went and which can be printed again. A final failure is audited `kiosk.print.failed`.

**Preparing for a printer that is not there yet (migration `0140`).** `kiosk_device.prints_tickets` is false for every new
kiosk: no print job is queued, the kiosk screen says nothing about printing, the devices page shows "Ticket printing off", and
a reprint is refused (`kiosk_not_printing`). Staff turn it on (register form or **Edit**, audited as a change of
`printsTickets`) only once the printer and the print agent have passed the real-hardware checklist in
`docs/runbooks/kiosk-print-agent.md`; turning it off again is always safe. Nothing else changes when a printer is
bought: the agent, the job queue, the reprint and the status reporting already exist and are tested only against simulated
printers. A different printer protocol would be a new `PRINTER_TYPE` in the agent, not an API change.

**Devices.** `kiosk_device.kind` is `kiosk` or `display`: a waiting-room screen is registered like a kiosk, from an account
holding only the `queue_display` role (and no `patient.read`), and reports in with `POST /kiosk/display/heartbeat`
(any holder of `clinic.queue.display`; an account that is not a registered display is simply not monitored; a display in
maintenance or disabled still shows). A kiosk's printer availability is derived (`printerAvailability`): `available`
(last report fine and within 2 minutes), `attention` (paper out, offline, error), `unavailable` (the agent went quiet),
`unknown` (never reported), `none`. Staff **Queue → Devices** (`/queue/devices`, `kiosk.device.read`; registering,
renaming and putting into maintenance need `kiosk.device.manage`) lists each device's status, last activity, version and
printer, registers a device from the accounts that hold its role, and lists the day's kiosk tickets with **Print again…**.
The kiosk web app no longer claims a printer state of its own: the agent, which sees the printer, reports it.

**The waiting-room display's extras** (`queue_display_setting`, `GET|PUT /clinic/queue-display-settings`,
`clinic.configure`, audited `queue-display-setting.update`; staff **Settings → Service points → Waiting-room display**): a
headline and a footer line in the clinic's own words, an accent colour (used only when white text on it keeps a contrast of
at least 4.5, checked when it is saved in the staff app and again when the screen draws it, so branding cannot make the
number hard to read), and **calls by department**: the display then adds, per service point, its latest calls and how many
wait there (`groups`; still ticket labels and places only). The voice announcement is now a **playback queue**
(`apps/staff/src/lib/announcement-queue.ts`): calls are read one at a time, never over one another; the same call (same
ticket, place and call time) is announced once however many events carry it — a recall has a new call time and is
announced again; at most 3 wait and one that waited 45 seconds is dropped; and when the chime, the audio device or the
voice fails the screen says "Announcements are not working on this screen. Your number still appears above."

**The print agent** (`tools/kiosk-print-agent`; runbook `docs/runbooks/kiosk-print-agent.md`): a small Node service on a
machine in the clinic. It signs in to the API as its own restricted account and only **pulls**: it listens on nothing but a
read-only health check on `127.0.0.1` (`GET /health`), accepts no jobs, requires https for the API (http only for
localhost) and refuses a printer outside the clinic's own network. It validates every job against a strict shape, reduces
every text to printable ASCII before it enters the ESC/POS byte stream (so no field can become a printer command), renders
80 mm (48 columns) or 58 mm (32 columns) tickets, prints to a network printer (raw port 9100, with a paper-sensor query), to
an operating-system printer path, or in **dry-run** mode to a folder, and does not print a second copy of a ticket it
already printed when the API offers it again because its report was lost.

**What is and is not verified.** The ticket path, the agent, the screens and the queue are tested end to end — unit tests
(ESC/POS rendering and injection safety, configuration, the pull loop, the API client, the printer drivers against a local
fake, the health server, the announcement queue), API integration tests (the job lifecycle, leases and concurrency,
permissions and facility scope, reprint limits, devices, settings) and a browser journey that runs the real agent as its
own process in dry-run mode and with a printer that cannot print. **No real thermal printer, kiosk, touchscreen or TV has
been tested.** Whether a given model understands the commands and the paper-sensor query, how the operating system's
printer queue behaves, full-screen and wake-lock behaviour, the browser's speech voices and the room's acoustics must be
checked on the target devices before the module is relied on.

## Not built yet

A QR code on the ticket, direct USB printer drivers (a USB printer is reached through the operating system's printer
path), print-agent self-update and remote configuration, an on-screen keyboard (the device's own is expected), Filipino
wording on the kiosk, queue counters as their own entity (a counter is a service point), realtime push of kiosk status
(the devices page reads on load). Hardware behaviour (full screen, touch, printer, voices) is verified only on the target
devices.

## Open questions / assumptions

Privacy notice wording, what a kiosk may collect and how long a pending registration may be kept (24 hours is a default
here) are the organization's decisions (`docs/security/compliance-dependencies.md`).
