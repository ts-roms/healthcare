# API security test report (Stage A: reading existing tests, nothing was run)

Scope: the 119 files under `apps/api/test` (`*.int.spec.ts`, run by `pnpm test:integration` against real PostgreSQL and Redis; they wipe the test database, so none were executed in this audit) plus the unit specs next to the HTTP code. "Proves" means the assertion exists in the file cited; whether it passes today is Not verified (no run). The harness builds the same app as production through `configureApp` with `rawBody: true` (`apps/api/test/harness.ts:15,143-144`), row-level security in `enforce` mode, and the **rate limiter disabled** by default (`harness.ts:136`, `disableRateLimit: true`), so only `rate-limit.int.spec.ts` exercises throttling.

## Coarse volume (grep of `.expect(<status>)` / `toBe(<status>)`)

| Status | Occurrences | Files |
|---|---|---|
| 400 | 205 | 79 |
| 401 | 107 | 26 |
| 403 | 279 | 79 |
| 404 | 92 | 52 |
| 409 | 121 | 56 |
| 413 | 0 | 0 |
| 422 | 420 | 85 |
| 429 | 2 | 1 |

## Negative-case matrix

| Negative case | What existing tests prove (file:line) | Gaps | Rating |
|---|---|---|---|
| Missing authentication (staff) | Anonymous `GET /patients` is 401 with the standard error envelope (`auth.int.spec.ts:26-31`). 26 files assert 401 somewhere. | No test enumerates every non-public route and asserts 401 without a token; a newly added route that is wrongly marked `@Public()` or placed outside the guard would not be caught. | Tested no issue (sample); matrix gap |
| Missing authentication (portal) | Staff token on portal route and patient token on staff routes are 401 (`portal.int.spec.ts:149-153`). | No route-matrix test for the 104 portal routes. | Tested no issue (sample) |
| Invalid / malformed / forged token | Garbage token on the realtime socket is refused (`realtime.int.spec.ts:207-210`); an MFA challenge token and a realtime ticket are not accepted as access tokens (`auth.int.spec.ts:119`, `realtime.int.spec.ts:298-306`). | No HTTP test with a garbage Bearer, a token signed with another secret, `alg: none`, wrong issuer/audience, or a tampered payload. The audience separation between staff and patients is covered only by one case. | Partially tested |
| Expired token | Not found. `grep expired` in the auth/portal/realtime specs hits other topics (activation, offers). Refresh-token reuse is covered: replay revokes the session (`auth.int.spec.ts:49-60`, `portal.int.spec.ts:155-161`). Ended session/logout tested (`auth.int.spec.ts:62-67`). | No test advances time or uses `JWT_ACCESS_TTL_SECONDS` to prove an expired access token is refused; no test for an expired realtime ticket (60 s). | Not tested |
| Unauthorized roles / permissions | Missing permission is 403 and audited as `access.deny` (`access.int.spec.ts:19-26`); org-wide vs facility-scoped grants (`access.int.spec.ts:28-34,60-67`); role-assignment escalation refused (`access.int.spec.ts:101`); platform-admin only route refused for org admin (`access.int.spec.ts:138`, `rate-limit.int.spec.ts:57`); 279 403 assertions across 79 files. | No generated test that, for every route, tries a user holding no permission and expects 403; coverage depends on each feature spec having written one. | Tested no issue (sample); matrix gap |
| Unauthorized IDs (IDOR, cross-organization) | Cross-organization access refused or hidden in documents (`documents.int.spec.ts:62-80`), patients (`access.int.spec.ts:67`), FHIR, immunizations, outside results, QR, PhilHealth and others (20 spec files mention another organization); row-level security spec proves tenant isolation at the database (`row-level-security.int.spec.ts:41-120`); portal: another patient cannot change an appointment (`portal-booking.int.spec.ts:219`), read or mark someone's message (`portal-outreach.int.spec.ts:137`), never sees another's records (`portal-records.int.spec.ts:319`); guardian proxy: strangers, malformed ids, other people's dependents refused with `proxy_not_allowed` (`portal-proxy.int.spec.ts:172-178`). | Coverage is per feature; no systematic "ID of another organization" sweep over staff routes; facility-scoped object access (same org, other facility) is tested only for a few routes (`access.int.spec.ts:30-33`, billing). | Tested no issue (sample) |
| Invalid payloads | 205 `400` and 420 `422` assertions; unsupported upload type refused (`documents.int.spec.ts:62-69`); wrong activation details return a uniform 401 (`portal.int.spec.ts:77-92`); query validation e.g. `days=0` is 400 (`rate-limit.int.spec.ts:58`). | No property-style tests of Zod boundaries on high-risk routes (money amounts, ids, dates) beyond feature specs; the unvalidated-UUID defect (API-004) is not caught by any test (no `22P02` / non-UUID id test on outreach or report-schedule routes). | Partially tested |
| Malformed JSON | None found (`grep` for malformed/invalid JSON in `apps/api/test` returned nothing). | The mapping of body-parser `SyntaxError` and wrong `Content-Type` to a clean 400 through the global filter is Not tested. | Not tested |
| Oversize request | No 413 assertion anywhere (0 files). Upload size limit: DTO rejects `sizeBytes` > 50 MB at registration (`document.dto.ts:20`), size mismatch refusal exists (`documents.service.ts:252`); `document-scanning.int.spec.ts:71-88` covers checksum mismatch. | The 1 MB JSON body limit (`configure-app.ts:23`) and the FHIR 512 KiB/100-entry limits are not tested at the HTTP edge; oversize in-memory upload completion untested. | Not tested |
| Rate limiting | Login limited to 10/min, counted across two app instances sharing Redis, 11th is 429 with `Retry-After` (`rate-limit.int.spec.ts:46-54`); refusals counted by route for platform admins only, no address leaked (`56-65`); health unlimited (`67-72`); fail-open while Redis is down is asserted as intended (`74-84`). Account lockout after repeated failures (`auth.int.spec.ts:40-47`, `portal.int.spec.ts:94-95,194`). | Only `POST /auth/login` is exercised. The portal credential routes, the 300/min global limit, the per-route `@Throttle` limits (push, messages, test-send), the webhook, and `TRUST_PROXY`/forwarded-address behaviour are not tested. The fail-open test locks in the behaviour that API-001 flags. | Partially tested |
| Idempotency | Staff key reuse with different body is refused (`patients.int.spec.ts:71`, `billing.int.spec.ts:296`, `billing-deposits.int.spec.ts:79`); offline replay stores and replays a response once (`offline-replay.int.spec.ts:36-70`); portal history submissions use their own key (`patient-history.int.spec.ts:779`); payment webhook completes once per intent (`billing-paymongo.int.spec.ts:163-164`). | No test for `invalid_idempotency_key`, `idempotency_in_progress` (concurrent request), expiry, same key across facilities, release-on-failure, or portal routes ignoring the header. No unit spec for `IdempotencyInterceptor` (`libs/core/src/lib/idempotency` has no spec file). | Partially tested |
| Webhook signature | Forged secret, stale timestamp, valid, replay, and non-payment event (`billing-paymongo.int.spec.ts:159-175`); unit coverage of signature parsing in `apps/api/src/app/adapters` specs (Not verified which). Raw-body path exercised through the real HTTP stack. | Missing body, wrong content type, missing signature header, oversize body, and unconfigured-gateway behaviour in production config are not covered at the HTTP level. | Tested no issue (core cases) |
| Upload validation | Presigned upload, size, type allow-list, cross-org, checksum, malware quarantine, scanner unreachable, not-scanned readiness (`documents.int.spec.ts`, `document-scanning.int.spec.ts:59-167`, `document-integrity.int.spec.ts`). | No test that a file whose bytes do not match its declared content type is refused (API-007); no test for the unscanned-in-production start-up policy. | Tested no issue (listed cases) |
| Realtime gateway | Per-channel permission rooms and payload content (`realtime.int.spec.ts:69-205`); unauthorized/ wrong-facility connection refused (`207-218`); ticket bound to facility, not accepted as access token, ended session refused (`290-320`); cross-instance delivery and Redis outage (`322-360`). | A user with `passwordChangeRequired`/MFA enrollment pending using the token path is not tested (API-006); no connection-flood test. | Tested no issue (listed cases) |
| Security headers / CORS | None found. | No assertion of helmet headers, CORS allow-list (allowed vs disallowed origin, credentials), or absence of `X-Powered-By`. | Not tested |
| Swagger exposure | None found. `createTestApp` runs with `NODE_ENV=test`, so Swagger is on in tests. | No test that `/api/docs` is absent when `NODE_ENV=production` (API-013). | Not tested |
| Error leakage | `rate-limit.int.spec.ts:64` checks no address in refusal data; auth spec checks uniform error for unknown vs wrong credentials (`auth.int.spec.ts:33-38`). | No test that a forced 500 hides internals; no test that 409/422 `details` omit constraint names (API-005). | Partially tested |
| Row-level security / app role | `row-level-security.int.spec.ts`, `app-role.int.spec.ts:51` (append-only tables refuse update). | Not an HTTP test; covered here only as a backstop for IDOR. | Tested no issue |
| Authorization of public routes | Opt-out, password reset and activation single-use behaviours covered in `crm-outreach.int.spec.ts`, `portal-password-reset.int.spec.ts`, `staff-credential-reset.int.spec.ts` (Not read in detail). | Not verified that each of the 17 public routes has at least one abuse test (replay, enumeration, throttle). | Not verified |

## Cross-cutting observations

- The suite is strong on feature-level authorization (hundreds of 403/404/409/422 assertions) but has **no systematic, generated route-level checks**. The audit found 799 routes (`API_INVENTORY.md`); a single test that walks the Nest route table and asserts (a) 401 without credentials for every non-public route and (b) the documented permission set per route would turn the inventory into a regression gate and would catch a missing decorator on a new controller.
- Throttling is off in nearly all tests; if production-only throttle settings (for example the 300/min default) break a legitimate workflow such as the dashboard's parallel loads (`clinic-dashboard-load.int.spec.ts`), tests will not show it. Not verified whether that spec enables rate limiting (default does not).
- Tests assert behaviour that is a deliberate trade-off (fail-open limiter). They would need to change if API-001 is fixed.

## Findings

| ID | Severity | Title | Status |
|---|---|---|---|
| API-019 | MEDIUM | No test that expired, tampered, wrong-secret or `alg:none` access tokens are refused | Open |
| API-020 | LOW | No route-matrix test enforcing authentication and documented permissions on all 799 routes | Open |
| API-021 | LOW | Malformed JSON, wrong content type and oversize (413) responses untested | Open |
| API-022 | LOW | Rate-limit coverage limited to staff login; portal credential routes, global limit and per-route throttles untested | Open |
| API-023 | LOW | Idempotency interceptor has no unit or concurrency tests (in-progress, expiry, facility scope, release on failure) | Open |
| API-024 | LOW | CORS, helmet headers and production Swagger-off are untested | Open |
| API-025 | LOW | Upload content-type spoofing and unscanned-production policy untested | Open |
| API-026 | INFO | Fail-open limiter behaviour is locked in by `rate-limit.int.spec.ts:74-84` | Open |

### API-019 Token validity tests missing (MEDIUM, test gap)
- Evidence: no assertion uses an expired access token; no forged-signature, `alg: none` or wrong issuer/audience token appears in `apps/api/test`. Verification code is correct on reading (`libs/auth/src/lib/tokens.ts:79-96`), so this is a regression-protection gap, not a known defect.
- Exploitability/impact: a future change to `JwtService` options, algorithm list or secret handling would not be detected.
- Fix: add integration cases (garbage token, token signed with another secret, `alg: none`, wrong `aud`, expired by lowering `JWT_ACCESS_TTL_SECONDS` or signing with a past `exp`, expired realtime ticket) for staff and patient audiences.
- Status: Open.

### API-020 No route-matrix test (LOW, test gap)
- Evidence: no spec iterates the router; the audit had to build the inventory by scanning source. 117 staff routes (counted before judgment: 19 with no permission) rely on per-controller discipline.
- Fix: a spec that reads the Nest route table plus metadata (`ACCESS_METADATA`) and fails when a route is neither `@Public()` nor carries `@RequirePermissions`/an explicit allow-list entry; snapshot the allow-list of the 19 self-service staff routes and 17 public routes from `API_INVENTORY.md`.
- Status: Open.

### API-021 Malformed/oversize requests (LOW, test gap)
- Evidence: zero 413 assertions; no malformed-JSON test. Behaviour of Nest's mapping of Express body-parser errors through `HttpExceptionFilter` (`exception.filter.ts:46-50`) is Not verified.
- Fix: tests for invalid JSON (400 envelope with request id), body above 1 MB (413 or mapped code, not 500), unsupported `Content-Type`.
- Status: Open.

### API-022 Rate limit coverage (LOW, test gap)
- Evidence: `rate-limit.int.spec.ts` targets `POST /auth/login` only; `harness.ts:136` disables the limiter elsewhere.
- Fix: parameterize the spec over MyHealth login, activation, password reset, refresh, and one `@Throttle` route (push test, 5/min); add a `TRUST_PROXY` test showing two forwarded addresses get separate buckets.
- Status: Open.

### API-023 Idempotency tests (LOW, test gap)
- Evidence: `libs/core/src/lib/idempotency` contains only `idempotency.interceptor.ts`; integration tests cover reuse with a different body and the offline replay only.
- Fix: unit/integration tests for concurrent duplicate (`idempotency_in_progress`), invalid key, expiry, failure releasing the key, and (after API-009 fix) facility scope.
- Status: Open.

### API-024 Headers, CORS, Swagger tests (LOW, test gap)
- Evidence: no assertion on `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Powered-By`, `Access-Control-Allow-Origin`, or `/api/docs` under `NODE_ENV=production`.
- Fix: one spec booting `configureApp` with a production config and an allowed/disallowed origin.
- Status: Open.

### API-025 Upload spoofing tests (LOW, test gap)
- Evidence: see matrix; no test for declared `image/png` with non-image bytes.
- Fix: add after API-007 is addressed, including the production behaviour without `CLAMAV_HOST`.
- Status: Open.

### API-026 Test locks in fail-open (INFO)
- Evidence: `rate-limit.int.spec.ts:74-84`. If API-001 is remediated with a local fallback limiter, this test must be rewritten to assert the fallback cap instead.
- Status: Open.
