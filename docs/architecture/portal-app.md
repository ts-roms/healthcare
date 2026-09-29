# Patient portal ↔ API

`apps/portal` (MyHealth) is a mobile-first Next.js **backend-for-frontend**, built the same way as the staff app ([staff-app.md](staff-app.md)): the browser talks only to the portal's server, tokens live in httpOnly cookies, and the API authorizes every call. Session code is shared through `libs/web-session`.

```
browser ──cookies──▶ portal server (proxy.ts, server components, server actions)
                        │  Authorization: Bearer <patient access token>
                        ▼
                     API /api/v1/portal/*  ──▶ PatientAccessGuard, audit (actor type "patient")
```

## Patient identity and accounts

A portal account belongs to **one canonical patient** (`patient_portal_account`, unique per organization and patient); there is no second patient record. Patients are separate from staff users: separate tables, sessions (`patient_portal_session`), JWT audience (`healthcare-portal`) and guard. A staff token is rejected by portal endpoints and a patient token by staff endpoints.

| Step     | Who     | How                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Consent  | Staff   | Record `portal_access` consent (granted) on the patient. Without it no invitation, sign-in or refresh is allowed; withdrawing it ends portal sessions at their next request.                                                                                                                                                                                                                           |
| Invite   | Staff   | `POST /patients/:id/portal-account/invitations` (`patient.portal.manage`) after checking the patient's identity in person. Returns a one-time code (`XXXXX-XXXXX`) **once**; only its SHA-256 is stored. Valid 72 hours, 5 wrong attempts. Issuing a new code replaces an unused one.                                                                                                                  |
| Activate | Patient | `/activate`: patient number + date of birth + code, then email and password (≥ 12 characters). All wrong details give the same message (so the page cannot confirm patient numbers or birth dates); staff see the specific reason of the latest attempt — code expired, date of birth or code did not match, attempts used — in the portal access panel of the patient record. The code is single-use. |
| Sign in  | Patient | `/login`: email + password, per portal deployment's organization. Repeated failures lock the account temporarily.                                                                                                                                                                                                                                                                                      |
| Disable  | Staff   | `POST /patients/:id/portal-account/disable` with a reason; revokes every portal session. A new invitation re-enables access.                                                                                                                                                                                                                                                                           |

Every step is audited: staff actions as `patient.portal-invite` and `patient.portal-disable`; patient actions (`portal.activate`, `portal.login`, `portal.logout`, `portal.profile-view`) with actor type `patient`, including failures; refresh-token reuse as `portal.session-revoke`.

## Session

| Cookie  | Holds         | Flags                                     | Lifetime                                |
| ------- | ------------- | ----------------------------------------- | --------------------------------------- |
| `hp_at` | Access token  | httpOnly, SameSite=Lax, Secure in prod    | Token TTL minus 30 s                    |
| `hp_rt` | Refresh token | httpOnly, SameSite=Strict, Secure in prod | Until the API's `refreshTokenExpiresAt` |

Names differ from the staff app's (`hc_*`) so the two sessions never mix on one domain. `src/proxy.ts` gates every page except `/login` and `/activate`, refreshes through `POST /portal/auth/refresh` with the same single-flight refresher and failure handling as the staff app (rejected → sign in; busy → 503 retry page), and clears stale cookies when the API ends a session (`/login?reason=session`). The API revokes the session if a rotated refresh token is reused.

## Data

| Area                          | Source                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in, activation, sign-out | API `/portal/auth/*`                                                                                                                           |
| Greeting, Profile             | API `GET /portal/me` (identity only: name, patient number, birth date, sex, clinic, email)                                                     |
| Home, Visits                  | `GET /portal/appointments` (upcoming and the past year; clinic time zone; `canCancel`/`canReschedule`)                                         |
| Book, change, cancel          | `GET /portal/booking/{options,slots}`, `POST /portal/appointments`, `POST /portal/appointments/:id/{reschedule,cancel}`                        |
| Results, result detail        | `GET /portal/results`, `GET /portal/results/trend?testId=`                                                                                     |
| Medicines                     | `GET /portal/prescriptions` (active)                                                                                                           |
| Care plan                     | `GET /portal/care-plans` (active plans: goals, what you can do, what is coming up)                                                             |
| Online consultation           | `GET/PUT/POST /portal/teleconsults/*` (questionnaire, waiting room, video)                                                                     |
| Bills                         | `GET /portal/billing` and `/account`: invoices, coverage, payments, deposits and credit, credit notes, balances (no drafts)                    |
| Messages                      | `GET /portal/messages`, `GET /portal/messages/unread-count`, `POST /portal/messages/:id/read`                                                  |
| Dental (when shared)          | `GET /portal/dental/availability`, `GET /portal/dental/record`, `GET /portal/dental/images/:id/link`, `POST /portal/dental/plans/:id/decision` |

**Patient merge.** After a merge the MyHealth account belongs to the surviving record (moved when only the retired
record had one; otherwise the retired record's account is disabled with reason `merged`; its sessions are revoked, so
the patient signs in again). Every `/portal/*` read (visits, results and trends, medicines, care plans, bills and
account, messages, dental) includes the records merged into the patient (`filedAsPatient`, ADR-0009), and printable
invoices, notes and documents of those records open for the survivor's account. An unmerge moves an account that was
moved at the merge back.

The records endpoints are composed in the API (`apps/api/src/app/portal/portal-records.controller.ts`) from the domains' patient-facing queries, behind `PatientAccessGuard`; every read is audited with actor type `patient` (`portal.appointments-view`, `portal.results-view`, `portal.results-trend`, `portal.prescriptions-view`, `portal.care-plans-view`, `portal.dental-view`). They return only what is meant for the patient: no staff names other than the practitioner, no internal comments, instruments, allergy override reasons or progress notes.

**Results (CLAUDE.md §17).** A result is shown only when it is the current version, **released**, of a test the laboratory marks as releasable to patients (`lab_test.patient_releasable`), and — if critical — after the ordering side has **acknowledged** it, so the patient never learns of a critical value before their care team. While a released result is being corrected it is hidden until the corrected version is released. The portal words each value against the snapshotted range in plain language ("Within the usual range", "Higher than the usual range", "Much higher than the usual range — your care team has been told"; icon, words and colour), shows "Usual range: …", and the result page draws a trend with the range shaded plus the history with each value's range at the time. It does not interpret results; it tells the patient to talk to their doctor (`lib/records.ts`).

**Results-ready notice.** When results of an order become visible to a patient who can use the portal (active account and `portal_access` consent), the API (`apps/api/src/app/portal/patient-result-notices.ts`) sends one SMS per order per day — or an email if SMS is not possible (no mobile, opted out) — using `lab.results-available`, which names no test or value. A correction of a visible result sends an "updated" notice. Communication preferences apply (category `clinical`). Production SMS still needs a provider (see `docs/domains/notification.md`).

**Online consultations.** Upcoming online visits in Visits and Home open `/consultations/[appointmentId]`, which walks the patient through: the pre-consult questions (reason, symptoms, medicines, new allergies, red flags, where they are, a callback number, and the acknowledgement of an online consultation's limits) — ticking a red flag shows "This may be an emergency: call 911 or go to the nearest emergency room" at once; the waiting room (from 30 minutes before; the page refreshes every 5 s until the doctor starts); **Join the video call** (`VideoCall`; camera and microphone permission; the call is not recorded) — or "your doctor will call you" without video; then the doctor's instructions, or the recommendation to be seen in person. Stage logic: `lib/teleconsult.ts`.

**Online booking.** `/appointments/book` walks the patient through the kind of visit (only visit types the clinic opened
for online booking), the clinic (when there is more than one), the doctor ("any available doctor" or one by name), a day
and an open time (morning/afternoon), an optional reason, then confirm. `/appointments/[id]` moves a visit to another
open time with the same doctor, or cancels it (optional reason) — offered only while the API says `canReschedule` /
`canCancel`. The rules live in the clinic domain (`libs/clinic/src/lib/domain/patient-booking.ts`) and are re-checked on
every call: book at least 2 hours ahead and at most 60 days out, only on the schedule's slot grid, at most 3 open
self-bookings, changes until 2 hours before; rescheduling only for online-bookable visit types. Patient changes are
audited with actor type `patient`, carry no staff user (`appointment.booked_by_patient`, `updated_by_patient`), and are
confirmed by SMS (`appointment.self-service`: facility, date and time only); the usual reminder follows. Refusals are
shown in plain words (`lib/booking.ts`). An online consultation booked this way continues with the questionnaire and
waiting room above.

**Messages.** `/messages` lists the patient's in-app messages newest first — results-ready notices, booking
confirmations, "we missed you" after a no-show, care-plan follow-up reminders and messages staff send from the patient
record ("Message in MyHealth", `clinic.message`). New ones are labelled and marked read once shown; the navigation shows
the unread count. Each message links to where to act (results, visits, booking; `lib/messages.ts`). Messages are
one-way: the page tells patients to call the clinic, or 911 in an emergency.

**Dental.** Off unless the organization turns on "Dental records in MyHealth" (`/dental/settings`, `dental.settings.manage`;
off by default). The navigation shows **Dental** only when `GET /portal/dental/availability` says records are shared and
the patient has something to show. `/dental` lists treatment plans (each item: tooth in the record's notation with its
plain name, procedure, the patient's decision and status — icon, words and colour), treatments done (date, tooth and
sides, dentist, clinic) and a read-only tooth chart summary with a key and a plain-language list. Only the dental
library's patient read model is returned (`libs/dental/src/lib/portal/dental-patient-access.ts`): never examination or
tooth notes, decision notes, periodontal charts, images, procedure codes or anything entered in error. Fee estimates
(the work still ahead at the clinic's listed prices, with what they are not and the organization's note) appear on open
plans only when the organization turns them on; a treatment that may turn out to be another shows a range (`estimatedFeeHigh`, `mayBecome`; totals carry both ends); a MyHealth decision sends the estimate the patient saw (both ends) and is refused
(`estimate_changed`) if prices changed since. `GET /portal/dental/record` is audited `portal.dental-view` (actor type `patient`) and refused (403, audited as
denied) while records are not shared. Images a dentist shared are listed and opened through a short-lived link
(audited as the patient). When the organization also allows online decisions, a plan awaiting the patient's decision
shows a form (tick items to accept, confirm the clinic's own acknowledgement, send). A shared image or a plan awaiting
the patient's decision is announced in the inbox and by SMS or email (`dental.record-update`, no clinical detail; the
inbox links to `/dental`). Wording: `lib/dental.ts`. See
`docs/domains/dental.md`.

Patients cannot edit their record; Profile tells them to ask the clinic.

## Time zone

Visits and online consultations are shown in their own facility's time zone (each row carries it). Everything else —
results, prescriptions, bills, messages, the greeting and the design system's dates (the result trend chart) — is shown
in the patient's clinic's zone: `GET /portal/me` returns `timeZone`, the zone of the facility where the patient was
registered. Pages pass it to the formatters in `lib/records.ts`, `lib/messages.ts` and `lib/greeting.ts` (a required
argument), and `PortalShell` sets it for `@healthcare/ui` before the page renders.

## Help

`/help` (open to everyone, signed in or not, so a patient who cannot sign in can still read it; `OPEN_PATHS` in `proxy.ts`)
renders chapter 12 of the user manual (`docs/manual/12-patient-portal.md`) without its staff sections (`lib/guide.ts`), read
from the repository on the server when served (`lib/guide-content.ts`). Linked from the sign-in page (**How to use MyHealth**)
and the header (**Help**).

## Configuration

| Variable                   | Default                        | Meaning                                                   |
| -------------------------- | ------------------------------ | --------------------------------------------------------- |
| `API_BASE_URL`             | `http://localhost:3333/api/v1` | Where the portal's server reaches the API                 |
| `PORTAL_ORGANIZATION_CODE` | `demo`                         | The organization this portal serves (`organization.code`) |

## Not yet

Password reset (today: ask the clinic for a new code), email verification, MFA for patients, proxy access for guardians and dependents, choosing another doctor when rescheduling (cancel and book again), a waiting list for full days, per-clinic booking rules, replying to messages (two-way messaging), patients managing their own communication preferences, push notifications (needs the mobile app).
