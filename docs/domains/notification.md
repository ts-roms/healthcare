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
External channels must not carry clinical detail. Phase 1 templates:
`patient.registered` (SMS/email), `security.mfa-enabled` (email/in-app),
`staff.message` (in-app only).

## Ports
| Port | Implementations |
| --- | --- |
| `RecipientDirectory` | `AppRecipientDirectory` in `apps/api` (patients via patient policy; staff email/in-app) |
| `NotificationQueue` | BullMQ (`REDIS_URL`); recording queue in tests |
| `ChannelSender` | SMTP email (`SMTP_URL`); logging sender in dev/test; `UnconfiguredSender` in production for SMS and push until providers are selected |

## Worker
Claims notifications atomically, retries with exponential backoff (BullMQ, 5
attempts), and every minute re-enqueues stranded notifications (queued > 2
min, or stuck in `sending` > 15 min). At-least-once delivery.

## Permissions
`notification.send`, `notification.read`; the in-app inbox needs only authentication.

## Dependencies
SMS and push providers: see `docs/interoperability/dependencies.md`.
