# Observability

What the platform reports about itself, what each signal means and what is deliberately not built yet. Phase 1 (below)
needs no external service; the choices still open — a telemetry backend, error tracking, alerting — are listed at the
end with what each would add.

## Logs

The API and both workers log through Nest's `ConsoleLogger`: **one JSON object per line in production** (`NODE_ENV`),
plain text elsewhere (`apps/*/src/main.ts`; levels from `LOG_LEVEL`, `levelsFrom` in `libs/core`). Each line has
`level`, `pid`, `timestamp`, `context` and `message`; a stack trace is `stack`. The instrument gateway writes its own JSON
lines (`apps/instrument-gateway/src/main.ts`, `event` + detail).

**No clinical data, names, addresses, emails, tokens or request bodies are logged by design.** Logs may carry ids
(request, user, event, job), route templates, statuses and error messages. Where logs are stored, who can read them and
for how long is the hosting provider's and the organization's (compliance register, "Hosting and data protection").

### Access log

One line per finished request (`accessLogMiddleware`, `libs/core/src/lib/http/access-log.ts`), `context: "Http"`,
`message`:

| Field        | Value                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event`      | `http.request`                                                                                                                                      |
| `method`     | HTTP method                                                                                                                                         |
| `route`      | The registered route **template** (`/api/v1/patients/:id`), or `(no route)` when nothing matched                                                    |
| `status`     | Response status                                                                                                                                     |
| `durationMs` | Whole milliseconds                                                                                                                                  |
| `requestId`  | The `X-Request-Id` the API accepted or generated (also in every error body)                                                                         |
| `actor`      | `{ kind: "user" \| "system", userId }` for staff and integration accounts; `{ kind: "patient" }` for MyHealth (no id); absent before authentication |

Never the URL with its ids, the query string, headers or a body. Health probes are not logged.

### Operational events

Failures in background work and infrastructure are logged as objects with a stable `event` name, so a backend can
alert on them once one exists:

| `event`                        | Level | Where                         | Meaning and what to do                                                                                                                |
| ------------------------------ | ----- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `http.unhandled_error`         | error | API exception filter          | A 5xx: a bug or a dependency failure; `requestId`, `route`, stack. Investigate every one.                                             |
| `outbox.relay_failed`          | error | API (`OutboxRelay`)           | The outbox tick could not read or dispatch events (usually the database); events wait and are retried next tick.                      |
| `event.handler_failed`         | warn  | API (`DomainEventHandlers`)   | One handler failed for one event (`eventType`, `eventId`, `attempt`); retried with backoff. Repeats for the same event = investigate. |
| `queue.job_failed`             | warn  | API and workers (BullMQ)      | A job attempt failed (`queue`, `jobId`, `attempt`); BullMQ retries. Repeats on one queue = the downstream dependency.                 |
| `queue.reconcile_failed`       | error | API and workers               | The reconciler that re-enqueues stranded rows failed (`queue`); stranded work waits until the next run.                               |
| `rate_limit.redis_unreachable` | warn  | API (`RedisThrottlerStorage`) | Rate limits are off while Redis is down (at most once a minute); account lockout still applies.                                       |
| `realtime.redis_unreachable`   | warn  | API (`ConfiguredIoAdapter`)   | Live updates reach only this instance while Redis is down (at most once a minute); the staff app's 15-second poll covers the rest.    |

Other warnings keep their text form; the `event` names above are the ones worth alerting on.

## Health

**API** — public, unthrottled, not in the access log (`apps/api/src/app/health.controller.ts`):

- `GET /api/v1/health/live` → `200 { status: "ok" }`: the process is up.
- `GET /api/v1/health/ready` → `{ status, checks: { database, redis, objectStorage } }`, each check `ok`,
  `unreachable` or `unconfigured`. The **database is required**: unreachable → `503 unavailable`. **Redis and object
  storage degrade**: unreachable → `200 degraded` — the API still serves (rate limits are let through, uploads and
  report archives fail) and stays on routing, so one of them being down does not take the whole API offline. Object
  storage is `unconfigured` without `S3_ACCESS_KEY_ID` and probed at most once a minute (a head of a key that never
  exists, through `DocumentsService.probeStorage`). Railway probes `/ready` (`apps/api/railway.json`).

**Workers** — no HTTP server by default. With `HEALTH_PORT` set, each worker serves `GET /live` and `GET /ready`
(database required, Redis reported) on that port and nothing else (`apps/*-worker/src/health.ts`,
`startHealthServer` in `libs/core`), so the platform can restart a stalled consumer, not only a crashed one. On
Railway this needs the worker to listen on the port Railway assigns and a `healthcheckPath` in its `railway.json` —
not yet set up or verified there.

Combination rules and status codes: `healthReport` / `healthStatusCode` in `libs/core/src/lib/health/health-server.ts`.

## Domain-level visibility (already built)

The audit trail (`/admin/audit`), the communication log (`/communications`), integration review (`/admin/integrations`),
rate-limit refusals (`/admin/security`, platform administrators) and the laboratory quality summary are where staff see
what the platform did; they are records, not telemetry, and are documented with their domains.

## Not built — decisions pending

| Capability               | State                  | What it would add                                                                                                                                                                                                                                                 |
| ------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metrics and traces       | None; no SDK installed | Request rates and latencies per route, queue depths, database timings. Recommended: the OpenTelemetry SDK with an OTLP exporter to a backend the organization chooses (vendor-neutral; `CLAUDE.md` §1); a `/metrics` endpoint nobody scrapes is not worth having. |
| Error tracking           | None                   | Grouped 5xx with context. A third-party service would receive stack traces and request context that can carry patient data: scrubbing rules and a data-processing agreement are a compliance decision first.                                                      |
| Alerting                 | None                   | Only possible once a backend or error tracking exists; the `event` names above and the `/ready` states are the conditions to alert on.                                                                                                                            |
| Log retention and access | Hosting provider's     | Not configured in this repository.                                                                                                                                                                                                                                |

## Verified (2026-10-02)

Unit tests: the access-log entry (fields, no ids or bodies, health probes skipped), the health report combination and
status codes, the worker health server (`/live`, `/ready`, nothing else), the rate-limit warning event. Integration:
`/live`; `/ready` `ok` with the database and Redis up and storage unconfigured; `200 degraded` with Redis at a closed
port; `X-Request-Id` on the response. Not verified: JSON output in a running production process, worker health on
Railway.
