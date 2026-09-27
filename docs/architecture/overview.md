# Architecture overview

Status: Phase 1 (Foundation), Phase 2 (Clinic) and the Phase 3 laboratory backend implemented in the API; the staff app and patient portal sign in against the API; most clinical screens are still demo previews. See `CLAUDE.md` for the rules this follows.

## Shape

A **modular monolith** (CLAUDE.md §2): one NestJS API deployable plus a
separately scalable notification worker, built from domain libraries in an Nx
workspace.

```
apps/
  api/                   NestJS HTTP API — composition root for all modules
  notification-worker/   BullMQ consumer that delivers notifications
  staff/                 Next.js staff app — backend-for-frontend to the API (see staff-app.md); clinical modules still demo
  portal/                Next.js patient portal — backend-for-frontend (see portal-app.md): sign-in, activation, profile
libs/
  core/          config, database, errors, access decorators, events outbox, PH helpers, zoned time
  audit/         append-only audit trail
  organization/  organizations, facilities, departments
  auth/          users, roles, sessions, MFA, global AccessGuard, ActorResolver
  documents/     document metadata + S3 presigned upload/download
  notification/  NotificationService, templates, channel adapters, dispatcher
  patient/       Patient Master, lookup, duplicates, consent, preferences, patient portal accounts
  clinic/        scheduling, appointments, queue, triage, vitals, allergies, encounters, diagnoses, dashboard
  prescription/  immutable prescriptions, cancel/replace, drug–allergy decision support
  care-plan/     care plans, goals, activities, recall
  laboratory/    LIS: catalog, reference ranges, orders, specimens, versioned results, critical values, worklists, trends
  ui/ domain/    frontend design system and shared frontend types
  web-session/   session code shared by the Next.js apps (cookies, refresh, errors, forwarding)
database/migrations/   forward-only SQL migrations (source of truth for the schema)
tools/db/              migrate and seed scripts
```

## Dependency rules

Enforced by `@nx/enforce-module-boundaries`; tags and the full rule table are in
[module-boundaries.md](./module-boundaries.md). In short:

- Backend platform services (`core`, `audit`, `organization`, `documents`, `notification`: `type:data-access`;
  `auth`: `type:feature`) are `scope:shared`; layer tags stop lower layers importing higher ones (audit and
  organization cannot import auth).
- Clinical domains (`scope:patient`, `scope:clinic`, `scope:prescription`, `scope:care-plan`, …) may use
  `scope:shared` libraries and other domains' `type:contract` libraries only — **never another domain**.
- The API (`scope:api`) is the composition root and may use every domain.

When a library needs something another domain owns, it defines a **port** and the app wires an adapter
(`apps/api/src/app/adapters`, `recipient-directory.ts`). Examples: notification → `RecipientDirectory`;
clinic → `PatientDirectory`; prescription → `PrescribingContext`; laboratory → `LaboratoryContext`. Cross-domain read models such as
Patient 360 (`GET /patients/:id/summary`) are composed in the API.

## Request pipeline

```
request-id middleware → ThrottlerGuard → AccessGuard (auth, context, permissions)
  → ZodValidationPipe → controller → application service
  → db.transaction( change + audit record ) → view model → response
HttpExceptionFilter maps every error to { error: { code, message, details?, requestId } }
IdempotencyInterceptor replays unsafe requests that carry an Idempotency-Key
```

- Every route requires authentication unless marked `@Public()`.
- The caller is passed explicitly as `Actor` (`@CurrentActor()`); no ambient request state.
- Controllers never return database rows directly for patient data; services map to view models.
- Mutations write their audit event in the **same transaction**.

## Data access

SQL migrations define the schema, including constraints and triggers. Each
library declares Drizzle table definitions for **its own tables only** and
queries them with Drizzle. The integration test `schema.int.spec.ts` fails if
a Drizzle definition drifts from the migrated schema.

## Events

Domain events are written to the `domain_event` outbox in the same transaction
as the change (`DomainEventPublisher.record(tx, …)`). The `OutboxRelay` (started
by the API) dispatches them to in-process handlers registered with
`DomainEventHandlers.on(…)`, oldest first, at-least-once, with retries and
parking of failing events. Current consumers: appointment reminders
(clinic → notification) and realtime queue updates (Socket.IO gateway).
Audit is not event-driven: it is written synchronously in the transaction.

## Decisions

See [decisions.md](./decisions.md).
