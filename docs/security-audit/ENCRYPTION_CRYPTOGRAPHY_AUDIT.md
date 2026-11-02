# Encryption and Cryptography Audit (Stage A, read-only)

Scope: password hashing, one-time tokens and codes, JWT, symmetric encryption and key handling, integration payload sealing, webhook verification, transport security, encryption at rest, document integrity, randomness, and a secrets scan of the repository.

Method: static review of the working tree (branch `release/v1.0.0`) plus read-only `git grep` / `grep` scans. No secret value is reproduced in this file; locations only. No application, test or network scan was run. Production infrastructure (Railway edge, database and bucket settings) was not inspected: such items are marked **Not verified**.

---

## 1. Summary

| Area | Result |
| --- | --- |
| Password hashing (Argon2id 19 MiB, t=2, p=1) | Verified secure (minimum OWASP profile) |
| Reset, activation, refresh, session and device tokens | Verified secure (random, hashed at rest, single use, expiring) |
| Constant-time comparison | Verified where secrets are compared (webhook, email verification code); hash-equality lookups elsewhere |
| JWT | Verified secure (HS256 pinned, issuer, audience, type, expiry); no rotation (CRY-002) |
| AES-256-GCM sealing and key ring | Verified secure (random 96-bit IV, tag checked, key id authenticated) |
| TOTP secret encryption | Verified secure; no rotation and no AAD (CRY-003) |
| HTTPS / HSTS | API: helmet defaults. Web apps: nothing in code (CRY-004). Edge: Not verified |
| Encryption at rest | Relies on the platform (CRY-007) |
| Secrets in source control | No private key, token or live key found; placeholder values pass production validation (CRY-001) |
| `Math.random` for security | None in application code |

Findings: 0 CRITICAL, 0 HIGH, 4 MEDIUM, 6 LOW, 3 INFO.

---

## 2. Password security

- Algorithm and parameters: `@node-rs/argon2` with `memoryCost: 19456` KiB, `timeCost: 2`, `parallelism: 1` (`libs/auth/src/lib/password.ts:111-116`). The library's default algorithm is Argon2id (`node_modules/@node-rs/argon2/index.d.ts`, `Argon2id = 2`, no override passed). These are the lowest parameters OWASP lists as acceptable; salt is generated per hash by the library (16 bytes).
- Policy: 12 to 128 characters, at least 5 distinct characters, and a breached-password screen via the Pwned Passwords range API on every new password (staff change, reset, activation, administrator-set) (`password.ts:101-109`, `breached-passwords.ts`; on by default only in production, `app-config.ts:68, 185-187`).
- Verification: errors return `false` (`password.ts:118-124`); unknown users still pay one Argon2 verification (`password.ts:126-134`).
- Plaintext: no plaintext password is stored; seeds hash before insert (`tools/db/seed.ts:42`).
- Not present: automatic re-hash when parameters change (`needsRehash` not used anywhere), and no server-side pepper. Both are optional hardening (CRY-009).

## 3. Tokens and codes

| Item | Generation | Storage | Lifetime / limits | Evidence |
| --- | --- | --- | --- | --- |
| Staff and portal refresh tokens | `randomBytes(32)` base64url (`libs/core/src/lib/security/crypto.ts:8-10`) | SHA-256 hex | 14 days default; rotated on use, previous hash kept | `session.service.ts:344-391`, `portal-account.service.ts:481-528` |
| Staff password reset | `randomToken()` | SHA-256 | 30 min, single use, 3 per hour, 5 wrong MFA codes burn it | `staff-password-reset.service.ts:78-97, 122-199` |
| MyHealth password reset | `randomToken()` | SHA-256 | 30 min, single use, 3 per hour, 5 wrong birth dates burn it | `portal-password-reset.service.ts:45-78, 131-182` |
| MyHealth activation code | `randomInt` over 31 symbols, 10 characters (about 49 bits) | SHA-256 of normalised code, unsalted | 72 h, 5 attempts | `activation-code.ts:18-30`, `portal-account.service.ts:169-175, 303-305` |
| Staff recovery codes | `randomInt`, about 49 bits, 10 codes | SHA-256 of `userId:code` | single use, no expiry | `second-factor.ts:8-23` |
| Portal recovery codes | same scheme | SHA-256 of account id and code | single use | `security/portal-security.rules.ts` (generate/hash), `portal-mfa.service.ts:192-204, 207-214` |
| Email verification code (portal) | `randomInt(0, 1_000_000)`, 6 digits | SHA-256 of `verificationId:code` | 15 min, 5 attempts; compared with `timingSafeEqual` | `portal-security.rules.ts:16-22`, `portal-email.service.ts:110-130` |
| Trusted-device token | `randomToken()` | SHA-256 | 30 days, 5 per account | `portal-trusted-device.service.ts:40-47` |
| Passkey challenge | `randomBytes(32)` | SHA-256 of the base64url challenge | 5 min, single use | `portal-passkey.service.ts:316-355` |
| TOTP | otplib, SHA-1, 6 digits, 30 s, window ±1 | secret AES-256-GCM | accepted time step stored so a code works once | `totp.ts:5, 34`, `mfa-store.ts:14-27` |

High-entropy tokens (256 bits) are appropriately stored as plain SHA-256. The lower-entropy codes are discussed in CRY-005.

Comparison style: reset and refresh tokens are looked up by hash equality in SQL (the attacker cannot influence a prefix of a secret through timing because only the hash is compared inside the database). `timingSafeEqual` is used for the email verification code (`portal-email.service.ts:114-116`, with a length check first) and for the payment webhook (`apps/api/src/app/adapters/paymongo-payment-gateway.ts:101`, after a strict 64-hex format check at 98, so a malformed signature cannot raise a length exception).

## 4. JWT

- Algorithm pinned on both signing and verifying (`tokens.ts:72-90`, `portal-tokens.ts:55-122`): `HS256`, issuer, audience, expiry, and `typ`. Algorithms other than HS256 are rejected, `none` included.
- Secret: `JWT_ACCESS_SECRET`, a string of at least 32 characters (`app-config.ts:53`). No entropy check, no `kid`, no rotation support (CRY-002).
- Access token lifetime 60 to 3600 s, default 900 s (`app-config.ts:54`).
- Refresh tokens are opaque, not JWTs.
- A forged token would still need an existing session id and matching user id, because the server re-reads the session on every request (`actor-resolver.ts:45-72`); this lowers the impact of a leaked signing secret but does not remove it.

## 5. Symmetric encryption and key management

- `crypto.ts`: AES-256-GCM, 12-byte random IV per message, 128-bit tag taken from `getAuthTag()` and checked in `final()`, keys must decode to 32 bytes (`crypto.ts:12-14, 96-115`).
- Formats: `v1.<iv>.<tag>.<ciphertext>` for small secrets (TOTP seeds) (`crypto.ts:20-30`), and `v2.<keyId>.<iv>.<tag>.<ciphertext>` with the header authenticated as additional data for the key ring (`crypto.ts:54-94`). A value cannot be relabelled with another key id.
- Key ring for integration payloads: `INTEGRATION_PAYLOAD_KEY` or `INTEGRATION_PAYLOAD_KEYS` with `INTEGRATION_PAYLOAD_KEY_ID`; required in production; must differ from `MFA_ENCRYPTION_KEY` (`app-config.ts:154-161, 198-254`; Terraform validation `variables.tf`, `mfa_encryption_key != integration_payload_key`). Rotation is supported without draining the queue; platform administrators see which key ids stored values still need (documented; runtime behaviour Not tested). Used by `integration-exchanges.service.ts:66`, `exchange-processor.ts:128`, `fhir-import.service.ts:127, 426`. Verified secure.
- Development fallback: outside production the integration key falls back to `MFA_ENCRYPTION_KEY` (`app-config.ts:245-252`); production throws.
- Keys are kept apart from the data they protect: the keys come from environment variables (Terraform marks them sensitive), ciphertext is in PostgreSQL. A database dump alone does not decrypt either; the application process holds both.
- TOTP key: single `MFA_ENCRYPTION_KEY`, no key id, no rotation path (CRY-003).

## 6. Webhook and integration signatures

PayMongo notifications: HMAC-SHA256 over `timestamp.rawBody` with the webhook secret, a configurable timestamp tolerance, `timingSafeEqual`, raw body preserved (`main.ts:30 rawBody: true`), the route is public but verifies before anything changes (`billing.controllers.ts:462-478`, `paymongo-payment-gateway.ts:83-102, 157-172`). Verified secure. Live behaviour against PayMongo test mode: Not tested (the source itself says it must be verified).

## 7. Transport security

- API: `helmet()` with defaults (includes `Strict-Transport-Security`), `x-powered-by` disabled, CORS restricted to `CORS_ORIGINS` (empty by default) with credentials, `trust proxy` only when `TRUST_PROXY` (`apps/api/src/app/configure-app.ts:18-21`). Swagger only outside production (`configure-app.ts:28`). TLS termination, minimum TLS version and certificate management are done by the Railway edge: **Not verified**.
- Staff and portal Next.js apps: `next.config.ts` sets no headers (`apps/staff/next.config.ts`, `apps/portal/next.config.ts`) and `proxy.ts` adds none. Searches for `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `frame-ancestors` in `apps`, `libs`, `docs`, `infrastructure` found no configuration (CRY-004).
- Cookies: token cookies are httpOnly; access cookie `SameSite=Lax`, refresh cookie `SameSite=Strict`; `secure` only when `NODE_ENV === "production"` (`libs/web-session/src/session.ts:36-46`, `apps/staff/src/lib/api/config.ts:36`, `apps/portal/src/lib/api/config.ts:39`). No `__Host-` prefix.
- Database, Redis, SMTP and object storage connections: the pool is built from `DATABASE_URL` alone (`libs/core/src/lib/database/database.module.ts:16`); TLS exists only if the URL asks for it. `REDIS_URL` default is `redis://`. Production values were not seen: **Not verified** (CRY-006).
- Internal hop from the web apps to the API uses `http://` over Railway's private network (`infrastructure/terraform/railway/main.tf`, `web_settings.API_BASE_URL`), carrying bearer tokens. Acceptable only if the private network is trusted (CRY-006).

## 8. Encryption at rest, files and integrity

- PostgreSQL: no application-level field encryption of PHI; only TOTP seeds and integration or import payloads are encrypted by the application. Disk encryption is a hosting property, **Not verified** (CRY-007).
- Object storage: uploads request `ServerSideEncryption: "AES256"` on the presigned PUT (`libs/documents/src/lib/object-storage.ts:61`); downloads are 5-minute presigned URLs issued after an authorization check and audited (`documents.service.ts:37, 433-460`). Bucket policy, public-access block and generated-document encryption: Not verified.
- Integrity: on completing an upload the server reads the object back, hashes it with SHA-256, compares with a declared checksum if one was given and scans it; mismatch or infection stops it (`documents.service.ts:249-282`). The declared checksum is optional. A later integrity review compares stored hashes (documented; not read in this audit).
- Audit and append-only data are protected by triggers and database grants, outside the scope of this file.

## 9. Randomness

All security tokens use `crypto.randomBytes` or `crypto.randomInt` (`crypto.ts:8-10`, `activation-code.ts`, `second-factor.ts`, `portal-security.rules.ts`, `portal-passkey.service.ts:320`). `git grep Math.random` over `apps`, `libs`, `tools` (excluding tests) returned no match. Test harnesses generate secrets with `randomBytes` (`apps/api/test/harness.ts:76-77`, `apps/e2e/playwright.config.ts:24-25`).

## 10. Secrets in source control

Commands used (read-only): `git ls-files` for env, key, tfstate and tfvars files; `git grep` for private-key headers, cloud and Slack tokens, live key patterns, and assignments of secret-named variables. Values are not reproduced.

| Check | Result |
| --- | --- |
| Tracked `.env` files | Only `.env.example` and `apps/mobile/.env.example` (tracked). A local `.env` exists in the working tree and is ignored (`.gitignore:29-30`, confirmed with `git check-ignore`). Its contents were not read. |
| Private key headers (RSA, EC, OpenSSH, PGP) | None tracked |
| AWS access keys, GitHub, Slack, Google API key patterns, `sk_live_` | None tracked |
| `sk_test_` pattern | One test fixture: `apps/api/test/billing-paymongo.int.spec.ts:7` (obviously fake, test only) |
| Terraform state and variables | `*.tfstate`, `*.tfvars`, `.terraform/` ignored (`infrastructure/terraform/railway/.gitignore:2-9`); only `terraform.tfvars.example` tracked. Terraform secrets are supplied at apply time and marked sensitive (`variables.tf`) |
| Placeholder secrets in `.env.example` | `JWT_ACCESS_SECRET` placeholder text (`.env.example:13`) and an `MFA_ENCRYPTION_KEY` that decodes to a printable counting string (`.env.example:17`); both satisfy the production validators (CRY-001). Dev `S3_SECRET_ACCESS_KEY` at `.env.example:42` |
| Dev credentials in compose and CI | `infrastructure/docker/docker-compose.yml:9` and `.github/workflows/ci.yml:39` (database password for local and CI services), `apps/api/test/harness.ts:23`, `apps/e2e/support/env.ts:10, 32-33` (test roles and passwords) |
| Seed passwords | `tools/db/seed-demo.ts:20` default demo password for every demo account (CRY-010); `tools/db/seed.ts` and `new-organization.ts` require or generate their own |
| Binary artifact | `apps/portal/public/downloads/myhealth.apk` (about 98 MB) is tracked (CRY-008) |

Not scanned: the git history before the current tree (a history scan for removed secrets was not run), `node_modules`, `.claude/worktrees`, `ui-redesign`, `ui-review`.

---

## 11. Findings

### CRY-001 — MEDIUM — Confirmed vulnerability (configuration) — Placeholder secrets from `.env.example` pass production validation

- Files: `.env.example:13, 17`; `libs/core/src/lib/config/app-config.ts:53, 56`; `infrastructure/terraform/railway/variables.tf` (validation `length(jwt_access_secret) >= 32`).
- Evidence: the sample JWT secret is longer than 32 characters and the sample MFA key is exactly 32 bytes in base64, so both are accepted when `NODE_ENV=production`. No check rejects known sample values or low-entropy secrets. `docs/deployment/railway.md` tells operators not to reuse the sample, which is a procedure, not a control.
- Exploitability: needs an operator to copy the sample into production. A forged JWT also needs a real session id and user id (server-side session check), so the signing-secret case is not an immediate bypass; the MFA key case lets anyone with read access to the database decrypt every TOTP seed.
- Impact: loss of TOTP confidentiality, weakened token integrity.
- Fix: in production, reject the exact sample values and any secret that is a repeated pattern or below a minimum entropy; require 32 random bytes for the JWT secret; same check in Terraform validation.
- Status: Open

### CRY-002 — MEDIUM — Incomplete implementation — No rotation for the JWT signing secret; one secret signs six token types

- Files: `tokens.ts:72-80`, `portal-tokens.ts:55-122`.
- Evidence: single `JWT_ACCESS_SECRET`, no `kid`, no previous-key verification. Staff access, MFA challenge, realtime, portal access, portal MFA challenge and portal realtime tokens differ only in audience and `typ`.
- Impact: rotating after a suspected leak signs everyone out at once (acceptable at 15 minutes), but there is no graceful path and a single leak compromises both realms until rotated.
- Fix: use separate secrets (or derived keys) for staff and portal realms and support a key id with an overlap window.
- Status: Open

### CRY-003 — MEDIUM — Incomplete implementation — TOTP secrets: no key rotation and no binding to the account

- Files: `libs/core/src/lib/security/crypto.ts:20-30`; callers `auth.service.ts:217, 231, 321`, `portal-mfa.service.ts:92, 112, 385`, `staff-password-reset.service.ts:174`; `app-config.ts:56`.
- Evidence: `encryptSecret` uses the `v1` format, which has no key id and no associated data. The documentation states that changing `MFA_ENCRYPTION_KEY` makes enrolled secrets unreadable. The ciphertext is not bound to the user or account row.
- Exploitability: rotation is impossible without re-enrolling every user. A party with database write access (already a severe position) could copy one account's ciphertext, for a secret they know, into another row to defeat MFA.
- Impact: key compromise cannot be remediated cleanly; limited tamper resistance.
- Fix: seal TOTP seeds with `sealWithKeyring` and the account id as additional data; add a re-encryption job.
- Status: Open

### CRY-004 — MEDIUM — Incomplete implementation — Staff and patient web apps set no security headers

- Files: `apps/staff/next.config.ts`, `apps/portal/next.config.ts`, `apps/staff/src/proxy.ts` (no headers); cookie flags `libs/web-session/src/session.ts:36-46`.
- Evidence: no HSTS, CSP, frame protection, `nosniff` or referrer policy is configured in the repository for the two apps that serve PHI to browsers; `helmet` covers only the JSON API. Whether Railway's edge adds any of them was not checked.
- Impact: clickjacking and downgrade exposure, and no CSP to limit the effect of any future injection.
- Fix: add a `headers()` block (HSTS with preload candidate after testing, CSP with nonces, `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`); use `__Host-` cookie names.
- Status: Open

### CRY-005 — LOW — Confirmed weakness — About 49-bit codes stored as fast unsalted or lightly salted SHA-256

- Files: `activation-code.ts:18-30`; `second-factor.ts:8-23`; `portal-security.rules.ts` (recovery hash); email code `portal-security.rules.ts:16-22`.
- Evidence: activation codes are `sha256(code)` with no salt; recovery codes are `sha256(userId:code)`. After a database leak, 2^49 candidates is within reach of a GPU cluster; the 6-digit email code falls instantly.
- Compensating controls: activation codes expire in 72 h and die after 5 failed attempts; recovery codes are single-use and need the password first; email codes live 15 minutes.
- Fix: use HMAC with a server-side key (or a slow hash) for recovery codes; lengthen to 80+ bits.
- Status: Open

### CRY-006 — LOW — Not verified — TLS to PostgreSQL, Redis, SMTP and the internal API hop is not enforced in code

- Files: `database.module.ts:16`; `app-config.ts` (`REDIS_URL` default `redis://`); `main.tf` `web_settings.API_BASE_URL` (`http://`).
- Evidence: transport encryption depends entirely on URLs supplied in production. Not seen.
- Fix: in production require `sslmode=require` (or `verify-full`) on `DATABASE_URL`, `rediss://` where offered, `smtps`/STARTTLS, and document that the private network is the control for the internal hop.
- Status: Open

### CRY-007 — LOW — Not verified — Encryption at rest and field-level protection rely on the hosting platform

- Evidence: only TOTP seeds and integration or FHIR-import payloads are encrypted by the application. Disk encryption for Railway PostgreSQL and Redis, bucket default encryption and public access settings were not inspected. Uploaded objects request `AES256` (`object-storage.ts:61`); generated documents were not traced to confirm the same.
- Fix: record the provider's encryption guarantees in the deployment documentation, set bucket-level default encryption, consider column encryption for the most sensitive history fields.
- Status: Open

### CRY-008 — LOW — Not verified — Android package committed to the repository and served from the portal

- Files: `apps/portal/public/downloads/myhealth.apk` (tracked since commit `92ae6141`); `apps/portal/public/downloads/README.md`.
- Evidence: CLAUDE.md states that `pnpm mobile:apk` signs with the Android debug key unless a cloud build is chosen. The signing certificate of the committed file was not inspected, and the file was not opened.
- Impact: a debug-signed APK distributed to patients cannot be trusted to come from the clinic and any party can re-sign a modified build with the same key.
- Fix: build release APKs with a protected upload key, keep binaries out of git, publish a SHA-256 digest.
- Status: Open

### CRY-009 — LOW — Hardening — Password hash parameters at the OWASP floor, no rehash or pepper

- File: `password.ts:111-116`.
- Fix: raise memory to 46 MiB (t=1) or similar, add `needsRehash` on successful login, optionally a pepper held in the secret manager.
- Status: Open

### CRY-010 — LOW — Confirmed — Known default password in the demo seed

- File: `tools/db/seed-demo.ts:20` (`DEMO_PASSWORD` default), `:173` (creates staff accounts with it through `POST /users`, which does not force a change, see AUTH-006).
- Evidence: nothing stops the script from being pointed at a non-local `API_BASE_URL`.
- Fix: refuse non-local targets unless explicitly forced, generate a random password when none is given.
- Status: Open

### CRY-011 — INFO — Dev and test credentials are present by design

- Files: `infrastructure/docker/docker-compose.yml:9`, `.github/workflows/ci.yml:39`, `apps/api/test/harness.ts:23`, `apps/e2e/support/env.ts:10, 32-33`, `.env.example:42`, `apps/api/test/billing-paymongo.int.spec.ts:7`.
- No action beyond making sure they never reach a hosted environment.
- Status: Open

### CRY-012 — INFO — History not scanned

A scan of removed content in git history was not run. Recommend running a secret scanner over history before release.
- Status: Open

### CRY-013 — INFO — Items verified as secure (no finding)

Argon2id with per-hash salt; 256-bit random reset, refresh, session and device tokens stored as hashes; single-use and expiring tokens; AES-256-GCM with random IV and tag verification; key-id header authenticated as AAD; integration key separate from the MFA key enforced in production; HS256 pinned with issuer, audience and type; HMAC webhook verification with timestamp tolerance and `timingSafeEqual`; presigned download URLs of 5 minutes with audit; SHA-256 recomputed by the server on upload; no `Math.random` for security; no private keys, cloud tokens or live provider keys tracked.
