# NestJS backend security audit (Stage A, read-only)

Scope: `apps/api` composition root and the shared HTTP plumbing in `libs/core`, `libs/auth`, `libs/patient` (portal guard), `libs/documents`, `libs/billing` (webhook), `libs/notification` (push). Method: reading code; no code, migration or config was changed, no tests were run. Status vocabulary: Verified secure / Tested no issue (an existing integration test proves it; not re-run here) / Not tested / Incomplete implementation / Confirmed vulnerability. Anything not read is "Not verified". The route-by-route table is in `API_INVENTORY.md`; the test coverage view is in `API_SECURITY_TEST_REPORT.md`.

## 1. Request pipeline (order of enforcement)

| Stage | Mechanism | Evidence | Status |
|---|---|---|---|
| Middleware | RLS context, request id, access log (`forRoutes("*path")`) | `apps/api/src/app/app.module.ts:~335-340` | Verified secure. Access log carries route template, status, actor id only; never body or ids in URL (`libs/core/src/lib/http/access-log.ts:21-37`). |
| Request id | Client `X-Request-Id` accepted only if `^[A-Za-z0-9._-]{8,128}$` | `libs/core/src/lib/http/request-id.ts:5-13` | Verified secure (no header/log injection). |
| Security headers | `helmet()` with defaults, `x-powered-by` disabled | `apps/api/src/app/configure-app.ts:18,20` | Verified present; defaults only. Not tested (no test inspects headers). |
| CORS | `origin: CORS_ORIGINS` (explicit allow-list from env, empty list = none), `credentials: true`; same list for Socket.IO | `configure-app.ts:19`, `apps/api/src/app/realtime/io-adapter.ts:51` | Verified secure (no wildcard path in code). Value in each deployment: Not verified. |
| Body parsing | JSON only, limit `1mb`, types `application/json` + `application/fhir+json`; Nest default urlencoded parser remains (100 kb default, unused) | `configure-app.ts:23` | Verified. Oversize handling (413 mapping) Not tested. |
| Rate limiting | `RateLimitGuard` (APP_GUARD) over `RedisThrottlerStorage`; default 300/min/client, credential routes 10/min | `app.module.ts:185-189,313`; `rate-limit.guard.ts:14-34` | See API-001, API-014. |
| Authentication/authorization | Global `AccessGuard` (via `AuthModule`) for staff; `@Public()` + `PatientAccessGuard` for MyHealth | `libs/auth/src/lib/access.guard.ts:49-96`, `libs/patient/src/lib/portal/patient-access.guard.ts:44-88` | Verified secure with caveats below. |
| Validation | Global `ZodValidationPipe` (APP_PIPE) validates `createZodDto` classes | `app.module.ts:314` | Verified; see API-004 and API-011 for exceptions. |
| Interceptor | Global `IdempotencyInterceptor` | `app.module.ts:316`, `libs/core/src/lib/idempotency/idempotency.interceptor.ts:27-105` | See API-003, API-009. |
| Exception filter | Global `HttpExceptionFilter` | `libs/core/src/lib/http/exception.filter.ts:26-80` | See API-005. |

## 2. Authentication and guards

**AccessGuard (staff).** Verified secure, with these points confirmed by reading:
- Default-deny: any route not marked `@Public()` needs `Authorization: Bearer <token>` (`access.guard.ts:49-62`); non-HTTP contexts return `true` (line 47) so it never protects WebSocket events (see section 9).
- JWT: HS256 pinned on sign and verify (`algorithms: ["HS256"]`), issuer and audience checked, `typ` claim must equal the expected type (`libs/auth/src/lib/tokens.ts:79-96`) so a realtime ticket or MFA challenge cannot be used as an access token (also tested: `realtime.int.spec.ts:298`, `auth.int.spec.ts:119`). Secret is at least 32 chars (`libs/core/src/lib/config/app-config.ts:53`). No `none`/RS-HS confusion path. A test for tampered/`alg:none`/expired tokens does not exist (Not tested).
- Session, user status and membership are re-read on every request, so logout/suspension is immediate (`actor-resolver.ts:44-52`; `auth.int.spec.ts:60-67` Tested no issue).
- Permissions are resolved per organization and per `X-Facility-Id`; a facility the caller cannot reach yields no facility-scoped grants (`access.int.spec.ts:30-33,67` Tested no issue). The facility header only needs to be an active facility of the caller's organization (`actor-resolver.ts:71-77`); the permission set is what limits access.
- Method-level `@RequirePermissions` replaces rather than merges with class-level (`getAllAndOverride`, `access.guard.ts:73`). The scan found no controller using both, so no accidental downgrade today (Verified by inventory scan). This is a latent trap for future edits.
- Denials are audited (`access.guard.ts:85-93`), the MFA-enrollment and password-change gates run before permission checks (lines 63-71).
- Authenticated-only routes (no permission) are enumerated and judged in `API_INVENTORY.md` section B: all are self-service (`/me/*`, `/auth/*`, `/organization/tour-setting`).

**PatientAccessGuard (MyHealth).** Verified secure:
- 104 portal routes carry class-level `@Public()` + `@UseGuards(PatientAccessGuard)`; none of the 121 `@Public()` routes outside the 17 listed in the inventory lacks the guard (inventory scan; textual, class-level decorators).
- It re-authenticates session, account and consent per request, enforces the patient MFA-enrollment policy, and only honors `X-Acting-For` on `@ProxyAllowed()` routes and via a live grant (`patient-access.guard.ts:56-87`; tested in `portal-proxy.int.spec.ts:167-176` Tested no issue).
- Audiences differ between staff and patient tokens (stated in `patient-access.guard.ts` doc comment); cross-use tested (`portal.int.spec.ts:150-152` Tested no issue).

**Public routes.** 17 unauthenticated routes (list and judgment in `API_INVENTORY.md` section A): health, staff and MyHealth sign-in/reset/refresh/activation/MFA, the PayMongo webhook and the outreach opt-out. Each credential route has a 10/min per-client throttle plus account lockout (Tested: `auth.int.spec.ts:40-47`, `portal.int.spec.ts:94-95`). Each public route that touches the database before an organization is known runs under `@PlatformScope(reason)`, which sets the cross-organization RLS scope for the whole request (`access.guard.ts:51-58`). That is by design but means a bug in any of those handlers is not contained by row-level security (API-018 INFO).

## 3. Validation, whitelisting and serialization

- Zod everywhere via `createZodDto`; no class-validator. Unknown keys are silently stripped (Zod default `z.object`), not rejected: there is no mass-assignment path from the DTO to the database in the samples read, but unexpected fields are not reported (API-017 INFO).
- Verified: `POST /documents` restricts `contentType` to an enum, `sizeBytes` <= 50 MB, file name rejects path separators (`libs/documents/src/lib/document.dto.ts:6-26`; `documents.int.spec.ts:62-69` Tested no issue for `.exe`).
- Path/query ids: 432 `ParseUUIDPipe` usages; 22 handlers take `:id` as a bare string (API-004).
- Two handlers take `@Body() body: unknown` and validate inside services (API-011).
- Response serialization is hand-built, not a global serializer. `publicView()` in `libs/clinic/src/lib/clinic-support.ts:4`, `libs/billing/src/lib/billing-support.ts:5`, `libs/laboratory/src/lib/laboratory-support.ts:4` strips only `organizationId`; handlers that return whole Drizzle rows (e.g. billing payment-intent view removes `idempotencyKey` by hand, `online-payment.service.ts:~284`) depend on each author remembering to drop internal columns (API-016). No password hash, MFA secret or token hash was seen in any response in the controllers sampled; exhaustive review Not verified.
- Error envelope: single shape `{error:{code,message,details?,requestId}}` (`exception.filter.ts:14-24`). Unexpected errors become a generic 500 with the stack logged server-side only (lines 36-47, 74-76): Verified secure against stack leakage. Constraint names are returned in `details` on 409/422 (API-005).

## 4. Rate limiting and Redis storage

- Storage: one atomic Lua script (INCR + PEXPIRE + block key) so replicas share counters (`apps/api/src/app/redis-throttler-storage.ts:18-35,89-104`); tested across two app instances (`rate-limit.int.spec.ts:46-54` Tested no issue).
- **Fail-open (Confirmed, by design):** any Redis error or the 250 ms command timeout returns `{ totalHits: 0, isBlocked: false }` (`redis-throttler-storage.ts:72,101-103`), including for the credential routes, and logs at most one warning a minute (lines 147-153). The behavior is asserted as intended by `rate-limit.int.spec.ts:74-84` (12 logins pass with Redis down). Compensating control: account lockout lives in PostgreSQL (`auth.int.spec.ts:40-47`). Residual risk: credential stuffing across many accounts, and unthrottled expensive endpoints during a Redis incident (API-001).
- Client identity is `req.ip`; `TRUST_PROXY` defaults to false (`app-config.ts:66`), Terraform sets true (`infrastructure/terraform/railway/main.tf:45`), `trust proxy` = 1 hop (`configure-app.ts:21`). If a deployment leaves the default behind a proxy, every client shares one bucket (self-lockout of logins at 10/min). With it set, the right-most `X-Forwarded-For` hop is trusted: safe only if the API is reachable only through Railway's edge or the staff/portal servers (documented in `libs/web-session/src/forwarding.ts` header; deployment reachability Not verified) (API-014).
- Limits: global 300/min/client (`app.module.ts:186`), credential routes 10/min, some route-specific (push 5-20/min, messages 20/min, test-send 6/min). The payment webhook and the outreach opt-out use only the global limit (API-015). The health controller is `@SkipThrottle` (`apps/api/src/app/health.controller.ts:26`).
- Refusal counting stores route templates only, no addresses (`rate-limit.guard.ts:28-33`, tested `rate-limit.int.spec.ts:56-65`).

## 5. CORS, headers, Swagger

- `helmet()` defaults (HSTS, nosniff, frame protections) are applied before routes (`configure-app.ts:18`); no custom CSP for the API (acceptable for a JSON API).
- Swagger is mounted at `/api/docs` whenever `NODE_ENV !== "production"` (`configure-app.ts:28-41`); `NODE_ENV` defaults to `development` (`app-config.ts:41`). Terraform sets `NODE_ENV=production` (`main.tf:33,53`), so production is Verified secure as configured; a deployment that omits it exposes the full API map and, in `development`, other development relaxations (API-013).
- Health readiness is public and lists dependency state (`health.controller.ts:48-60`) (API-012 INFO).

## 6. Webhooks and notification endpoints

- **PayMongo webhook** `POST /billing/online-payments/notifications`: Verified secure.
  - Raw bytes are used (`rawBody: true` in `main.ts:34`, `request.rawBody` at `libs/billing/src/lib/billing.controllers.ts:~483`); the same app bootstrap is used in tests (`apps/api/test/harness.ts:143-144`).
  - HMAC-SHA256 of `<t>.<rawBody>` compared with `timingSafeEqual`, hex shape checked, 300 s tolerance, live vs test signature chosen by key prefix (`apps/api/src/app/adapters/paymongo-payment-gateway.ts:102-118`).
  - Verification occurs before any database access; unverifiable returns 400 (`libs/billing/src/lib/payments/online-payment.service.ts:139-141`). Each intent completes once under a row lock (lines 149-153).
  - The gateway is only registered when secret key, webhook secret and methods are all set (`apps/api/src/app/adapters/payment-adapters.ts:12-14`; config superRefine `app-config.ts:174-179`); otherwise the unconfigured gateway returns `null` and the route answers 400.
  - Tested: forged secret, stale timestamp, replay, non-payment event (`billing-paymongo.int.spec.ts:159-175`). Only the global 300/min throttle applies (API-015).
  - Return URLs for checkout are restricted to `CORS_ORIGINS` origins (`online-payment.service.ts:253-262`): no open redirect.
- **Outreach opt-out** `POST /outreach/opt-out`: single-use token, public, `@PlatformScope`. Verified by design; abuse limits are the global throttle only.
- **Other inbound integrations:** FHIR import is staff-authenticated (`interop.fhir.import`) and stored sealed for review; instrument gateway posts with an integration account permission. No other unauthenticated inbound webhook exists in the controller scan (inventory section A).

## 7. Outbound requests (SSRF surface)

Outbound HTTP found in `apps/api`/`libs` (excluding frontends): PayMongo (`PAYMONGO_API_BASE`, config), LiveKit probe (`libs/telemedicine/src/lib/video.ts:82-84`, config URL), Pwned Passwords, ClamAV (TCP, config), S3 (config), Expo push, Web Push.
- All are operator-configured except **Web Push**, where the destination URL is supplied by any signed-in patient or staff member: schema accepts any `https://` URL up to 2048 chars (`apps/api/src/app/portal/portal-push.controller.ts:16`, `apps/api/src/app/staff-push.controller.ts:15`) and the sender POSTs to it (`libs/notification/src/lib/push/web-push.sender.ts:88`). No host allow-list, no private-address check. This is a blind SSRF with a fixed, encrypted, content-free body (API-002). Whether the `web-push` library follows redirects and how it resolves hosts: Not verified.
- `new URL()` uses at `online-payment.service.ts:260`, `portal-security.rules.ts:117`, `fhir-record.ts:62` parse operator/CORS values, not user input.

## 8. File upload

- Flow: JSON registration -> presigned PUT locking content-type, length and SSE (`libs/documents/src/lib/object-storage.ts:55-72`) -> completion reads back, compares size, hashes, optionally checks declared SHA-256 and scans (`documents.service.ts:249-277`). Tested: `document-scanning.int.spec.ts:59-165`.
- Verified secure: type allow-list (PDF/JPEG/PNG/HEIC/TIFF/DICOM), 50 MB cap, quarantine of infected files, scanner-unreachable refuses completion, download only via short-lived signed URL after authorization and audit.
- Gaps: content type is the client's declaration, with no magic-byte check against the stored bytes (API-007); the full object (up to 50 MB) is loaded into memory at completion (`documents.service.ts:258`) (API-008); with `CLAMAV_HOST` unset the API runs and marks files `not_scanned` yet `available` (`documents.service.ts:267`; production only logs a warning, `main.ts:64-69`) (API-007).

## 9. Alternate access paths that bypass controller guards

- **Socket.IO `/realtime` gateway** (`apps/api/src/app/realtime/realtime.gateway.ts`). Controller guards (AccessGuard, RateLimitGuard) do not run for `handleConnection`; the gateway authenticates itself, which is Verified: ticket (60 s JWT bound to session and facility, `tokens.ts:11,57-59`) or, for server clients, access token + facility (`realtime.gateway.ts:73-86`); permissions decide the rooms joined, a socket with none is disconnected (lines 88-100); patients use their own ticket and room (lines 118-133). There are no `@SubscribeMessage` handlers, so clients cannot send commands; emitted payloads are ids/statuses only (header comment; tests `realtime.int.spec.ts:69-205`, rejection `207-218`, ticket misuse `298-320` Tested no issue). Gaps: the token path resolves the actor without checking `passwordChangeRequired` or `mfaEnrollmentRequired`, so a member who must still change password or enrol in MFA can listen to ids-only events (API-006); no connection or handshake rate limit (API-006); the ticket is a bearer JWT usable more than once within 60 s (INFO).
- **Background jobs / BullMQ workers / schedulers** act as `systemActor` or under `asPlatform(reason)`; they are not reachable over HTTP. Not verified in depth.
- **Static/other servers:** workers expose only `/live` and `/ready` when `HEALTH_PORT` is set (CLAUDE.md); Not verified in code in this audit.
- **Staff/portal Next.js servers** call the API with forwarded client address; the reachability of the API directly is a deployment question (API-014).
- **Signed storage URLs** are the second path to documents (not through the API once issued); TTL constants live in `documents.service.ts` (`DOWNLOAD_URL_TTL_SECONDS`, `UPLOAD_URL_TTL_SECONDS`); value Not verified here.

## 10. Transactions and data integrity at the HTTP edge

- Convention (audit + outbox in the caller's transaction) is applied in the code read: payment webhook (`online-payment.service.ts:149-210`), upload completion (`documents.service.ts:279-318`), idempotency begin/complete (`idempotency.interceptor.ts:59-95`).
- Idempotency: first-writer-wins insert, request hash over method, path and canonical body, per-user key scope, 24 h expiry, 409 while in progress, failure releases the key (`idempotency.interceptor.ts:36-105`). Tested for key reuse (`patients.int.spec.ts:71`, `billing.int.spec.ts:296`, `billing-deposits.int.spec.ts:79`) and offline replay (`offline-replay.int.spec.ts:36`). Weaknesses: API-003 (stored responses never purged), API-009 (scope and edge cases).
- Whole-codebase review of every transaction boundary: Not verified (out of scope of an API-surface pass).

## 11. Positive controls confirmed

| Control | Evidence |
|---|---|
| Default-deny global guard, audited denials | `access.guard.ts:49-93` |
| Per-request session/membership revalidation | `actor-resolver.ts:44-52` |
| Pinned JWT algorithm, typed tokens | `tokens.ts:79-96` |
| Rate limits shared via Redis, atomic script | `redis-throttler-storage.ts:18-35` |
| Webhook HMAC + timestamp + once-only completion | `paymongo-payment-gateway.ts:102-118`, `online-payment.service.ts:139-153` |
| No stack traces or SQL text in error bodies | `exception.filter.ts:36-47,74-76` |
| Body limit, JSON-only parsing | `configure-app.ts:23` |
| Presigned URL with fixed length/type, scan + checksum + quarantine | `object-storage.ts:55-72`, `documents.service.ts:249-318` |
| RLS context for every request | `app.module.ts:~339`, `access.guard.ts:62-63` |

## Findings

| ID | Severity | Title | Status |
|---|---|---|---|
| API-001 | MEDIUM | Rate limiter fails open when Redis is unreachable (credential routes too) | Open |
| API-002 | MEDIUM | Blind SSRF through user-supplied Web Push endpoint | Open |
| API-003 | MEDIUM | Idempotency responses stored in plaintext and never purged | Open |
| API-004 | LOW | Malformed UUID path ids on 22 handlers return 500 | Open |
| API-005 | LOW | Constraint names returned in 409/422 `details` | Open |
| API-006 | LOW | Realtime token path skips MFA-enrollment/password-change gates; no connection throttle | Open |
| API-007 | MEDIUM | Upload content type not verified against bytes; scanner optional in production | Open |
| API-008 | LOW | Upload completion buffers up to 50 MB in memory | Open |
| API-009 | LOW | Idempotency scope/edge cases (facility, portal, post-commit failure) | Open |
| API-010 | INFO | FHIR import `Location` built from request Host | Open |
| API-011 | LOW | `@Body() unknown` handlers validated only in services | Open |
| API-012 | INFO | Public readiness endpoint discloses dependency state | Open |
| API-013 | LOW | Swagger and dev behavior depend on `NODE_ENV` defaulting to development | Open |
| API-014 | LOW | Client-IP trust depends on `TRUST_PROXY` and API reachability | Open |
| API-015 | LOW | Webhook and opt-out routes have only the global 300/min throttle | Open |
| API-016 | LOW | Blacklist-style serialization (`publicView` strips only organizationId) | Open |
| API-017 | INFO | Zod strips unknown fields silently | Open |
| API-018 | INFO | Public `@PlatformScope` routes run outside organization RLS | Open |

### API-001 Rate limiter fails open (MEDIUM)
- File: `apps/api/src/app/redis-throttler-storage.ts:72,101-103,147-153`; asserted intended at `apps/api/test/rate-limit.int.spec.ts:74-84`.
- Evidence: on any Redis error or the 250 ms command timeout, `increment` returns `totalHits: 0, isBlocked: false`; no in-process fallback.
- Exploitability: requires Redis degradation (outage, saturation making commands exceed 250 ms, network partition). An attacker can add load but cannot directly cause it; when it occurs all limits (login 10/min, push, messages, global 300/min) disappear.
- Impact: credential stuffing across many accounts is only slowed by per-account lockout; resource-heavy endpoints unthrottled.
- Fix: keep availability but add a per-instance in-memory fallback limiter (token bucket) used while Redis is down, with stricter caps on `@Throttle(CREDENTIAL_THROTTLE)` routes; alert on `rate_limit.redis_unreachable`.
- Status: Open.

### API-002 Blind SSRF via Web Push endpoint (MEDIUM)
- File: `apps/api/src/app/portal/portal-push.controller.ts:16`, `apps/api/src/app/staff-push.controller.ts:15`, `libs/notification/src/lib/push/web-push.sender.ts:88`.
- Evidence: `endpoint: z.url().max(2048).startsWith("https://")`; stored then used as the POST target.
- Exploitability: any signed-in patient (5 devices) or staff member can register an arbitrary https URL, including an internal https host or an attacker server, then trigger sends (test endpoint, 5/min; real notices). Response status codes influence server behavior (410/404 disable the subscription, `web-push.sender.ts:90+`).
- Impact: blind request forgery from the API's network position, probing internal https services; payload is encrypted and content-free, so no PHI is exfiltrated. Redirect handling and DNS pinning: Not verified.
- Fix: allow-list the known push-service host suffixes (FCM, Mozilla autopush, Apple web push, Windows notify), reject IP literals and private/loopback resolutions, disable redirects in the sender.
- Status: Open.

### API-003 Idempotency responses stored plaintext, never purged (MEDIUM)
- File: `libs/core/src/lib/idempotency/idempotency.interceptor.ts:59-66,89-95`; table `database/migrations/0001_foundation.sql:14-28`.
- Evidence: whole response body saved as JSONB for any unsafe staff request carrying an `Idempotency-Key`; the only `DELETE ... expires_at < now()` is scoped to the same `user_id` and key (line 61); a grep of `libs`, `apps`, `database` found no scheduled purge. The staff client can send the header on any call (`apps/staff/src/lib/api/client.ts:42`).
- Exploitability: not an attack by itself; requires database read access (backup, SQL injection elsewhere, support access).
- Impact: PHI and one-time secrets (for example MFA setup secret or recovery codes if a client sent a key on those routes) persist indefinitely outside the audited domain tables, and the table has no organization column so RLS does not scope it.
- Fix: scheduled purge on `expires_at` (index exists); allow idempotency only on an allow-list of routes or store a response digest plus resource id instead of the body; exclude `/auth/*` and one-time-secret responses.
- Status: Open.

### API-004 Malformed UUID ids produce 500 (LOW)
- Files: `libs/crm/src/lib/crm.controller.ts:93,100,107,121,128,142,152,159,166,173,180`, `libs/crm/src/lib/crm-series.controller.ts:44-107`, `apps/api/src/app/management-dashboard/management-report.controller.ts:50,57`; filter `libs/core/src/lib/http/exception.filter.ts:57-70` and `PgErrorCode` list `libs/core/src/lib/database/database.ts:12-19` (no `22P02`).
- Evidence: `@Param("id") id: string` without `ParseUUIDPipe`, then `eq(crmCampaign.id, campaignId)` (`crm.service.ts:449`) -> Postgres invalid_text_representation -> falls through to `internal_error` 500 and an error log.
- Exploitability: any caller with the outreach/report permission.
- Impact: noisy 5xx and error logs (alert fatigue), no data leak.
- Fix: add `ParseUUIDPipe` to those 22 params; map `22P02` to 400 in the filter.
- Status: Open.

### API-005 Constraint names in error details (LOW)
- File: `exception.filter.ts:59-65`. 409 and 422 responses include `details.constraint` (database constraint names).
- Impact: schema disclosure, mild reconnaissance aid. Fix: log the constraint, return a stable code only (or only in non-production).
- Status: Open.

### API-006 Realtime token path gaps (LOW)
- File: `apps/api/src/app/realtime/realtime.gateway.ts:73-86` with `libs/auth/src/lib/actor-resolver.ts:50-67`.
- Evidence: `actors.resolve(token, {facilityId})` returns an actor with `passwordChangeRequired`/`mfaEnrollmentRequired` flags that the gateway never inspects; `POST /auth/realtime-tickets` is blocked for such users but the token path is not. No handshake rate limit (guards do not apply to `handleConnection`).
- Impact: a member who has not completed mandatory set-up can subscribe to ids-only queue/lab/notice events. Fix: reject sockets whose actor has either flag; add a per-address connection limiter.
- Status: Open.

### API-007 Upload type not verified; scanner optional in production (MEDIUM, Incomplete implementation)
- File: `libs/documents/src/lib/documents.service.ts:249-277`, `apps/api/src/main.ts:64-69`, `libs/documents/src/lib/document.dto.ts:6`.
- Evidence: the contentType the client declared is stored and used for the signed download (`ResponseContentType`); completion hashes and scans but does not compare magic bytes with the declared type; with `CLAMAV_HOST` unset, completion records `not_scanned` and the file becomes `available`; production only logs `documents.scanner_unconfigured`.
- Exploitability: a patient or staff uploader can store an arbitrary file labelled `application/pdf` or `image/png`; inline disposition is allowed for those types (`documents.service.ts:39,443`).
- Impact: malware or script-bearing content served to staff/patients (mitigated by the cross-origin storage host and `Content-Type` from the record, not verified). Fix: sniff magic bytes on completion and reject mismatches; make production refuse to start (or refuse uploads) without a scanner unless explicitly overridden.
- Status: Open.

### API-008 50 MB memory buffer per completion (LOW)
- File: `documents.service.ts:258` (`await this.storage.get(...)` into a Buffer then hashed and scanned in one piece).
- Impact: concurrent completions of max-size files raise memory; limited by the 300/min global throttle only. Fix: stream hash and scan; cap concurrency.
- Status: Open.

### API-009 Idempotency edge cases (LOW)
- File: `idempotency.interceptor.ts:45-48,59-95`.
- Evidence: key scoped to `(user_id, key)`; the request hash covers method, path and body but not `X-Facility-Id`, so the same key and body in a different facility replays the first facility's stored response; the interceptor acts only when `request.actor` is set, so the header is silently ignored on portal routes (MyHealth implements its own keys); if `complete()` fails after the handler committed, `release()` deletes the key and a retry repeats the mutation.
- Fix: include facility id in the hash; document the portal behavior; make `complete` part of the handler transaction where practical.
- Status: Open.

### API-010 Host header reflected in Location (INFO)
- File: `apps/api/src/app/fhir/fhir-import.controller.ts` (receive handler builds `${request.protocol}://${request.get("host")}/...` for `Location` and an OperationOutcome code system). The caller controls their own response only; no shared cache. Fix: build from configured `FHIR_BASE_URL`.
- Status: Open.

### API-011 Body `unknown` handlers (LOW)
- Files: `apps/api/src/app/fhir/fhir-import.controller.ts:23-30` (validated in `FhirImportService.receive`, by design), `apps/api/src/app/portal/portal-teleconsult.controller.ts:33-37` (service-side parse of the pre-consult questionnaire, Not verified). Fix: a Zod DTO at the edge for the teleconsult route.
- Status: Open.

### API-012 Public readiness detail (INFO)
- File: `apps/api/src/app/health.controller.ts:48-60`. Anyone can see whether Redis, object storage and the malware scanner are `ok/unreachable/unconfigured`. Fix: restrict `/ready` to the platform network or return only the status code publicly.
- Status: Open.

### API-013 Environment-dependent hardening (LOW)
- File: `libs/core/src/lib/config/app-config.ts:41`, `configure-app.ts:28-41`. `NODE_ENV` defaults to `development`; Swagger UI and API schema are exposed whenever it is not `production`. Terraform sets production (`main.tf:33,53`). Fix: default to `production` or require the variable; test that `/api/docs` is 404 in production.
- Status: Open.

### API-014 Client IP trust (LOW)
- File: `app-config.ts:66`, `configure-app.ts:21`. With `TRUST_PROXY` off behind a proxy all clients share the limiter bucket; with it on, the right-most `X-Forwarded-For` hop is trusted and direct reachability of the API would allow address spoofing by the previous hop only (one hop). Deployment reachability Not verified. Fix: assert the setting in production start-up checks and document network exposure.
- Status: Open.

### API-015 Only global throttle on public webhook/opt-out (LOW)
- Files: `libs/billing/src/lib/billing.controllers.ts:474`, `libs/crm/src/lib/crm.controller.ts:184`. Fix: dedicated `@Throttle` (signature check already precedes DB work for the webhook).
- Status: Open.

### API-016 Blacklist serialization (LOW)
- Files: `libs/clinic/src/lib/clinic-support.ts:4`, `libs/billing/src/lib/billing-support.ts:5`, `libs/laboratory/src/lib/laboratory-support.ts:4`. Returned rows contain every column except `organizationId`; new internal columns would be exposed by default. Fix: explicit response mappers or a lint rule/test that checks response keys against a contract.
- Status: Open.

### API-017 Silent field stripping (INFO)
- Zod object schemas strip unknown keys (no `.strict()`); clients are not told about ignored fields. Not a vulnerability; note for contract testing.
- Status: Open.

### API-018 Platform-scope public routes (INFO)
- Files: `access.guard.ts:51-58`; 15 routes tagged `@PlatformScope` (inventory section A). The request runs with cross-organization RLS visibility. Handlers must filter by organization explicitly (sign-in resolves organization from the account; webhook from the payment intent). Keep the set minimal and review any addition.
- Status: Open.
