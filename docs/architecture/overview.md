# Architecture overview

Status: Phase 1 (Foundation) implemented. See `CLAUDE.md` for the rules this follows.

## Shape

A **modular monolith** (CLAUDE.md §2): one NestJS API deployable plus a
separately scalable notification worker, built from domain libraries in an Nx
workspace.

```
apps/
  api/                   NestJS HTTP API — composition root for all modules
  notification-worker/   BullMQ consumer that delivers notifications
libs/
  core/          layer:core      config, database, errors, access decorators, PH helpers
  audit/         layer:platform  append-only audit trail
  organization/  layer:platform  organizations, facilities, departments
  auth/          layer:platform  users, roles, sessions, MFA, global AccessGuard
  documents/     layer:platform  document metadata + S3 presigned upload/download
  notification/  layer:platform  NotificationService, templates, channel adapters, dispatcher
  patient/       layer:domain    Patient Master, lookup, duplicates, consent, preferences
database/migrations/   forward-only SQL migrations (source of truth for the schema)
tools/db/              migrate and seed scripts
```

## Dependency rules

Enforced by `@nx/enforce-module-boundaries` in `eslint.config.mjs`:

| From | May depend on |
| --- | --- |
| `layer:core` | `layer:core` only |
| `layer:platform` | core, platform — with explicit edges: anything → audit, auth → organization |
| `layer:domain` | core, platform, `type:contract` libraries. **Never another domain.** |
| `type:app` | any library |

When a platform service needs something a domain owns, it defines a **port**
and the app wires an adapter. Example: `notification` defines
`RecipientDirectory`; `apps/api/src/app/recipient-directory.ts` implements it
with `PatientRecordService` and `AuthService`.

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

Phase 1 has no domain event bus yet. Cross-cutting effects (audit) are written
synchronously in the transaction. When the first asynchronous consumers appear
(timeline, patient notifications on registration, lab results), add a
transactional outbox rather than publishing from inside transactions.

## Decisions

See [decisions.md](./decisions.md).
