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
`staff.message` (in-app only), `lab.result-notice` (in-app to the ordering practitioner: order and patient numbers only),
`lab.quality-notice` (in-app to laboratory quality managers: a nonconformance opened, a QC run rejected, a temperature
reading missed or a competency reassessment due — the last also to the person; record numbers, instrument, unit, test
or section and staff name only, with a link to the page),
`lab.results-available` (SMS, or email when SMS is not possible, plus a MyHealth inbox copy, to patients who use
MyHealth: "new results" or "a result was updated", naming no test and no value), `appointment.self-service`
(SMS + in-app: the patient booked, moved or cancelled in MyHealth), `appointment.no-show` (SMS + in-app: "we missed
you", facility and date only), `care-plan.follow-up-due` (SMS + in-app, category `clinical`: a care-plan follow-up is
due or overdue, naming no condition, test or plan), `clinic.message` (in-app only: subject and text written by staff).

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
(`POST /portal/messages/:id/read`, own messages only). Messages are one-way: patients cannot reply yet (a monitored,
triaged two-way channel is a clinical-safety decision still to be made). Free text written by staff exists only as
`clinic.message`, which cannot leave the platform.

## Ports

| Port                 | Implementations                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `RecipientDirectory` | `AppRecipientDirectory` in `apps/api` (patients via patient policy, in-app only with an active MyHealth account; staff email/in-app)  |
| `NotificationQueue`  | BullMQ (`REDIS_URL`); recording queue in tests                                                                                        |
| `ChannelSender`      | SMTP email (`SMTP_URL`); logging sender in dev/test; `UnconfiguredSender` in production for SMS and push until providers are selected |

## Worker

Claims notifications atomically, retries with exponential backoff (BullMQ, 5
attempts), and every minute re-enqueues stranded notifications (queued > 2
min, or stuck in `sending` > 15 min). At-least-once delivery.

## Permissions

`notification.send`, `notification.read`; the in-app inbox needs only authentication.

## Dependencies

SMS and push providers: see `docs/interoperability/dependencies.md`.
