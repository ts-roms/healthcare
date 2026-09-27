# Architecture decisions

Short records of decisions taken while building Phase 1. Add new entries at
the end; do not rewrite accepted ones — supersede them.

## ADR-0001 SQL-first migrations, Drizzle as query layer

**Decision.** The schema is defined by hand-written, forward-only SQL files in
`database/migrations/`, applied by `runMigrations` (checksummed, advisory-locked,
one transaction per file). Libraries use Drizzle for typed queries.

**Why.** Healthcare invariants belong in the database (CLAUDE.md §24):
composite same-organization foreign keys, check constraints, partial unique
indexes, append-only triggers. These are clearest as plain SQL and reviewable in
PRs. A generated-migration tool would need per-lib schema imports across
domain boundaries.

**Consequence.** Table definitions exist twice (SQL + Drizzle). A schema drift
integration test compares them.

## ADR-0002 Access metadata in core, enforcement in auth

**Decision.** `@Public`, `@RequirePermissions`, `@RequireFacility`,
`@RequirePlatformAdmin`, `@CurrentActor` and the permission catalog live in
`libs/core`. `libs/auth` registers one global `AccessGuard` that authenticates,
resolves organization/facility/department context, computes effective
permissions and enforces the metadata.

**Why.** Every domain library can declare access rules without importing auth,
keeping the dependency graph acyclic. Secure-by-default: a new route without
metadata still requires authentication.

## ADR-0003 Zod for validation and OpenAPI

**Decision.** Request validation uses Zod via `nestjs-zod` (`createZodDto`,
global `ZodValidationPipe`). class-validator is not used.

**Why.** CLAUDE.md §1 asks for one approach. Zod schemas can later be shared
with the Next.js and Expo clients.

## ADR-0004 Sessions: short-lived JWT + rotating refresh token, checked per request

**Decision.** Access tokens are 15-minute HS256 JWTs bound to a server-side
session. The guard checks the session, user status and membership on every
request, so logout, password change and suspension take effect immediately.
Refresh tokens are random, stored as SHA-256 hashes, rotated on every use;
replaying a rotated token revokes the session.

**Trade-off.** A few indexed queries per request. Add a short-lived cache
before this becomes a bottleneck.

## ADR-0005 Notifications: stored first, delivered by a worker, ports for recipients and channels

**Decision.** `NotificationService.send` validates the template, resolves the
recipient through the `RecipientDirectory` port (consent/preferences), stores
the notification (including suppressed ones) and enqueues it on BullMQ. The
worker claims it atomically, records each attempt and calls a `ChannelSender`.
A reconciler re-enqueues stranded notifications. Delivery is at-least-once.

**Why.** Complete communication history (CLAUDE.md §16, §27); replaceable
providers (§19); SMS/push providers are not selected yet, so production uses a
sender that fails loudly rather than pretending to deliver.

## ADR-0006 Patient identity is per organization

**Decision.** A patient belongs to one organization and is shared by all of its
facilities (one canonical identity, CLAUDE.md §5). Cross-organization identity
(e.g. a network sharing records) is out of scope until there is a consent and
data-sharing model for it.
