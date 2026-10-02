# Observability

What the platform reports about itself, what each signal means and what is deliberately not built yet. Logs and health
need no external service. Traces and metrics (phase 2) are instrumented with OpenTelemetry and exported only when an
OTLP endpoint is configured — no backend is chosen by the repository. The choices still open — which backend, error
tracking, alerting rules — are listed at the end.

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
| `traceId`    | With telemetry on: the trace this request belongs to, with `spanId`, so a log line and its trace meet (absent otherwise)                            |

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

| `telemetry.started` | log | API and workers at start-up | Traces and metrics are exported (`endpointHost`, `instrumentations`); `telemetry.off` when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset. |

Other warnings keep their text form; the `event` names above are the ones worth alerting on. `http.unhandled_error`
also carries `traceId` and `spanId` when telemetry is on.

## Health

**API** — public, unthrottled, not in the access log (`apps/api/src/app/health.controller.ts`):

- `GET /api/v1/health/live` → `200 { status: "ok" }`: the process is up.
- `GET /api/v1/health/ready` → `{ status, checks: { database, redis, objectStorage, malwareScanner } }`, each check `ok`,
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

## Traces and metrics (OpenTelemetry)

Set `OTEL_EXPORTER_OTLP_ENDPOINT` and each process exports traces and metrics over **OTLP/HTTP** to it (headers in
`OTEL_EXPORTER_OTLP_HEADERS`, service name from `OTEL_SERVICE_NAME` or the process's own: `healthcare-api`,
`healthcare-notification-worker`, `healthcare-integration-worker`). Unset, nothing is instrumented or exported and
the process logs `telemetry.off`. **The repository chooses no backend:** anything that receives OTLP works (an
OpenTelemetry Collector, Grafana Tempo/Mimir, Honeycomb, Datadog, …); choosing one is a hosting and data-processing
decision (compliance register, "Hosting and data protection"). The instrument gateway keeps its JSON logs only.

The bootstrap is `startTelemetry` in `@healthcare/core/telemetry`, a subpath that imports nothing else of the
library. Each `main.ts` imports its `./telemetry` module **first**: imports are evaluated in order, so the SDK starts
before `http`, `express`, `@nestjs/core`, `pg` and `ioredis` are loaded and patched. The webpack build leaves every
`node_modules` package external (the API bundle requires `pg`, `ioredis`, `express` and `@nestjs/core` at run time),
which is what lets the instrumentations hook them — a change that bundled those packages would silently turn the
instrumentation off; the start-up line lists what was registered.

**Instrumentations:** HTTP server and client (health probes excluded), Express (route handlers only, which sets
`http.route` on the request span; the middleware chain is not traced), NestJS, `pg` (connection pool, queries), ioredis
(command name only).

**Spans never carry a patient's or a person's data**, enforced by `ScrubbingSpanProcessor` before export, not by
convention: the URL and query string (`http.url`, `http.target`, `url.full`, `url.path`, `url.query`), request and
response headers, the client's address and port (`client.*`, `net.peer.*`, `network.peer.*`), the user agent and
Redis command arguments (`db.query.parameter.*`) are removed; the route template, method, status, database name and
server host stay. `pg` reports no statement text or parameter values (`enhancedDatabaseReporting` off). The
scrubbing rules and the bootstrap have unit tests (`libs/core/src/lib/telemetry/*.spec.ts`); the artifact check below
confirms it on the built API.

**Metrics** (OTLP, the SDK's default 60-second interval; `OTEL_METRIC_EXPORT_INTERVAL` to change it):

| Metric                                                   | From                 | Attributes                   | Meaning                                                                              |
| -------------------------------------------------------- | -------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `http.server.request.duration`                           | HTTP instrumentation | `http.route`, method, status | Request rate, latency and error rate per route                                       |
| `http.client.request.duration`                           | HTTP instrumentation | server address, status       | Calls to outside services (Pwned Passwords, object storage, payment provider)        |
| `db.client.operation.duration`, `db.client.connection.*` | `pg` instrumentation | database name                | Query timings, pool size and waiting requests                                        |
| `outbox.pending`, `outbox.oldest_age`                    | `OutboxRelay`        | —                            | Events the relay found waiting in its last batch and the age of the oldest (seconds) |
| `event.handler_failures`                                 | `OutboxRelay`        | `event.type`, `event.parked` | Handler attempts that failed; parked = given up after `OUTBOX_MAX_ATTEMPTS`          |
| `queue.depth`                                            | each BullMQ queue    | `queue.name`, `queue.state`  | Jobs waiting, delayed and failed (read from Redis at each collection)                |
| `queue.job_failures`, `queue.reconcile_failures`         | each BullMQ worker   | `queue.name`                 | Job attempts that failed; reconciler runs that failed                                |

The platform's own instruments (`libs/core/src/lib/telemetry/metrics.ts`) use the OpenTelemetry API only: without the
SDK every call is a no-op. Their attribute values are queue names and event type names, never an id or a value from a
record. What to alert on, with thresholds to start from: `docs/runbooks/alerts.md`.

## Domain-level visibility (already built)

The audit trail (`/admin/audit`), the communication log (`/communications`), integration review (`/admin/integrations`),
rate-limit refusals (`/admin/security`, platform administrators) and the laboratory quality summary are where staff see
what the platform did; they are records, not telemetry, and are documented with their domains.

## Not built — decisions pending

| Capability               | State              | What it would add                                                                                                                                                                                                                                                                   |
| ------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telemetry backend        | Not chosen         | Traces and metrics are exported over OTLP once `OTEL_EXPORTER_OTLP_ENDPOINT` is set (above); which service receives them, where it runs and under what agreement is the organization's decision. A `/metrics` endpoint nobody scrapes is still not worth having.                    |
| Error tracking           | None               | Exceptions reach the trace backend as span status and events (scrubbed). A dedicated error-tracking service would receive stack traces and request context that can carry patient data: scrubbing rules and a data-processing agreement are a compliance decision first (ADR-0012). |
| Alerting                 | Runbook only       | `docs/runbooks/alerts.md` lists the conditions, metrics and log events to alert on; the rules themselves live in whichever backend is chosen.                                                                                                                                       |
| Log retention and access | Hosting provider's | Not configured in this repository. Logs are not exported through OpenTelemetry (no OTLP logs exporter): the hosting provider's log stream remains the record.                                                                                                                       |

## Verified (2026-10-02)

Phase 2, on the **built** API (`apps/api/dist/main.js`, run with `OTEL_EXPORTER_OTLP_ENDPOINT` pointing at a local
HTTP receiver, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`): `telemetry.started` listed the five instrumentations; a
failed sign-in and a patient request by id produced HTTP spans named by their route templates
(`POST /api/v1/auth/login`, `GET /api/v1/patients/:patientId`) with Express, NestJS, `pg` and ioredis child spans;
the exported bytes contained neither the patient id, the query string, the email, the password nor the user agent;
health probes produced no span; metrics arrived for request duration, database operations and connections,
`outbox.pending`, `outbox.oldest_age` and `queue.depth`. Unit tests cover the scrubbing rules (including that the
exporter never sees a dropped attribute), the off-without-endpoint case, the start-up line and the instruments.
Not verified: a real backend, the workers' export (same bootstrap, not exercised), Railway.

Phase 1 — unit tests: the access-log entry (fields, no ids or bodies, health probes skipped), the health report combination and
status codes, the worker health server (`/live`, `/ready`, nothing else), the rate-limit warning event. Integration:
`/live`; `/ready` `ok` with the database and Redis up and storage unconfigured; `200 degraded` with Redis at a closed
port; `X-Request-Id` on the response. Not verified: JSON output in a running production process, worker health on
Railway.
