# Notifications (`libs/notification`, `apps/notification-worker`)

## Purpose

One abstraction for SMS, email, push and in-app messages (CLAUDE.md §27), with
consent/preference enforcement and full delivery tracking.

## Entities

`notification` (recipient, channel, category, template key + version,
destination, variables, status, attempts, provider ids, timestamps),
`notification_attempt` (one row per delivery attempt).

Statuses: `queued → sending → sent` (or back to `queued` for retry, then
`failed`), `delivered` (in-app), `suppressed` (not allowed; reason stored), `cancelled`.

## Templates

Code-defined, versioned, with Zod-validated variables (`templates.ts`).
External channels must not carry clinical detail. Templates:
`patient.registered` (SMS/email), `appointment.reminder` (SMS/email), `security.mfa-enabled` (email/in-app),
`portal.password-reset` and `portal.password-changed` (email only, category `security`, **internal**: sent by the platform to a MyHealth account's sign-in email, never through `POST /notifications`; the reset link is a `secretVariables` entry blanked in the stored row once sent, failed or suppressed),
`appointment.waitlist-opened` (SMS or email; the clinic and the day only — a patient on the MyHealth waiting list is told a time may have opened), `appointment.waitlist-offer` (SMS or email; the clinic, the day and how long the time is held — the time itself is shown after sign-in; migration `0096`), and `appointment.self-service` (SMS, email and a MyHealth inbox copy),
`portal.email-verification` (email only, category `security`, internal; the 6-digit code is a secret variable) and `portal.security-alert` (email only, internal; two-step verification turned on/off/reset by the clinic, a recovery code used, recovery codes renewed, sign-in email changed — no health information), both possibly sent to an address other than the account's (`send(actor, input, { securityDestination })`, honoured only for internal security email templates and never passed by the public endpoint),
`staff.message` (in-app only), `lab.result-notice` (in-app to the ordering practitioner: order and patient numbers only),
`lab.quality-notice` (in-app to laboratory quality managers: a nonconformance opened, a QC run rejected, a temperature
reading missed or a competency reassessment due — the last also to the person; record numbers, instrument, unit, test
or section and staff name only, with a link to the page),
`lab.results-available` (SMS, or email when SMS is not possible, plus a MyHealth inbox copy, to patients who use
MyHealth: "new results" or "a result was updated", naming no test and no value), `appointment.self-service`
(SMS + in-app: the patient booked, moved or cancelled in MyHealth), `appointment.no-show` (SMS + in-app: "we missed
you", facility and date only), `care-plan.follow-up-due` (SMS + in-app, category `clinical`: a care-plan follow-up is
due or overdue, naming no condition, test or plan), `clinic.message` (in-app only: subject and text written by staff).
`management.report-ready` (in-app and email to the named recipients of a scheduled management report: the schedule
name, the period and a link to the reports page — never a figure; `docs/architecture/management-dashboard.md`).

## Staff in-app messages (staff inbox)

In-app messages to staff (`recipient.type = user`) are read at `GET /me/notifications` (the latest 100, rendered, with
`href` — the staff page a message is about, when its template gives one) and counted at
`GET /me/notifications/unread-count`; `POST /me/notifications/:id/read` marks one read. Only the recipient sees or marks
them. The staff app shows the unread count on a bell in the top bar and the messages at `/notifications` (open marks
the message read and goes to its page).

## Patients' in-app messages (MyHealth inbox)

In-app messages to a patient are delivered only when the patient has an active MyHealth account with `portal_access`
consent (otherwise `suppressed: no_portal_account`); recorded preferences apply as for other channels. The patient reads
them at `GET /portal/messages` (audited `portal.messages-view`), sees an unread count, and marks them read
(`POST /portal/messages/:id/read`, own messages only). These are notices: replies happen in conversations (`docs/domains/patient-messaging.md`), whose
messages are not notifications and never leave MyHealth. Free text written by staff exists only as `clinic.message`
(notices) and conversation messages, neither of which can leave the platform. `portal.message-received` (SMS/email, no
content), `portal.message-new` (in-app to staff) and `portal.message-overdue` (in-app to staff, hourly, once per
breached response target) announce conversation messages.

## Communication log

What the platform sent, or did not send, to patients across the organization (CLAUDE.md §16: communication history). Every request is stored,
including those suppressed by consent or preferences, so the log is complete. Staff in-app messages are not part of it: the staff inbox is private
to its recipient.

- `NotificationService.communicationLog(organizationId, query)` — messages to patients created over local days in the Philippines (`from`..`to`,
  at most 92 days; notifications belong to no facility), newest first, filtered by channel, category, status (`not_sent` = failed, suppressed or
  cancelled), template and patient (records merged into the patient included), paged (`page`, `pageSize` ≤ 100). Each row: kind of message
  (`templateKey` and a staff-facing `templateLabel` from `TEMPLATE_LABEL`), channel, category, status, the reason when suppressed, the destination
  masked, attempts, who asked for it (`createdBy`; null when the platform sent it on its own) and the delivery times. **Never** the rendered
  message, its variables or the full destination.
- `communicationSummary(organizationId, from, to)` — counts by status, by channel (sent / not sent), suppressed by reason and by template. No patients.
- API (`apps/api/src/app/communications`, which adds the patient's number and name and the requester's name):
  `GET /api/v1/communications` and `GET /communications/export` (CSV, formula-safe, at most 5,000 rows, a note when cut) need `notification.read`
  **and** `patient.read` and are audited (`notification.log.view`, `notification.log.export`, with the filters and row counts);
  `GET /communications/summary` needs `notification.read` only and names no patient.
- A patient's own history stays `GET /notifications?patientId=` (latest 200, audited `notification.list`), now with `templateLabel`.
- Staff: **Communications** (`/communications`: period, status, channel, kind and message filters; figures; breakdowns; list; CSV) and
  `/patients/[id]/communications` (the patient's history with their preferences; linked from **Consent & communication** on the record).
- Migration `0084`: index `notification_patient_log_idx` (organization, created_at, id for patient recipients); `notification.read` now also for
  receptionists and records officers (the desk handles reminders and "I got nothing").
- Campaigns and segments are `libs/crm` (`docs/domains/crm.md`): their messages appear here under the kind "Outreach campaign".
- Not built: resending or cancelling from the log, delivery reports from SMS providers (none is selected), per-facility filtering
  (notifications carry no facility).

## Ports

| Port                 | Implementations                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RecipientDirectory` | `AppRecipientDirectory` in `apps/api` (patients via patient policy, in-app only with an active MyHealth account; staff email/in-app)                                                                          |
| `NotificationQueue`  | BullMQ (`REDIS_URL`); recording queue in tests                                                                                                                                                                |
| `ChannelSender`      | SMTP email (`SMTP_URL`); Web Push (`WebPushSender`, when the VAPID keys are set); logging sender in dev/test; `UnconfiguredSender` in production for SMS (and push without keys) until providers are selected |

## Worker

Claims notifications atomically, retries with exponential backoff (BullMQ, 5
attempts), and every minute re-enqueues stranded notifications (queued > 2
min, or stuck in `sending` > 15 min). At-least-once delivery.

## Permissions

`notification.send`, `notification.read` (the communication log and a patient's communication history; org_admin, physician, dentist,
receptionist, records_officer — the last two from migration `0084`); the in-app inbox needs only authentication.

## Dependencies

SMS providers, and store publication of the mobile app: see `docs/interoperability/dependencies.md`.

## Push (browsers and the mobile app)

Migration `0079` (`push_subscription`). Standard Web Push (RFC 8030, message encryption RFC 8291, VAPID): no provider account, only the
platform's own key pair — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` or `https:` contact), all three or none
(`npx web-push generate-vapid-keys`). Without them MyHealth does not offer push. Web Push needs a secure address (https, or localhost).

- **Devices.** After the patient allows notifications in their browser, MyHealth registers the device against their MyHealth account
  (`POST /portal/push/subscriptions`; up to 5 devices; `PushSubscriptionService`). A browser that another account signs in on moves to
  that account. A device the push service reports gone (404/410) or that fails 5 times in a row is dropped; the patient can remove a
  device or ask for a test (`portal.push-test`).
- **Channel.** `push` is a normal notification channel: `destination` is the MyHealth account and the sender delivers to every active
  device of it (`WebPushSender`; accepted by at least one device = sent; every device failing for a reason that may pass is retried;
  none left fails for good). The recipient directory resolves it only for an active account with portal consent and at least one
  device, and the patient's preferences apply as for SMS and email (care and administrative on, outreach off unless chosen).
- **Content.** A push carries a title, one line and a page — the same content-free text an SMS may carry (a result, a message, a
  record or a dental item is _waiting_; never what it says). Templates that may use it list `push` among their channels.
- **Push first** (`apps/api/src/app/portal/patient-push.ts`): for a patient with a device, the results-ready, records, dental and
  "a message is waiting" notices go to the device instead of SMS or email; without a device there is no push attempt (no suppressed row)
  and SMS then email work as before. The waiting-list notice stays SMS or email.
- **Mobile app** (migration `0081`; `docs/architecture/mobile-app.md`): the MyHealth app registers its Expo push token
  (`POST /portal/push/mobile-devices`) as a `push_subscription` row with `kind = 'expo'` — same 5-device limit, removal, failure
  handling and preferences. `WebPushSender` sends to phones through the Expo push service (`ExpoPushTransport`; `EXPO_PUSH_ENABLED=true`,
  optional `EXPO_ACCESS_TOKEN`), with the same content-free payload. `DeviceNotRegistered` drops the device; a service failure is retried.
- **Expo receipts** (migration `0083`, `push_ticket`; `ExpoPushReceipts`, every 15 minutes in the notification worker when
  `EXPO_PUSH_ENABLED`): the sender keeps each Expo ticket with its notification; 15 minutes later its receipt is read (1,000 ids per request,
  one worker at a time). `ok` → the notification becomes `delivered` (`delivered_at`: handed to Apple/Google, not read by the patient);
  `DeviceNotRegistered` → the device is dropped at once; `InvalidCredentials` / `MismatchSenderId` → logged as a setup problem, never held
  against the device; other errors count toward the 5-failure limit; no receipt within a day → `expired`. Answered tickets are kept 30 days.
- Not built: push for staff, topics or badges, delivery receipts from the browser (Web Push gives none).
