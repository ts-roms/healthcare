# Application Security Audit (OWASP Top 10 / ASVS walk-through) - Stage A, read-only

Scope: apps/api, libs/*, workers, Next.js server code. Method: grep and read of the actual code. Nothing was executed or modified.
Legend: Verified secure / Tested no issue (none: nothing executed) / Not tested / Incomplete implementation / Confirmed vulnerability.
This is a targeted sweep: every raw-SQL site, all outbound HTTP, the upload path, CSV, redirect helper and error filter were read. Per-controller authorization (A01) was NOT re-audited here (Not verified).

## 1. SQL injection
Method: grep for `sql.raw`, `sql.identifier`, string-built `.query(`. About 320 `sql` template uses exist (Drizzle parameterises interpolations); they were not read one by one (Not verified individually).

| Site | Judgement |
|---|---|
| libs/clinic/src/lib/dashboard/clinic-reporting.queries.ts:165,205,207,212 `sql.raw("s.facility_id" / "e.facility_id" / "e.completed_at")` and `localDay(column)` | Verified secure: arguments are hard-coded literals; time zone, ids and dates are bound parameters (:167-170). |
| libs/clinic/src/lib/immunizations/immunization.service.ts:655 `sql.raw(order === "asc" ? ... : ...)` | Verified secure: ternary of two constants. |
| libs/core/src/lib/database/migrator.ts:26 `client.query` | Verified secure: static DDL, not request reachable. |
| libs/patient/src/lib/patient-search.service.ts:66,127 LIKE | Verified secure: bound parameter with `escapeLike` for prefix match; trigram `%` operator parameterised. |
| User-controlled ORDER BY | None found: no sort/orderBy zod fields in DTOs (grep). Paging capped at 100: libs/core/src/lib/pagination.ts:5. |

Raw string queries in apps/api/test and apps/e2e/support are test-only.

## 2. XSS
API is JSON-only with helmet (apps/api/src/app/configure-app.ts:18). Frontend sinks: see REACT_FRONTEND_SECURITY_AUDIT.md. The staff proxy 503 HTML is static (apps/staff/src/proxy.ts:70-76).

## 3. CSRF
The API uses bearer tokens (not cookies) and CORS restricted to `CORS_ORIGINS` (configure-app.ts:19): CSRF does not apply to it. The Next apps keep tokens in httpOnly cookies (libs/web-session/src/session.ts:37-45: access `lax`, refresh `strict`, `secure` only in production). Mutations are server actions (Next compares Origin to Host by default; `serverActions.allowedOrigins` is not set in apps/staff/next.config.ts). Route handlers found are GET only (grep). One GET has a side effect: apps/portal/src/app/(portal)/people/stop/route.ts:5-9 (APP-006). Not exercised at runtime (Not tested).

## 4. SSRF
Outbound HTTP found: telemedicine video probe (libs/telemedicine/src/lib/video.ts:82-84; URL from config `LIVEKIT_URL`, abort timeout; not user-influenced: Verified secure); PayMongo adapter (apps/api/src/app/adapters/paymongo-payment-gateway.ts:129, provider fixed; not fully read); online-payment return URL validated against `CORS_ORIGINS` (libs/billing/src/lib/payments/online-payment.service.ts:255-264: Verified secure, also prevents open redirect). Web push / Expo push endpoints are subscriber-supplied; host allowlisting not verified (APP-007). FHIR import takes bodies only; no URL fetching found. Integration worker adapters are unconfigured stubs (Incomplete implementation, by design).

## 5. File upload / path traversal
- Object keys are server generated: `org/${organizationId}/documents/${uuid}` (libs/documents/src/lib/documents.service.ts:125,189,497); the user file name is never part of the key. fileName rejects `/ \ NUL` (document.dto.ts:13-18); Content-Disposition is sanitised (object-storage.ts:181-184). Verified secure.
- Size: declared size capped at 50 MB (document.dto.ts:8,20); presigned PUT signs ContentLength (object-storage.ts:55-70); completion compares stored size (documents.service.ts:252). Verified secure.
- Type: allowlist of declared MIME types only (document.dto.ts:5,19). Bytes are never sniffed on completion (documents.service.ts:248-275): APP-002.
- Malware scan: scanner unreachable fails closed (:268-272, `scan_unavailable`); scanner NOT configured makes the file `available` as `not_scanned` (:267): APP-001.
- The full object is buffered in memory for hash+scan (:259): APP-004. Whether clamd's StreamMaxLength (default 25 MB) is below the 50 MB limit: Not verified.
- Download URL: per-key, short TTL, inline only for pdf/jpeg/png (documents.service.ts:39,443-458). Verified secure.
- Staff `/files/[...path]` proxy uses UUID allowlist regexes (apps/staff/src/lib/files.ts:9-30). Verified secure.

## 6. Command injection / eval / deserialization
grep for `eval(`, `new Function`, `child_process` in application source: none (only built apps/api/dist/main.js matched generic patterns; not reviewed). JSON-only deserialization; body limit 1 MB (configure-app.ts:22). HL7/ASTM/FHIR parsers (libs/interoperability) not reviewed for parser DoS (Not tested).

## 7. Open redirect
`safeNextPath` (libs/web-session/src/safe-path.ts:5-8) rejects non-`/`, `//`, `/\` and auth paths. Verified secure.

## 8. PDF / CSV injection
`toCsv` (libs/core/src/lib/text/csv.ts:7-14) prefixes `'` for leading `= + - @ TAB CR` and quotes `, " CR LF`. Verified secure for those leading characters. PDFs use pdfkit text with standard fonts (no HTML): no injection vector seen.

## 9. SSTI
No template engine fed with user input found in this sweep; outreach wording variables are limited to `{{firstName}}`/`{{clinicName}}` per CLAUDE.md. Not verified in code.

## 10. DoS
- Rate limits are Redis-backed (apps/api/src/app/app.module.ts:179-185); documented to fail open when Redis is unreachable (APP-005, not re-verified in code).
- Pagination cap 100. Some reads use fixed `.limit(1000)` (immunization.service.ts:656). Unpaginated reads elsewhere were not enumerated (Not verified). Export row caps stated in CLAUDE.md were not verified in code.
- ReDoS: the only dynamic RegExp are built from constants (libs/interoperability/src/lib/fhir-import/inbound-validation.ts:66-68). Verified secure.

## 11. Information disclosure
The global filter returns a generic 500 and logs the stack server-side (libs/core/src/lib/http/exception.filter.ts:30-45,69). It returns the database constraint name for unique/FK/check violations (:56-62): APP-003. Swagger is disabled in production (configure-app.ts:34). Log content PHI-freedom: Not tested.

## Findings
| ID | Sev | Location | Evidence | Exploitability | Impact | Recommended fix | Status |
|---|---|---|---|---|---|---|---|
| APP-001 | MEDIUM | libs/documents/src/lib/documents.service.ts:267 | `if (!this.scanner.configured) return {... scanStatus: "not_scanned"}`; file becomes `available` | Any authenticated uploader (staff; patients via portal) when CLAMAV_HOST is unset | Unscanned malware stored and served | Require a scanner in production (refuse start or completion); alert on `not_scanned` | Open |
| APP-002 | MEDIUM | libs/documents/src/lib/document.dto.ts:5,19; documents.service.ts:248-275 | Only declared MIME enum validated; bytes never sniffed | Upload arbitrary content declared as PDF/JPEG | Mislabelled/polyglot files reach viewers; inline render of pdf/jpeg/png (:39) | Verify magic bytes on completion; reject mismatch | Open |
| APP-003 | LOW | libs/core/src/lib/http/exception.filter.ts:56-62 | `details: { constraint: pgError.constraint }` | Any caller who triggers a violation | Schema/constraint name disclosure | Drop details or map to stable codes | Open |
| APP-004 | LOW | libs/documents/src/lib/documents.service.ts:259 | `storage.get` buffers up to 50 MB for hash+scan | Authenticated user completing many large uploads at once | Memory pressure / API DoS | Stream hash and scan; bound concurrency | Open |
| APP-005 | LOW | apps/api/src/app/redis-throttler-storage.ts (design per CLAUDE.md) | Requests pass when Redis is unreachable | Attacker exploits a Redis outage | Rate limits on login/OTP lapse; DB lockout still applies | Fail closed on auth routes or add in-memory fallback | Open (not re-verified in code) |
| APP-006 | LOW | apps/portal/src/app/(portal)/people/stop/route.ts:5-9 | State change (cookie deletion) on GET | Cross-site link forces end of guardian "acting for" mode | Nuisance only | Make it a POST server action | Open |
| APP-007 | INFO | libs/notification push senders | Push endpoint host allowlist not verified | Subscriber supplies endpoint | Possible SSRF if unrestricted | Allowlist known push service hosts | Open (Not verified) |
| APP-008 | INFO | DATABASE_RLS_MODE (CLAUDE.md) | Default `observe` logs but does not refuse queries lacking org context | n/a | Tenant isolation in production depends on running `enforce` | Confirm production uses `enforce` | Open (Not verified) |
