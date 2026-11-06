# Zero-trust audit — 2026-11-06 (release/v1.1.0)

Read-only review of the platform against zero-trust principles: verify explicitly on every request, least privilege, no
implicit trust in network location, device or another component, assume breach. Four boundaries were reviewed:
identity and sessions, service-to-service trust, data layer and secrets, frontends and the HTTP edge. No code was
changed.

**Verified** = re-read in the code by the lead reviewer after the boundary review. Other findings were found with file
evidence by the boundary reviewer but not independently re-checked; "needs confirmation" items depend on something
outside the repository (Railway behaviour, a key fingerprint).

## Remediation of the high findings (same day)

| #   | What changed                                                                                                                                                                                                                                                                                                     | Status    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| A1  | `InvoiceService.detailAt` checks the request's facility; used by the invoice read, invoice PDF and receipt PDF. Integration test across two facilities.                                                                                                                                                          | Fixed     |
| D1  | `DatabasePrivilegeCheck` (libs/core): in production the API and workers refuse to start as a superuser, a `BYPASSRLS` role or the tables' owner, unless `DATABASE_ALLOW_OWNER=true` (logged `db.owner_connection`). Terraform refuses the plan without `secrets.app_database_url` unless `allow_owner_database`. | Fixed     |
| D2  | The API deletes `MIGRATION_DATABASE_URL` from `process.env` at start-up. It is still in the container's environment: a separate migration service is the remaining step.                                                                                                                                         | Mitigated |
| D3  | Migration `0144`: an owner-only `audit_retention_floor` (nothing removed without it, never inside it), archives start pending and are verified only from running, `apply_*` functions no longer executable by the app role.                                                                                      | Fixed     |
| S1  | Gateway listeners require `allowedPeers` per instrument (others closed before reading), at most two connections, 1 MiB link-layer cap (`LinkOverflowError`), ASTM deliveries serialized; API URL must be https (http only for loopback).                                                                         | Fixed     |
| S2  | Migration `0145`: built-in role `instrument_gateway` holding only `lab.instrument.message.submit`, removed from `org_admin`; the gateway refuses to send as a broader account (`/auth/me`); `GATEWAY_PASSWORD_FILE`.                                                                                             | Fixed     |
| F1  | The service worker no longer precaches `/offline`; the Offline page asks for its snapshot, which is stamped and never served after 12 hours, is deleted at sign-out, idle sign-out and on reaching the sign-in page, and a redirect to sign-in is never kept. Offline journey (`6-offline`) passes.              | Fixed     |

Medium findings fixed next:

| #   | What changed                                                                                                                                                                                                                                                                                                     | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| A3  | The generic document routes apply a per-category rule (`document-access.ts`): imaging, outside results, laboratory reports, billing and record copies also need their domain's permission (the records office may open all); management report files are never served there. Refusals are `404`, audited denied. | Fixed  |
| S5  | In production the API refuses to start without `CLAMAV_HOST` unless `MALWARE_SCAN_REQUIRED=false` (fail closed).                                                                                                                                                                                                 | Fixed  |
| D6  | Migration `0146`: the app role holds no privilege on the audit trail's partitions, so they are reached only through `audit_event` and its row-level security.                                                                                                                                                    | Fixed  |
| A2  | Cancelling a laboratory order or one of its tests is refused (`404`) when the request acts in another facility.                                                                                                                                                                                                  | Fixed  |
| A5  | In production, platform administrator routes answer only when the administrator has two-step verification on (`PLATFORM_ADMIN_MFA_REQUIRED`); otherwise `403 platform_admin_mfa_required`, audited.                                                                                                              | Fixed  |
| A4  | Open realtime sockets (staff and MyHealth) are re-checked every minute: an ended session or revoked access disconnects, a removed permission leaves its channel.                                                                                                                                                 | Fixed  |
| D9  | MyHealth sign-in, activation (also from a card), refresh, both reset routes, the outreach opt-out and the payment notification keep platform scope only for the lookup that finds the organization, then run under it (`withinOrganization`); the opt-out token is marked used only once.                        | Fixed  |
| S6  | Web Push endpoints must be on a browser push service (`PUSH_SERVICE_HOSTS`); others are refused at registration and dropped at sending.                                                                                                                                                                          | Fixed  |
| Low | Reset links (staff and MyHealth) are kept sealed with the integration key ring while queued (`sealedVariables`), opened only by the dispatcher.                                                                                                                                                                  | Fixed  |
| Low | A locked account answers `invalid_credentials` at sign-in, like a wrong password (audited as locked).                                                                                                                                                                                                            | Fixed  |
| Low | Waiting-room screens (display-only accounts) are in their own realtime room and receive only the time of a queue change, never a visit's priority or status.                                                                                                                                                     | Fixed  |
| Low | The redirect after sign-in refuses control characters and backslashes and must resolve to the same origin (`safeNextPath`).                                                                                                                                                                                      | Fixed  |
| Low | Production refuses the development LiveKit and object-storage credentials and a LiveKit secret under 32 characters.                                                                                                                                                                                              | Fixed  |
| Low | Readiness checks run at most every 5 seconds; per-dependency details only with `HEALTH_DETAILS_TOKEN` (or outside production); workers alike.                                                                                                                                                                    | Fixed  |
| Low | A staff session not refreshed for `SESSION_IDLE_MINUTES` (default 12 hours) ends at its next refresh.                                                                                                                                                                                                            | Fixed  |
| Low | Sign-in challenges (staff and MyHealth) and live-update tickets are single-use (migration `0147`); every token carries a random id.                                                                                                                                                                              | Fixed  |
| Low | HSTS on the staff, portal and kiosk apps includes subdomains.                                                                                                                                                                                                                                                    | Fixed  |
| D8  | Production requires TLS to PostgreSQL, Redis, SMTP and object storage and `wss` to LiveKit (`transportSecurityProblems`); `ALLOW_PLAINTEXT_PRIVATE_NETWORK` exempts private-network hosts only (Terraform sets it for Railway).                                                                                  | Fixed  |

**Deployment notes:** an existing deployment still on the owner connection must set `DATABASE_ALLOW_OWNER=true` (or
switch to the restricted role) before this release, or its services will not start. An instrument gateway must be
moved to an account holding only the **Instrument gateway** role and given `allowedPeers`. Audit months can be removed
only after the owner sets `audit_retention_floor`. A production API without ClamAV must configure it or set
`MALWARE_SCAN_REQUIRED=false`, or it will not start. Platform administrators must turn on two-step verification
before using platform routes in production.

## Fix first

| #   | Severity | Finding                                                                                          | Verified |
| --- | -------- | ------------------------------------------------------------------------------------------------ | -------- |
| D1  | High     | Deployed API/workers fall back to the database owner when `app_database_url` is unset            | Yes      |
| D2  | High     | The running API holds the owner URL (`MIGRATION_DATABASE_URL`)                                   | Yes      |
| D3  | High     | App role can call `remove_audit_partition` with its own retention and forge `audit_archive` rows | Yes      |
| A1  | High     | Invoice, invoice PDF and receipt PDF reads skip the facility check (cross-facility IDOR)         | Yes      |
| S1  | High     | Instrument gateway listeners accept results from any host (`0.0.0.0`, no peer check, no TLS)     | Yes      |
| S2  | High     | Gateway identity is a password-only staff account; only `org_admin` holds its permission         | Yes      |
| F1  | High     | Staff service worker caches the `/offline` page (queue names, numbers, complaints) past sign-out | Yes      |
| A3  | Medium   | `document.read` downloads any unmanaged document (imaging, record copies, management reports)    | Yes      |
| S5  | Medium   | Malware scanning fails open in production when `CLAMAV_HOST` is unset                            | Yes      |
| F4  | Medium   | MyHealth APK committed and served, signed with the template debug key                            | Partly   |
| D4  | Medium   | `DATABASE_RLS_MODE` defaults to `observe` (context-less query sees all organizations)            | Yes      |

## 1. Data layer and secrets

**D1 — High — Owner connection by default.** `infrastructure/terraform/railway/main.tf:30,150-156`: without
`secrets.app_database_url`, `DATABASE_URL` of every backend service is `${{Postgres.DATABASE_URL}}` (superuser). RLS
and append-only privileges are then bypassed and nothing at start-up notices. _Fix:_ make `app_database_url` required;
at API/worker start in production refuse to run when `rolsuper OR rolbypassrls` or the role owns application tables.

**D2 — High — Owner credentials in the API runtime.** `main.tf:50` adds `MIGRATION_DATABASE_URL` (owner) to the API
service variables, visible to the process at runtime, not only to the pre-deploy step. An RCE or env dump gives
`DROP TRIGGER`/`DISABLE ROW LEVEL SECURITY`. _Fix:_ run migrations from a separate one-off migrate service that alone
holds the owner URL.

**D3 — High — Audit removal reachable by the app role.** `0109_app_role.sql:32` grants `EXECUTE ON ALL FUNCTIONS` to
`healthcare_app` after every migration run, overriding the `REVOKE … FROM PUBLIC` of `remove_audit_partition`
(`0110:214`), a `SECURITY DEFINER` function whose retention gate is a caller-supplied parameter. The app role can also
insert `audit_archive` rows already marked verified. _Fix:_ read the retention period inside the function from an
owner-controlled setting; let only the archive path set `verified` (or verify the stored object in the function);
revoke `EXECUTE` on owner-only functions (`apply_*`, `ensure_audit_partitions`) in `apply_app_privileges()`.

**D4 — Medium — RLS observe by default.** `libs/core/src/lib/config/app-config.ts:51`, `database-context.ts:74`
(`scope: mode === "observe" ? "all" : "none"`). _Fix:_ require `enforce` in production (explicit override flag), alert
on `db.context_missing`; or let `observe` stamp `none` and log.

**D5 — Medium — Scope forgeable from SQL.** `rls_organization_visible` trusts `current_setting('app.scope')`
(`0111:15-20`), which any app-role session can set. RLS stops logic mistakes, not SQL-level compromise. No `sql.raw`
with user input was found. _Fix:_ document the limit, or move platform scope to a separate role taken with `SET ROLE`.

**D6 — Medium — Audit partitions readable directly.** `apply_rls_policies()` skips partitions (`0111:41`), so
`SELECT * FROM audit_event_default` returns every organization's events. _Fix:_ enable RLS/policy on partitions in
`ensure_audit_partitions()`, or revoke direct access to partitions from `healthcare_app`.

**D7 — Medium — PHI tables without `organization_id`.** `idempotency_record.response_body` (`0001:14-26`),
`prescription_item`, `care_plan_goal|problem|progress_note`, `notification_attempt`, `staff_recovery_code`,
`staff_password_reset`. _Fix:_ add `organization_id` with composite FK so `apply_rls_policies()` covers them; minimise
or seal `response_body`.

**D8 — Medium — No TLS requirement** for PostgreSQL, Redis (`redis://`), SMTP (no `requireTLS`), S3 (`http:` allowed),
LiveKit (`ws:`). _Fix:_ production `superRefine` requiring `sslmode=verify-full|require`, `rediss://` (or a documented
private-network exemption), `smtps://`/`requireTLS`, `https`, `wss`.

**D9 — Medium — Public routes keep platform scope for writes.** MyHealth login/activate/refresh/reset
(`portal.controller.ts:36-86`), outreach opt-out (`crm.controller.ts:185`), PayMongo webhook
(`billing.controllers.ts:469`). _Fix:_ `asPlatform` only for the lookup that finds the organization, then
`asOrganization(org.id, …)`.

**Low:** placeholder-secret check misses `LIVEKIT_API_SECRET` (`min(1)`; dev `secret` would mint room tokens) and sample
S3 keys (`app-config.ts:120,196-207`); MFA seeds sealed without key id or AAD binding to the account; password-reset
links stored in clear in queued notification variables until sent; presigned downloads are 5-minute bearer URLs and
bucket privacy is not in code or Terraform.

## 2. Identity, authentication and authorization

**A1 — High — Invoice IDOR across facilities.** `libs/billing/src/lib/invoices/invoice.service.ts:456-473`: `get()` →
`detail(organizationId, id)`; `invoicePdf()`/`receiptPdf()` the same — while `lock()` at `:717` and the credit/debit
note reads do check `actor.facilityId`. _Fix:_ facility assertion in `get`, `invoicePdf`, `receiptPdf` (or a facility
parameter on `detail`), plus a two-facility integration test.

**A2 — Medium — Lab order cancel not facility-scoped.** `lab-order.service.ts:183-202` (`cancel`, `cancelItem` lock by
organization only); specimen and result paths do check. _Fix:_ same facility rule; document whether order reads are
intentionally organization-wide.

**A3 — Medium — `document.read` bypasses domain gates.** `documents.service.ts:437,609`: `find()` filters on
organization, id and `managedBy IS NULL`; generated `imaging`, `record_copy`, `management_report`,
`medical_certificate`, `referral_letter` and message attachments are reachable through `GET /documents/:id/download-url`
without `dental.imaging.read`, `patient.message.read`, `billing.report.read` etc. _Fix:_ per-category permission map
enforced in `find()`; mark domain-owned generated documents with `managedBy`; facility check where set.

**A4 — Medium — Realtime authorized once.** `realtime.gateway.ts:72-112`: rooms joined at connect, never re-checked;
suspended or de-permissioned users keep receiving events. _Fix:_ periodic re-validation or disconnect on
`SessionRevoked`/role change via the `user:{id}` room.

**A5 — Medium — Platform admins not required to use MFA.** `access.guard.ts:87`. _Fix:_ refuse
`@RequirePlatformAdmin` without MFA; step-up for destructive actions (audit removal, key rotation).

**Low:** the waiting-room display's socket receives `priority` (`visit.service.ts:125-131`, same facility room —
contradicts the display rule); no structural check that every `@Public()` portal route has `PatientAccessGuard`
(add a route-inventory test or a `@PortalRoute()` decorator); `account_locked` before password check is an
account-existence oracle; MFA challenge JWTs and realtime tickets are not single-use, no server-side idle timeout for
staff sessions, staff and portal tokens share one HS256 secret; `/health/ready` publicly reveals scanner state.

## 3. Service-to-service

**S1 — High — Instrument listeners trust the network.** `apps/instrument-gateway/src/config.ts:52` defaults to
`0.0.0.0`; `listeners.ts:22,66` accept any peer with no TLS, cap or timeout, and submit as the configured instrument. A
device on the clinic LAN can inject results attributed to the analyzer (review is the only barrier). _Fix:_ required
`allowedPeers` per instrument, one connection per listener, idle timeout, bind to the analyzer VLAN interface,
document segmentation/stunnel.

**S2 — High (configuration) — Gateway identity.** `GATEWAY_EMAIL`/`GATEWAY_PASSWORD` from plain env, "account without
MFA"; `0075:136` grants `lab.instrument.message.submit` only to `org_admin`, so the easy set-up is an MFA-exempt
org_admin password on an on-site PC. _Fix:_ built-in `instrument_gateway` role holding only that permission (as
`kiosk_print_agent`), refuse gateway use of broader accounts, `GATEWAY_PASSWORD_FILE`; later a revocable per-gateway
credential.

**S3 — Medium — Gateway allows `http://` to any API host** (`config.ts:35`). _Fix:_ the print agent's rule (https,
http for loopback only).

**S4 — Medium — Unbounded parser buffers.** `instrument-links.ts:23,32,117` concatenate without a cap (quadratic);
ASTM deliveries start unbounded retry chains. _Fix:_ 1 MiB cap then destroy, frame limit, bounded delivery queue.

**S5 — Medium — Fail-open malware scanning.** `apps/api/src/main.ts:68` only warns when `CLAMAV_HOST` is unset in
production; uploads become available `not_scanned`. clamd is plain TCP and any `OK` is clean. _Fix:_
`MALWARE_SCAN_REQUIRED` (default true in production) refusing start or completion; clamd on a sidecar/loopback or TLS.

**S6 — Low/Medium — Web Push blind SSRF.** `push-endpoint.ts:13-26` checks shape only (acknowledged DNS-rebinding
gap). _Fix:_ allowlist push-service hosts and/or resolve and refuse private addresses at send time.

**Low:** `/health/ready` is unthrottled and opens a clamd connection per call (cache all probes; worker `HEALTH_PORT`
binds all interfaces); outreach opt-out token in the query string and check-then-set use; print agent trusts DNS for
"private" names.

## 4. Frontends and edge

**F1 — High — PHI in Cache Storage after sign-out.** `apps/staff/public/sw.js:33-48` caches the server-rendered
`/offline` page (`offline/page.tsx:31-40`: patient number, name, chief complaint, priority) and serves it without a
session; sign-out clears only cookies and there is no `Clear-Site-Data`. The file's header comment claims no patient
data is cached. _Fix:_ `Clear-Site-Data: "cache"` and `caches.delete` on sign-out and idle sign-out; better, cache a
data-free shell and keep the snapshot encrypted with the outbox key.

**F2 — Medium — No `script-src` CSP on staff and portal** (`next.config.ts:11`), while the offline outbox key sits raw
in `sessionStorage` (`offline/crypto.ts:26-31`). _Fix:_ port the kiosk's nonce + `strict-dynamic` CSP
(`apps/kiosk/src/lib/csp.ts`); use a non-extractable `CryptoKey` in IndexedDB.

**F3 — Medium — Kiosk device credential is bearer-only from anywhere.** Password → indefinitely renewed refresh cookie,
MFA-exempt, no network binding, public kiosk domain. _Fix:_ optional per-device egress allowlist, shorter refresh
lifetime with re-pairing by one-time code, alert on a new address.

**F4 — Medium — APK integrity.** `apps/portal/public/downloads/myhealth.apk` is tracked in git and signed with the
template debug key (fingerprint _needs confirmation_); anyone with that public key can sign an accepted "update". _Fix:_
stop committing it; sign with an organization-held release key; publish the SHA-256.

**Low:** `safe-path.ts:4` doesn't reject control characters (`/\t/evil.example`, needs confirmation against Next's
`redirect`); cookies without `__Host-` prefix and `secure` tied to `NODE_ENV`; HSTS without `includeSubDomains`;
`trust proxy` 1 hop assumed for Railway (needs confirmation — key credential throttles on the account too); single-flight
refresh is per process (multiple replicas look like token reuse).

## Strengths (verified by the reviewers)

- Deny-by-default `AccessGuard`; JWT pinned to HS256 with issuer, audience and `typ`; session, membership and
  permissions re-resolved on every request; facility headers validated; self-escalation blocked.
- Refresh tokens hashed, rotated under lock, reuse revokes; TOTP single-use, recovery codes hashed, MFA in the lockout.
- MyHealth: separate audience, consent re-checked per request, proxy grants scoped and explicit, ownership checks on
  portal reads.
- Queue jobs carry ids only and workers re-claim rows by status; outbox handlers re-read the source; integration,
  FHIR-import and kiosk payloads sealed with a keyed AES-256-GCM ring.
- PayMongo webhook: HMAC over the raw body, `timingSafeEqual`, timestamp tolerance, idempotent completion.
- Least-privilege `healthcare_app` role, append-only triggers, RLS on every `organization_id` table, `enforce` in tests.
- Tokens never reach browser JavaScript; server actions add no authority; helmet, CORS allowlist, 1 MB body limit,
  no `/api/docs` in production; credential routes throttled in Redis.
- Kiosk app and print agent are the model to copy: nonce CSP, `no-store`, device-bound sessions, dedicated
  single-permission role, https-only, loopback-only health listener.
- Mobile refresh token in SecureStore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), access token in memory.

## Not verified

Railway's `X-Forwarded-For` behaviour; the `debug.keystore` fingerprint; Next's handling of control characters in
redirects; whether the staff MFA exemption limits which accounts can be exempted; bucket policy outside the repository.
Side note (functional): Terraform sets `REALTIME_URL` only for staff, so the portal's realtime address defaults to the
private API host.
