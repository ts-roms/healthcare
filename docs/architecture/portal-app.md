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
| Sign in  | Patient | `/login`: email + password, per portal deployment's organization, then the authenticator code if two-step verification is on. Repeated failures lock the account temporarily.                                                                                                                                                                                                                          |
| Reset    | Patient | `/forgot-password` → email link → `/reset-password`: see [Password reset](#password-reset).                                                                                                                                                                                                                                                                                                            |
| Disable  | Staff   | `POST /patients/:id/portal-account/disable` with a reason; revokes every portal session. A new invitation re-enables access.                                                                                                                                                                                                                                                                           |

Every step is audited: staff actions as `patient.portal-invite` and `patient.portal-disable`; patient actions (`portal.activate`, `portal.login`, `portal.logout`, `portal.profile-view`, `portal.password-reset-request`, `portal.password-reset`, `portal.email-verification-send`, `portal.email-verify`, `portal.email-change`, `portal.login-mfa-challenge`, `portal.mfa-*`) with actor type `patient`, including failures; refresh-token reuse as `portal.session-revoke`.

## Password reset

A patient who forgot the password asks for a link on `/forgot-password` (`POST /portal/auth/password-reset/request`, email only), opens it (`/reset-password#token=…`) and chooses a new password with their date of birth (`POST /portal/auth/password-reset/confirm`). `libs/patient/src/lib/portal/portal-password-reset.service.ts`, table `patient_portal_password_reset` (migration `0072`), messages by `apps/api/src/app/portal/portal-security-notices.ts`.

- **No account enumeration.** Asking always answers `202 accepted`, for unknown emails, other clinics, disabled accounts and withdrawn consent alike; the specific reason is only in the audit trail (`portal.password-reset-request`, outcome `failure`). Rate-limited like sign-in, and at most **3 links per account per hour** (further requests are answered the same and audited as `rate_limited`). A newer link replaces older ones.
- **The token** is 256 random bits, stored only as its SHA-256, valid **30 minutes**, works **once**. The link puts it after the `#` so it never reaches server logs or Referer headers; the page reads it in the browser only. It is sent to the account's sign-in email through `NotificationService` (template `portal.password-reset`, category `security`, email only — `AppRecipientDirectory` resolves the account's email and only while it can sign in; no communication preference applies). The template is `internal`: staff cannot send it through `POST /notifications`. Its link is a secret variable, blanked in the stored notification once sent, failed or suppressed. Without `PORTAL_BASE_URL` no link is sent (in development the API log shows it, since no mail provider is set up).
- **Date of birth is required to choose the password**, because the sign-in email **may not be verified** (see [Email verification](#email-verification); it is unverified until the patient enters a code): a mistyped email at activation would otherwise let its owner take over the account. Verified or not, the reset asks for it. Five wrong birth dates burn the link (`exhausted`); the patient's only feedback is one generic message.
- **On success** the password changes, every session of the account is revoked (`password_reset`), a sign-in lockout is cleared, other open links are replaced, the patient is signed out and sent to sign in, and a "your password was changed" email (`portal.password-changed`) goes to the same address. Audited as `portal.password-reset` (actor type `patient`).
- Staff can still disable access and issue a new code (patients whose email is wrong, or who cannot reach it).
- Residual: whether an email exists is not visible in the answer, but sending a message takes a little longer than not sending one; the request rate limits bound how much can be learned that way.

## Email verification

The sign-in email starts **unverified** (the patient typed it at activation). On **MyHealth → Profile → Sign-in security** (`/security`; Home shows a prompt while unverified) the patient asks for a code (`POST /portal/email/verification`), receives six digits at that address and enters them (`…/confirm`). `libs/patient/src/lib/security/portal-email.service.ts`, table `patient_portal_email_verification` (migration `0073`, `email_verified_at` on the account).

- A code lives **15 minutes** and **5 tries** (then it is burned), is stored only as `SHA-256("<id>:<code>")`, compared in constant time, and is blanked in the stored notification once sent (`portal.email-verification`, `secretVariables`). A new code replaces older ones; **one per minute, five per hour** per account. Wrong codes are refused with 422 (never 401, which would end the session).
- **Changing the email** (`POST /portal/email/change`): needs the password (a wrong one counts toward the sign-in lockout) and, with two-step verification on, a current authenticator or recovery code. The code goes to the **new** address; nothing changes until it is entered. Then the email is replaced and verified in one step, every other session ends (`email_changed`), and the **old** address is told (`portal.security-alert`, event `email_changed`, the new one partly hidden). An address used by another account is refused (`email_in_use`), as at activation.
- Verification proves the mailbox to the patient's own signed-in session; it does not change what a password reset asks for (still the date of birth) and blocks nothing else in MyHealth.
- Staff see "Email verified / not verified" on the patient record's portal panel.

## Two-step verification

Patients can add an authenticator app (TOTP, RFC 6238: 6 digits, 30 s, one step of drift) after the password. `libs/patient/src/lib/security/portal-mfa.service.ts`, columns on `patient_portal_account` and table `patient_portal_recovery_code` (migration `0073`), sign-in in `PortalAccountService.login` and `POST /portal/auth/mfa/verify`.

- **Turning on** (`/security`): password → setup key (grouped, plus an `otpauth://` link that opens the app on a phone; no QR image is drawn) → a code from the app → **ten recovery codes**, shown once. Needs a **verified email**, so notices about it reach a confirmed mailbox (a database check keeps `mfa_enabled` and `email_verified_at` together). The secret is sealed with `MFA_ENCRYPTION_KEY`.
- **Signing in:** a right password on an account with it returns `{ status: "mfa_required", challengeToken }` (a 5-minute token of type `patient_mfa_challenge`, not usable as a session; the portal keeps it in an httpOnly cookie) and audits `portal.login-mfa-challenge`; the session opens only after `POST /portal/auth/mfa/verify` with the app's code **or a recovery code**. Nothing is given away before the password is right.
- **A code works once.** The last accepted time step is stored (`mfa_last_used_step`): a repeated code, or an older one, is refused, so a shoulder-surfed code is useless. A recovery code is spent atomically (`used_at`); only hashes bound to the account are stored.
- **Wrong codes count toward the same lockout as wrong passwords** (5 in a row → about 15 minutes); the second step is also refused while locked.
- **Turning off / new recovery codes** need the password and a current code (recovery codes cannot make new recovery codes). Every change is audited (`portal.mfa-setup-start`, `portal.mfa-enable`, `portal.mfa-disable`, `portal.mfa-recovery-codes`) and emailed to the account (`portal.security-alert`); using a recovery code tells the patient how many are left. A password reset does **not** turn it off.
- **Lost the app and the codes:** the patient asks the clinic, which — after checking identity in person — uses **Turn off two-step verification** on the patient record (`POST /patients/:id/portal-account/mfa-reset`, `patient.portal.manage`, reason required): it is turned off, recovery codes deleted, every session ended (`mfa_reset`), audited as `patient.portal-mfa-reset`, and the patient is told by email. The patient can set it up again when they sign in.
- Not built: an organization policy requiring it, SMS codes, WebAuthn/passkeys, trusted devices, a QR image.

## Session

| Cookie  | Holds         | Flags                                     | Lifetime                                |
| ------- | ------------- | ----------------------------------------- | --------------------------------------- |
| `hp_at` | Access token  | httpOnly, SameSite=Lax, Secure in prod    | Token TTL minus 30 s                    |
| `hp_rt` | Refresh token | httpOnly, SameSite=Strict, Secure in prod | Until the API's `refreshTokenExpiresAt` |

Names differ from the staff app's (`hc_*`) so the two sessions never mix on one domain. `src/proxy.ts` gates every page except `/login`, `/activate` and `/forgot-password` (`/reset-password` and `/help` open for everyone, signed in or not), refreshes through `POST /portal/auth/refresh` with the same single-flight refresher and failure handling as the staff app (rejected → sign in; busy → 503 retry page), and clears stale cookies when the API ends a session (`/login?reason=session`). The API revokes the session if a rotated refresh token is reused.

## Data

| Area                            | Source                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in, activation, sign-out   | API `/portal/auth/*`                                                                                                                                                                                                                                                                                                 |
| Greeting, Profile               | API `GET /portal/me` (identity only: name, patient number, birth date, sex, clinic, email)                                                                                                                                                                                                                           |
| Home, Visits                    | `GET /portal/appointments` (upcoming and the past year; clinic time zone; `canCancel`/`canReschedule`)                                                                                                                                                                                                               |
| Book, change, cancel            | `GET /portal/booking/{options,slots}`, `POST /portal/appointments`, `POST /portal/appointments/:id/{reschedule,cancel}`                                                                                                                                                                                              |
| Results, result detail          | `GET /portal/results`, `GET /portal/results/trend?testId=`                                                                                                                                                                                                                                                           |
| Medicines                       | `GET /portal/prescriptions` (active)                                                                                                                                                                                                                                                                                 |
| Care plan                       | `GET /portal/care-plans` (active plans: goals, what you can do, what is coming up)                                                                                                                                                                                                                                   |
| Immunizations                   | `GET /portal/immunizations` (doses given here, reported or imported, by vaccine; never doses not given, entries in error, notes or lot details; a guardian acting for a dependent may read it; audited `portal.immunizations-view`)                                                                                  |
| Health history                  | `GET /portal/health-history` (past procedures and illnesses, family history and its state, the current social history; no staff notes, entries in error or names; substance use and sexual history only for the patient themself, never a guardian acting for them; read-only; audited `portal.health-history-view`) |
| Online consultation             | `GET/PUT/POST /portal/teleconsults/*` (questionnaire, waiting room, video)                                                                                                                                                                                                                                           |
| Bills                           | `GET /portal/billing` and `/account`: invoices, coverage, payments, deposits and credit, credit notes, balances (no drafts)                                                                                                                                                                                          |
| Messages                        | `GET /portal/messages`, `GET /portal/messages/unread-count`, `POST /portal/messages/:id/read`                                                                                                                                                                                                                        |
| Dental (when shared)            | `GET /portal/dental/availability`, `GET /portal/dental/record`, `GET /portal/dental/images/:id/link`, `POST /portal/dental/plans/:id/decision`                                                                                                                                                                       |
| Documents                       | `GET /portal/documents`, `GET /portal/certificates/:id/link`, `GET /portal/referrals/:id/link`, `POST /portal/records-requests`, `POST /portal/records-requests/:id/withdraw`, `GET /portal/records-requests/documents/:id/link`                                                                                     |
| Email and two-step verification | `GET /portal/email`, `POST /portal/email/verification`, `POST /portal/email/verification/confirm`, `POST /portal/email/change`, `GET /portal/mfa`, `POST /portal/mfa/setup`, `POST /portal/mfa/enable`, `POST /portal/mfa/disable`, `POST /portal/mfa/recovery-codes`, `POST /portal/auth/mfa/verify`                |
| Password reset                  | `POST /portal/auth/password-reset/request`, `POST /portal/auth/password-reset/confirm`                                                                                                                                                                                                                               |
| Notification settings           | `GET /portal/communication-preferences`, `PUT /portal/communication-preferences`                                                                                                                                                                                                                                     |
| Privacy and consents            | `GET /portal/consents`, `POST /portal/consents/:type/withdraw`                                                                                                                                                                                                                                                       |

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
open time — with the same doctor or another one at the same clinic — or cancels it (optional reason) — offered only while the API says `canReschedule` /
`canCancel`. The rules live in the clinic domain (`libs/clinic/src/lib/domain/patient-booking.ts`) and are re-checked on
every call, with each clinic's own rules (`facility_booking_rule`, migration `0077`; by default at least 2 hours ahead, at most 60 days
out, at most 3 open self-bookings, changes until 2 hours before), only on the schedule's slot grid; rescheduling only for
online-bookable visit types. Where the clinic turns on its **waiting list**, a day with no open times offers "Tell me if a time opens"
(`GET/POST /portal/booking/waitlist`); the patient is texted or emailed when a time may have opened (no time, doctor or reason in
the message) and books it themselves, and lists or removes their requests under Visits. See `docs/domains/clinic.md`
("Online booking rules and the waiting list"). Patient changes are
audited with actor type `patient`, carry no staff user (`appointment.booked_by_patient`, `updated_by_patient`), and are
confirmed by SMS (`appointment.self-service`: facility, date and time only); the usual reminder follows. Refusals are
shown in plain words (`lib/booking.ts`). An online consultation booked this way continues with the questionnaire and
waiting room above.

**Conversations (two-way messaging, migration `0076`; `libs/patient/src/lib/messaging`, `docs/domains/patient-messaging.md`).** `/messages` starts with **Your conversations** and **New message** (`/messages/new`: topic, subject, text up to 2,000 characters; `/messages/[threadId]`: the exchange and a reply box). Every place the patient writes says MyHealth is not for emergencies and that messages are read during clinic hours. At most 5 open conversations and 10 messages an hour; text only; a conversation the clinic closed takes no more messages (start a new one). The clinic replies from staff `/messages` (`patient.message.read|manage`); the patient gets a text or email that a message is waiting (`portal.message-received`, no name, subject or content) and the navigation badge counts unread replies together with notices.

**Notices.** Below the conversations, `/messages` lists the patient's in-app notices newest first — results-ready notices, booking
confirmations, "we missed you" after a no-show, care-plan follow-up reminders and messages staff send from the patient
record ("Message in MyHealth", `clinic.message`). New ones are labelled and marked read once shown; the navigation shows
the unread count. Each message links to where to act (results, visits, booking; `lib/messages.ts`). Messages are
read-only: a notice is not a conversation; questions go through **New message**.

**Documents** (`/documents`, a **Documents** button on Home; `portal-documents.controller.ts`, audited `portal.documents-view`): the patient's issued medical certificates (purpose, visit date, practitioner, rest days — never the findings), their referrals (to whom and the specialty, the date in the clinic's time zone, the referring practitioner, urgency when not routine, where it stands in plain words — never the reason or summary; the letter through a short-lived audited link, none for a cancelled referral; a `records.update` notice "a referral letter from your visit is ready" when one is made) and their records requests with the records office's note or reason and the documents shared, each opened through a short-lived audited link; a form to ask for copies (what, period, details, purpose; at most 3 open) and **Withdraw this request**. The `records.update` message links here.

**Notification settings** (`/notification-settings`, linked from Profile; `libs/patient/src/lib/preferences`, migration `0071`): the patient chooses, for **text message, email and push** and each kind of message (care — `clinical`; appointments and bills — `administrative`; optional check-in reminders — `outreach`), whether the clinic may send it. It is the same `patient_communication_preference` row the notification service already reads (`resolvePatientContact`), so a choice applies to the next message; with no choice, care and administrative messages are sent and outreach is not. In-app messages are the MyHealth inbox itself (ending them means withdrawing MyHealth) and push needs the mobile app, so neither is offered. The screen shows where each channel would reach the patient (number and address masked); changing them stays a clinic change. Only changed choices are sent; switching off care messages on every channel shows a warning. The row records whether the patient (`updated_by_portal_account`) or a staff user (`updated_by`) set it last — exactly one, enforced by the database — and every change is audited as `portal.communication-preferences` (actor type `patient`, before/after), reads as `portal.communication-preferences-view`. Staff see the same choices on the patient record. Wording: `lib/notification-settings.ts`.

**Push notifications** (`/notification-settings`, "Notifications on your devices"; `apps/portal/public/sw.js`, `src/lib/push.ts`; `docs/domains/notification.md`, "Push"; migration `0079`): where the platform has its VAPID keys, a patient can turn on notifications for the phone or computer they are using — the browser asks permission, a service worker shows the notice, and the device is registered with the account (`GET/POST /portal/push…`, audited `portal.push-register`, `portal.push-remove`, `portal.push-test`). They see and remove their devices, send themselves a test, and switch push per kind of message with the other channels. A notice says something is waiting, never what; tapping it opens MyHealth (sign-in first). It needs a secure address and a browser with Web Push (Safari on iPhone needs MyHealth added to the Home Screen); otherwise the screen says so and text and email carry on.

**Privacy and consents** (`/privacy`, linked from Profile; `libs/patient/src/lib/consents`, migration `0069`): each consent recorded
for the patient — what it covers in plain words, given / withdrawn / not given / expired, and its history ("at the clinic" or "by you in
MyHealth"; never staff names or notes; audited `portal.consent-view`). After confirming what it means, the patient may withdraw consent to online
consultations, sharing with their HMO, sharing with PhilHealth, research and MyHealth itself (`PATIENT_WITHDRAWABLE_CONSENTS`, only while given);
data processing and general treatment consent are withdrawn with the clinic, which explains what it means for care (assumption to confirm with
the organization's data protection officer). A withdrawal is a new, append-only consent decision recorded by the MyHealth account
(`recorded_by_portal_account`, electronic, effective at once; audited `portal.consent-withdraw`; event `PatientConsentWithdrawn`); the database
allows a patient's account to record only electronic withdrawals and every decision exactly one recorder. Withdrawing MyHealth revokes every
session of the account in the same transaction and signs the patient out (`/login?reason=access_withdrawn`); signing in is refused until the clinic
records a new grant. Staff see the decision on the patient record marked "by the patient in MyHealth". Wording: `lib/consents.ts`.

**Giving a consent online** (migration `0078`; `libs/patient/src/lib/consents`). The platform ships **no consent wording**. An organization writes its own for
telemedicine, HMO sharing, PhilHealth sharing and research (staff `/admin/consent-wording`, `consent.wording.manage`, org_admin): a title, the text and the
statement the patient confirms, each save an immutable version (`consent_text`), and "stop offering online" is a version too. A consent is offered in MyHealth
only while its latest version is offered and it is not already in effect (`canGive`). The patient opens **Read and give consent** (`/privacy/[type]`;
`GET /portal/consents/:type/wording`, audited `portal.consent-wording-view`), ticks the confirmation and gives it (`POST /portal/consents/:type/give`,
`acknowledged: true` and the version id): recorded electronically by their account as an ordinary append-only consent that keeps the wording version
(`patient_consent.consent_text_id`), effective at once, audited `portal.consent-give`, event `PatientConsentGiven` (ids only). If the wording changed while
they read, the give is refused (`409 consent_wording_changed`) and they read the new one. The database allows the patient's account to record only
electronic withdrawals, or grants against a wording version. Consent to data processing and general treatment, and to MyHealth itself, are still given at the
clinic. Whether an electronic consent meets the organization's legal needs is for its data protection officer to decide; nothing here states it does.

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

The **API** also needs `PORTAL_BASE_URL` (the portal's public address, e.g. `https://myhealth.example.ph`) and, for real email, `SMTP_URL`, or password-reset links are not sent.

## Guardians and dependents

A person with their own MyHealth account may act for another person's record (a child, an older relative) only through a **grant the clinic made** (`portal_proxy_grant`, migration `0080`; staff `patient.portal.proxy.manage`: org_admin, receptionist, records_officer). The clinic checks who they are and by what right they act, by its own procedure, and records the relationship, the basis (`parent_of_minor`, `legal_guardian`, `authorized_by_patient`, `other_authorized`), a note of what was checked and an optional end date. The platform encodes no rule about age of majority, guardianship or authority (see `docs/security/compliance-dependencies.md`).

- **Scopes:** `view` (reads) and `act` (anything that changes something); `act` needs `view`. A view-only grant refuses changes with `proxy_view_only`.
- **When a request acts:** the client sends `X-Acting-For: <dependent patient id>`. `PatientAccessGuard` authenticates the guardian's own session first, then `PortalProxyService.actingFor` requires a live grant (not ended or past its end date), an active dependent record and the **dependent's own `portal_access` consent** in effect (recorded at the clinic — by the guardian for a child). Anything else is `403 proxy_not_allowed`, worded the same for every cause.
- **Opt-in routes:** a route accepts the header only if it is marked `@ProxyAllowed()` (records, booking, waiting list, billing, dental, documents and records requests, teleconsultation, messages and conversations, `me`). Sign-in security, notification settings, consents, devices and the grants themselves stay the account holder's own and refuse the header.
- **Audit:** every audited action of an acting request records the guardian's account as the actor, the dependent as the patient and `proxyGrantId` in the metadata. Conversation messages written this way are marked `via_guardian` and shown to staff as "written by a parent or guardian".
- **Ending:** the clinic (with a reason), the person acted for (an adult with an account), or the guardian can end a grant; ended grants stay as history. The dependent's own account, if any, is told by email when access is given or ends (`portal.security-alert`, `proxy_access_granted|ended`); a child has no account to tell.
- **Limits:** a guardian may act for at most 10 people; one live grant per pair. A withdrawn portal consent or a merged, inactive or deceased record stops access at the next request.
- **App:** MyHealth `/people` lists whom you may act for and who may act for you; opening a person sets an httpOnly cookie (`hp_for`) that the server adds as the header (never on the own-account API paths) and shows a banner on every page; the own-account screens redirect back to `/people` while acting. Staff: **Guardians and caregivers** in the patient record's MyHealth card.

## Not yet

push to a mobile app (there is none yet; browser push is built).
