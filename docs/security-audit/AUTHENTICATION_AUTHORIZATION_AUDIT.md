# Authentication and Authorization Audit (Stage A, read-only)

Scope: `libs/auth`, the patient portal authentication in `libs/patient` (portal, security, proxy), the global `AccessGuard`, RBAC, row-level security, and a sample of id-scoped routes in clinic, laboratory, billing, documents, prescription, care plan and portal.

Method: static code review only. No application was started, no integration test was run, no request was sent. Anything that needs a running system is marked **Not tested**. Line numbers refer to the working tree on branch `release/v1.0.0` at audit time.

Status vocabulary: Verified secure / Tested no issue (none: nothing was executed) / Not tested / Incomplete implementation / Confirmed vulnerability (confirmed by reading the code path).

---

## 1. Summary

| Area                                                            | Result                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| JWT validation (algorithm, issuer, audience, type)              | Verified secure                                                        |
| Staff and portal session handling, refresh rotation, revocation | Verified secure, with two minor limits (AUTH-008, AUTH-009)            |
| Password hashing and policy                                     | Verified secure (see the cryptography audit)                           |
| Lockout and brute force                                         | Verified present; lockout can be used against a victim (AUTH-007)      |
| Staff MFA / portal MFA / passkeys / trusted devices             | Verified secure in design; staff MFA is optional by default (AUTH-005) |
| Guardian access (`X-Acting-For`)                                | Verified secure                                                        |
| Cross-tenant isolation in the application queries               | Verified secure on every sampled route                                 |
| Cross-tenant isolation in the database (RLS)                    | Incomplete implementation by default (AUTH-004)                        |
| Role and user management                                        | Confirmed vulnerabilities (AUTH-001, AUTH-002)                         |
| Facility scoping of reads                                       | Incomplete implementation (AUTH-003)                                   |

Findings: 1 HIGH, 4 MEDIUM, 7 LOW, 3 INFO. No CRITICAL finding.

---

## 2. Staff authentication (`libs/auth`)

### 2.1 JWT creation and validation — Verified secure

- Tokens are signed `HS256` with `JWT_ACCESS_SECRET`, with issuer `healthcare-platform` and audience `healthcare-api`, and an `expiresIn` (`libs/auth/src/lib/tokens.ts:5-6, 72-80`).
- Verification pins `algorithms: ["HS256"]` (no `none`, no algorithm confusion), checks issuer and audience, then checks the `typ` claim against the expected type (`tokens.ts:82-96`). Access (`access`), MFA challenge (`mfa_challenge`, 300 s) and realtime ticket (`realtime`, 60 s) tokens cannot be used for one another.
- Portal tokens use the audience `healthcare-portal` and their own `typ` values (`libs/patient/src/lib/portal/portal-tokens.ts:10, 55-123`). A staff token cannot authenticate a portal route and the reverse, because `AccessGuard` verifies the staff audience and `PatientAccessGuard` the portal one.
- Access token lifetime: default 900 s, bounded 60-3600 s (`libs/core/src/lib/config/app-config.ts:54`).
- Observation: all token families (staff access, MFA challenge, realtime, portal access, portal MFA challenge, portal realtime) share one secret and are separated only by audience and `typ`. See CRY-002 in the cryptography audit for the rotation implication.

### 2.2 Per-request session check — Verified secure

`ActorResolver.fromSession` (`actor-resolver.ts:45-72`) re-reads, on every request: the session (not revoked, not expired, `userId` and `organizationId` equal to the claims), the user (`status = active`), the active membership of an active organization, and the effective permissions. Logout, suspension, password change and membership changes therefore take effect immediately, not at access-token expiry.

### 2.3 Login, lockout, brute force

- Unknown email: a dummy Argon2 verification is run to equalise timing and the same `invalid_credentials` error is returned (`auth.service.ts:54-64`, `password.ts:130-134`).
- Lockout: 5 failures lock the account for 15 minutes (`auth.service.ts:32-33, 381-405`). The counter is incremented atomically in SQL. Wrong MFA codes count toward the same counter (`auth.service.ts:120-123`).
- Disabled accounts reveal their state only after a correct password (`auth.service.ts:77-90`).
- Credential routes carry `@Throttle` 10 requests per minute per client (`auth.controller.ts:35, 58-107`), with the counters in Redis (`app.module.ts:185-189`), and `TRUST_PROXY` is set by Terraform (`infrastructure/terraform/railway/main.tf:45`). Runtime behaviour: **Not tested**.
- Limit: see AUTH-007 (lockout used as a denial of service).

### 2.4 Refresh rotation and reuse detection — Verified secure, one limit

- Refresh tokens are 32 random bytes; only the SHA-256 is stored (`session.service.ts:344-359`).
- `rotate` locks the row (`FOR UPDATE`), replaces the hash and keeps the previous hash; presenting the previous hash revokes the whole session with reason `refresh_token_reuse` and the revocation is committed before the error is raised (`session.service.ts:369-391`, `auth.service.ts:135-149`).
- Limit: only the immediately previous token is remembered (AUTH-009).
- Refresh re-checks the user and membership and revokes the session if access ended (`auth.service.ts:152-157`).

### 2.5 Password change, reset and temporary passwords

- Change: needs the current password, screens the new one against breached passwords, ends the other sessions (`auth.service.ts:170-207`).
- Self-service reset (`staff-password-reset.service.ts`): same answer whether or not the account exists (65-76), at most 3 links per hour with a row lock (80-87), 30-minute single-use link with only the token hash stored (78, 96, 122-165), a current TOTP or recovery code is required when MFA is on, with 5 wrong codes burning the link (171-181), all sessions revoked and the lockout cleared (182-199), notice mailed (230-233). Verified secure.
- Administrator temporary password (`users.service.ts:248-275`): sessions revoked, `passwordChangeRequired = true`, and the guard refuses everything except account routes until it is replaced (`access.guard.ts:204-211`). The design problem is in who may do it (AUTH-001).
- Email verification for staff: none. The reset link goes to the address an administrator typed. **Incomplete implementation** (INFO, AUTH-013).

### 2.6 Staff MFA — Verified secure in design

- TOTP secret encrypted at rest with AES-256-GCM (`auth.service.ts:217, 321`); confirmation required before it is enabled (`auth.service.ts:225-248`).
- A code works once: the last accepted time step is stored and steps at or before it are refused, inside a transaction with the user row locked (`mfa-store.ts:14-27`, `auth.service.ts:119, 312-316`).
- 10 single-use recovery codes, about 49 bits each, stored hashed and bound to the user id (`second-factor.ts:8-23`, `mfa-store.ts:29-40`). Disabling and renewal need the password plus a current code (`auth.service.ts:251-309`).
- The organization can require MFA; a member without it is limited to enrolment routes (`access.guard.ts:206-211`, `actor-resolver.ts:58`).
- Gap: it is off by default and not required for privileged accounts (AUTH-005).

---

## 3. Patient portal authentication (`libs/patient`)

### 3.1 Guard and principal — Verified secure

- Portal routes are `@Public()` for the staff guard and protected by `PatientAccessGuard`. The portal controllers were checked one by one: every portal controller class declares `@UseGuards(PatientAccessGuard)` except `portal.controller.ts` (guard on individual routes 93, 103, 113) and `portal-security.controller.ts` (class-level guard, with explicit `@Public()` only on the sign-in second-step routes at 216-234). The only intentionally unauthenticated portal routes are activation, activation-card, login, refresh, password reset and the MFA second step (`portal.controller.ts:34-91`).
- `principalFor` joins session and account on organization, requires the session to be non-revoked and unexpired, the account `active`, organization and patient equal to the claims, and a current `portal_access` consent (`portal-account.service.ts:569-600`). Consent withdrawal and account disabling take effect on the next request.
- Patient identity always comes from the principal, never from a request parameter. On the sampled routes the queries add `organizationId` and `filedAsPatient(…, principal.patientId)` (section 7).

### 3.2 Activation, login, refresh — Verified secure, minor limits

- Activation: organization code, patient number, date of birth and a one-time code (about 49 bits, SHA-256 stored, 72 h, 5 attempts) (`portal-account.service.ts:247-360`, `activation-code.ts:18-30`). The patient always receives the same message (`portal-account.service.ts:87, 272, 301`); the specific reason is only in the audit trail and staff view. Concurrent activations are guarded by `status = invited` in the UPDATE (333-350). Limits: AUTH-007, AUTH-008.
- Login: dummy verification for unknown accounts, lockout check before the password check, shared `MAX_FAILED_LOGINS`/`LOCKOUT_MINUTES` with staff, consent re-check (`portal-account.service.ts:362-431`).
- Refresh: same rotate-and-detect-reuse design as staff, revocation committed before rejecting, account and consent re-checked (`portal-account.service.ts:481-528`).
- Sensitive changes re-ask the password (`confirmPassword`, 464-474) and failures count toward the lockout.

### 3.3 Portal MFA, passkeys, trusted devices — Verified secure

- TOTP with single-use steps, recovery codes, wrong codes counted toward the lockout, account row locked during the check, the session opened in the same transaction as the spent code (`security/portal-mfa.service.ts:192-262, 336-390`).
- Disabling MFA, clinic reset and exemptions revoke devices, passkeys and recovery codes, and notify the patient by email (`portal-mfa.service.ts:149-243`).
- Passkeys (second step only): relying party taken from `PORTAL_BASE_URL`, `requireUserVerification: true`, 32-byte random challenges stored hashed and single-use, counter rollback refused and audited (`portal-passkey.service.ts:136-146, 240-262, 316-355`).
- Trusted browsers: random 32-byte token, hash stored, 30 days, limit 5, revoked when MFA ends or sessions end, and a device only replaces the code, never the password (`portal-trusted-device.service.ts:31-77`, `portal-account.service.ts:406-412`).
- Password reset (`portal-password-reset.service.ts`): single-use 30-minute link, hourly limit, date of birth as additional knowledge, 5 wrong birth dates burn the link, all sessions and devices revoked. See AUTH-011 for the residual risk.

### 3.4 Guardian access (`X-Acting-For`) — Verified secure

- Only routes marked `@ProxyAllowed()` accept the header; others answer `proxy_not_allowed` (`patient-access.guard.ts:73-76`, file-relative).
- `actingFor` requires a grant for the same organization, the guardian's own patient id and the dependent id, not revoked and not expired, an active dependent, and the dependent's portal consent; `view` scope for reads, `act` for anything that is not GET/HEAD/OPTIONS (`proxy/proxy.service.ts:44-75`, `proxy.rules.ts:23-34`). The grant id is recorded in the audit context (`portal-account.service.ts:791-799`).
- Everything about the guardian's own sign-in, devices and consents stays unreachable unless a route opts in.

---

## 4. RBAC model and enforcement

- Permissions are a closed catalog in `libs/core` (`PERMISSIONS`), seeded by migrations; built-in roles are system rows. `org_admin` receives every permission (`database/migrations/0004_auth.sql:122-130`).
- Grants are `role_assignment(user, role, facility?, department?)`. A grant applies when its facility and department equal the request context (`access.service.ts:259-267`); an organization-wide grant applies everywhere. `AccessService.grantsFor` ignores another organization's custom roles (`access.service.ts:284-303`).
- `AccessGuard` (`access.guard.ts:178-236`): authentication by default, Bearer token, session and membership check, facility and department existence and status check (`actor-resolver.ts:74-89`), permission list check, platform administrator check, denials audited as `access.deny`.
- Route inventory (script over `*.controller.ts` in `libs` and `apps/api/src`, 572 handlers): 25 handlers carry no permission and are not public. All 25 are self-service (own session, MFA, password, notifications, push devices, tour, badges) or the CRM opt-out link with its own single-use token; none exposes tenant data without scoping. 130 handlers are `@Public()`; these are the portal controllers guarded by `PatientAccessGuard` (checked in 3.1), the staff credential routes, the payment provider notification (signature checked, see the cryptography audit) and health probes. Per-route permission naming was not audited for correctness beyond the sampled routes.
- Facility header: `X-Facility-Id` is optional unless `@RequireFacility()`. Without it only organization-wide grants apply. The header cannot add permissions, because permissions come from grants, but see AUTH-003 for data scope.

---

## 5. Privilege escalation analysis

Code reviewed: `users.service.ts`, `users.controller.ts`, `users.dto.ts`.

What works as intended:

- `createRole` and `updateRole` apply `assertCanDelegate` to the permissions being added or removed, so a role editor cannot create or enlarge a role beyond their own permissions (`users.service.ts:403-404, 442-453, 482-494`). Built-in roles are immutable (448). Stale edits are refused by `version` (455-457). Attempts are audited as `privilege_escalation` (485-491).
- `grantRole` applies the same check to the role being assigned (308-309).
- A user cannot change their own membership status or reset their own password through the admin routes (223, 283).

What does not (see findings): the delegation check compares permission names only, in the current request context, and not the scope of the grant or the rank of the target account.

---

## 6. Row-level security (migration 0111, `ContextPool`)

- Design: every table with an `organization_id` gets an `organization_isolation` policy via `apply_rls_policies()` (`database/migrations/0111*.sql`, lines 1-60). A connection is stamped with `app.organization_id` and `app.scope` before each use (`libs/core/src/lib/database/database-context.ts:88, 95-129`). The guards set the organization from the resolved actor (`access.guard.ts:203`, `patient-access.guard.ts` after principal resolution). Work across organizations declares `asPlatform(reason, …)`; public routes that must read before the organization is known declare `@PlatformScope`.
- `observe` mode (the default, `app-config.ts:51`): a query with no context runs with `scope = 'all'`, i.e. no isolation at all, and is only logged once per call site as `db.context_missing` (`database-context.ts:72-74, 131-150`). `enforce` refuses such queries. `off` removes the organization rule entirely.
- Policies are not `FORCE`d and nothing checks the connecting role. The migration comment states the owner is exempt, and the code has no start-up assertion that `DATABASE_URL` is the restricted role (searched `FORCE ROW LEVEL`, `rolbypassrls`, `rolsuper`: no match). The Terraform module makes the restricted role optional (`variables.tf`, `app_database_url = optional(string)`; `main.tf:48`) and does not set `DATABASE_RLS_MODE`.
- Consequence: in a deployment that follows the defaults, RLS is either inactive (owner role) or in `observe`. Isolation then rests on the application's `organization_id` predicates. Those predicates were correct on every sampled route (section 7), so no cross-tenant read was found; the second line of defence is simply not active. See AUTH-004.
- Not tested: whether the policies behave correctly under `enforce` (this needs a database; the integration tests that cover it were not run by instruction).

---

## 7. IDOR / BOLA / BFLA sample (32 routes, static review)

"Org" means the query filters on `actor.organizationId`. "Facility" means the service compares the record's facility with the request facility.

| #   | Route                                   | Evidence                                                                                                       | Org | Facility            | Result                                                                                                           |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | GET /encounters/:id                     | `clinic/encounters/encounter.service.ts:151-153`                                                               | yes | no                  | Secure across tenants; AUTH-003                                                                                  |
| 2   | GET /encounters/:id/history             | `encounter.service.ts:182-185`                                                                                 | yes | no                  | same                                                                                                             |
| 3   | GET /patients/:id/encounters            | `encounter.service.ts:205` (`filedAsPatient`)                                                                  | yes | no                  | same                                                                                                             |
| 4   | POST /encounters (start)                | `encounter.service.ts:31-35`                                                                                   | yes | yes (visit)         | Secure                                                                                                           |
| 5   | POST /encounters/:id/sign               | `encounter.service.ts:238-250` (lock by org, responsible practitioner only)                                    | yes | no                  | Secure                                                                                                           |
| 6   | POST /encounters/:id/amend              | `encounter.service.ts:296-300`                                                                                 | yes | no                  | Secure                                                                                                           |
| 7   | GET /prescriptions/:id                  | `prescription.service.ts:157-166`                                                                              | yes | no                  | AUTH-003                                                                                                         |
| 8   | GET /billing/invoices/:id               | `billing/invoices/invoice.service.ts:456-468`                                                                  | yes | no                  | AUTH-003                                                                                                         |
| 9   | POST invoice discount/issue/void        | `invoice.service.ts:709-718`                                                                                   | yes | only if header sent | Secure for scoped users (a scoped grant needs the header)                                                        |
| 10  | GET credit note                         | `credit-notes/credit-note.service.ts:207`                                                                      | yes | if header sent      | Secure                                                                                                           |
| 11  | GET debit note                          | `debit-note.service.ts:118`                                                                                    | yes | if header sent      | Secure                                                                                                           |
| 12  | GET billing worklist / charges          | `charge.service.ts:290-327`                                                                                    | yes | yes                 | Secure                                                                                                           |
| 13  | PATCH billing service                   | `billing-catalog.service.ts:120-136`                                                                           | yes | n/a (catalog)       | Secure                                                                                                           |
| 14  | POST lab results verify / approve       | `laboratory/results/lab-result.service.ts:481-485`, `assertFacility` 704                                       | yes | yes                 | Secure; separation of duties in `signOffDecision` (498-503)                                                      |
| 15  | POST lab results release / releaseOrder | `lab-result.service.ts:149-175`                                                                                | yes | yes                 | Secure                                                                                                           |
| 16  | POST lab results correct                | `lab-result.service.ts:187-193`; permission checked in service (193-195)                                       | yes | yes                 | Secure                                                                                                           |
| 17  | POST lab results cancel                 | `lab-result.service.ts:216-220`                                                                                | yes | yes                 | Secure                                                                                                           |
| 18  | POST order-items/:id/results (enter)    | `lab-result.service.ts:103-106`                                                                                | yes | yes                 | Secure                                                                                                           |
| 19  | GET lab worklist                        | `lab-worklist.service.ts:40-139`                                                                               | yes | yes                 | Secure                                                                                                           |
| 20  | POST critical-results/:id/acknowledge   | `lab-result.service.ts:445-475`; controller permission `lab.result.read` (`laboratory.controllers.ts:426-428`) | yes | no                  | AUTH-012                                                                                                         |
| 21  | GET documents/:id and download-url      | `documents/documents.service.ts:369, 433-460, 605-610`                                                         | yes | no                  | Secure across tenants; domain-managed documents excluded by `managedBy` scope; coarse `document.read` (AUTH-003) |
| 22  | PATCH coding-systems/:id                | `clinic/config/clinic-config.service.ts:173-187`                                                               | yes | n/a                 | Secure                                                                                                           |
| 23  | care plan goal and activity updates     | `care-plan/care-plan.service.ts:318-340, 380-399` (plan locked by org)                                         | yes | n/a                 | Secure                                                                                                           |
| 24  | POST users/:id/role-assignments         | `users.service.ts:307-344`                                                                                     | yes | no                  | AUTH-002                                                                                                         |
| 25  | DELETE users/:id/role-assignments/:aid  | `users.service.ts:346-370`                                                                                     | yes | no                  | AUTH-001                                                                                                         |
| 26  | POST users/:id/password-reset           | `users.service.ts:248-305`                                                                                     | yes | no                  | AUTH-001                                                                                                         |
| 27  | PATCH users/:id/membership              | `users.service.ts:222-241`                                                                                     | yes | no                  | AUTH-001                                                                                                         |
| 28  | PUT roles/:id                           | `users.service.ts:442-480`                                                                                     | yes | no                  | Secure (delegation checked)                                                                                      |
| 29  | GET portal results report.pdf           | `lab-report.ts:131-141` (org, order id, `filedAsPatient`, visible results only)                                | yes | n/a                 | Secure                                                                                                           |
| 30  | GET portal certificates/:id/link        | `clinic/certificates/medical-certificate.service.ts:215-229`                                                   | yes | n/a                 | Secure                                                                                                           |
| 31  | GET portal referrals/:id/link           | `clinic/referrals/referral.service.ts:420-432`                                                                 | yes | n/a                 | Secure                                                                                                           |
| 32  | GET portal message attachment link      | `patient/messaging/patient-message.service.ts:238-247` (thread must be the patient's)                          | yes | n/a                 | Secure                                                                                                           |

Also checked: staff invite/disable portal account (`portal-account.service.ts:154-166, 203-210`, org + patient existence) and staff message attachment link (`patient-message.service.ts:362-371`).

Cross-tenant: on all 32 routes the record is selected with the organization from the authenticated actor or principal, never from the request. Foreign ids return 404 (`NotFoundError`). Updates by bare id (for example `where(eq(codingSystem.id, id))`) follow a locked, organization-scoped select in the same transaction in the cases opened (`clinic-config.service.ts:173-187`, `billing-catalog.service.ts:120-136`, `care-plan.service.ts:318-340`); 258 single-condition `where(eq(x.id, …))` matches exist repository-wide and were not each opened (Not tested beyond those).

Not sampled / Not tested: dental, telemedicine, inventory, CRM, FHIR `/fhir/r4`, reporting export routes, realtime namespace authorization at runtime, `GET /patients/:id` service body, `POST /payments/:id/refund`.

---

## 8. Findings

### AUTH-001 — HIGH — Confirmed vulnerability — `user.manage` has no containment: it can take over or lock out higher-privileged accounts

- Files: `libs/auth/src/lib/users.service.ts:222-241` (suspend), `248-305` (temporary password), `346-370` (revoke role); `users.controller.ts:32-65`.
- Evidence: none of these methods compares the target account's permissions or roles with the actor's. `resetPassword` only refuses the actor themselves, platform administrators and accounts shared with other organizations (283-303). `revokeRole` and `updateMembership` have no rank check and no "last administrator" guard. The temporary password is chosen by the administrator, who can therefore sign in with it, pass the forced password change (`access.guard.ts:204-211` allows the account routes), choose a password of their own and now holds the victim's session and permissions.
- Exploitability: needs `user.manage` (built in only for `org_admin`, but any organization role containing it can be created by a role editor, `users.service.ts:403-424`). A delegated "user administrator" with few other permissions resets an `org_admin` who has no MFA (MFA is optional, AUTH-005). If the target has MFA the attacker still gets the password but not the account.
- Impact: vertical privilege escalation to any non-MFA, non-shared account in the organization, including the full administrator; audit attributes later actions to the victim after the password change. Revoking or suspending the only administrators locks the organization out.
- Fix: refuse reset, suspend and role revocation of an account whose effective permissions are not a subset of the actor's (reuse `assertCanDelegate` on the target's permissions); refuse removing the last `org_admin` / last holder of `user.manage`; prefer an emailed reset link over an administrator-known password, or require the target's MFA reset flow; alert the target by email on any administrator reset.
- Status: Open

### AUTH-002 — MEDIUM — Confirmed vulnerability — Role grants ignore the scope of the grant and allow self-grant

- Files: `users.service.ts:307-344`, `482-494`, `users.dto.ts:20-30`.
- Evidence: `assertCanDelegate` tests `actor.permissions`, which is the permission set for the current request context only (facility and department chosen by `X-Facility-Id`). `grantRole` takes `facilityId`/`departmentId` from the body (optional) and does not compare them with the scope of the actor's own grant, and does not refuse `userId === actor.userId`.
- Exploitability: an actor whose `user.manage` comes from a facility-scoped assignment sends `X-Facility-Id: A`, then assigns a role whose permissions they hold at A with `facilityId` omitted, which makes it organization-wide, or with another facility id. They can do it for themselves.
- Impact: facility-scoped administrators widen their own or others' permissions to the whole organization or to other facilities (horizontal and scope escalation). Requires the unusual setup of a facility-scoped `user.manage`.
- Fix: require that the new assignment's scope is contained in a scope where the actor holds each permission (resolve the actor's grants with `AccessService.grantsFor` and apply `grantApplies` for the target facility/department); refuse self-grant; same containment for `revokeRole`.
- Status: Open

### AUTH-003 — MEDIUM — Incomplete implementation — Facility scoping protects writes but not reads or the patient master

- Files: `encounter.service.ts:151-153, 182-185, 205`; `prescription.service.ts:157-166`; `invoice.service.ts:456-468`; `documents.service.ts:369, 433-460`; `lab-result.service.ts:445-475`; `patient.controller.ts:59-62`.
- Evidence: id-scoped reads are filtered by organization only. Writes in laboratory and billing compare the record's facility with `X-Facility-Id` (lab `assertFacility`, billing `lock`, and the billing credit/debit note reads when a header is sent), but reads do not. `patient.read` exposes every patient of the organization regardless of where they were seen. `document.read` opens every generic document of every patient in the organization with no category restriction.
- Exploitability: a user whose permissions come from a facility-scoped role calls the API with their facility header and a record id from another facility (ids are returned by the organization-wide patient timeline and list calls). Identifier guessing is not realistic; the access follows from legitimate listing endpoints.
- Impact: a role "at facility A" can read clinical, billing and document data of facility B within the same tenant, which weakens the minimum-necessary principle of the Data Privacy Act. Reads are audited (`encounter.view`, `prescription.view`, `billing.invoice.view`, `document.download`), which limits detection time but not exposure. Cross-tenant impact: none.
- Fix: decide the intended semantics and state them in `docs/security/access-control.md`; if facility roles must limit data, add a facility predicate to the read queries (or a care-relationship or break-glass rule for patients seen elsewhere) and category-level document permissions.
- Status: Open

### AUTH-004 — MEDIUM — Incomplete implementation — Row-level security is inactive or in observe mode in the default production configuration

- Files: `libs/core/src/lib/config/app-config.ts:51`; `database-context.ts:65-75, 131-150`; `database/migrations/0111*.sql`; `infrastructure/terraform/railway/main.tf:20-48`, `variables.tf` (`app_database_url = optional`).
- Evidence: default `DATABASE_RLS_MODE=observe` gives a context-less query `scope = 'all'`. Policies are enabled but not forced, so the table owner bypasses them. Terraform uses the owner for the API and workers unless `app_database_url` is supplied, and never sets `DATABASE_RLS_MODE`. No start-up check reports when the application runs as the owner or a superuser.
- Exploitability: not directly exploitable; it removes the safety net behind any future missing `organization_id` filter.
- Impact: a single forgotten predicate becomes a cross-tenant read or write that the database would otherwise stop.
- Fix: make the restricted role mandatory in the Terraform module; assert at start-up that the connected role is neither superuser nor owner nor `BYPASSRLS` when `NODE_ENV=production`; set `DATABASE_RLS_MODE=enforce` after the 30-day observation period documented in CLAUDE.md and alert on `db.context_missing`; consider `FORCE ROW LEVEL SECURITY` for the owner path used by the app if feasible.
- Status: Open

### AUTH-005 — MEDIUM — Incomplete implementation — Staff MFA is optional by default, including for privileged and platform accounts

- Files: `access.guard.ts:206-211`, `actor-resolver.ts:58`, `auth.service.ts:94-105, 209-248`.
- Evidence: MFA is enforced only if an organization turns on the policy; there is no built-in requirement for `org_admin`, `user.manage`, `isPlatformAdmin` or billing/refund roles. Starting enrolment (`mfa/setup`, `mfa/confirm`) needs no password re-entry, though disabling does.
- Exploitability: a phished or reused staff password is enough to sign in.
- Impact: this is what makes AUTH-001 exploitable and exposes PHI on single-factor staff accounts.
- Fix: require MFA by default for platform administrators and any account holding administrative permissions; ask for the password at enrolment start.
- Status: Open

### AUTH-006 — LOW — Confirmed vulnerability — Accounts created with an administrator-chosen password are not forced to change it

- Files: `users.service.ts:183-214` (insert at 195); `auth.schema.ts:20` (default `false`); migration `0090`.
- Evidence: `create` stores the supplied `initialPassword` without setting `passwordChangeRequired`, unlike `resetPassword` (255).
- Impact: the creating administrator keeps knowing a working credential for another person, which weakens audit attribution.
- Fix: set `passwordChangeRequired = true` on creation, or invite by emailed link.
- Status: Open

### AUTH-007 — LOW — Confirmed vulnerability — Lockout and invitation burn can be triggered by third parties

- Files: staff `auth.service.ts:67-80, 381-405`; portal `portal-account.service.ts:381-395, 714-742`; activation `portal-account.service.ts:275-289`.
- Evidence: the lockout check precedes the password check and is keyed by the account, so anyone who knows an email address can lock it for 15 minutes with 5 bad attempts; the throttle is per client address only. Five wrong activation attempts destroy a patient's invitation (`exhausted`, 279-287) and need only the organization code and a patient number.
- Impact: denial of service against a named staff member, a patient, or a clinic's onboarding. No data exposure.
- Fix: combine lockout with progressive delay per account and client, notify the user of lockouts, and let activation attempts be rate-limited per client address rather than destroying the invitation.
- Status: Open

### AUTH-008 — LOW — Confirmed vulnerability — Activation attempt counter is a stale read-modify-write

- File: `portal-account.service.ts:275-289`.
- Evidence: `attempts = account.failedAttempts + 1` is computed from the row read at the start of the request and written back with `SET failedAttempts = attempts`, not `failedAttempts + 1`. Concurrent wrong guesses read the same value and are counted once. Compare the atomic increment used for logins (`recordFailedLogin`, 719-727).
- Exploitability: limited by the 10-per-minute throttle per client, the 49-bit code and the date-of-birth check that comes first; not practical today.
- Fix: increment in SQL (`failed_attempts = failed_attempts + 1 RETURNING`) and decide exhaustion from the returned value.
- Status: Open

### AUTH-009 — LOW — Incomplete implementation — Session lifetime and replay windows

- Files: `session.service.ts:384-388`; `portal-account.service.ts:486-491`; `tokens.ts:7-9`; `portal-tokens.ts:41-42`; `app-config.ts:55`.
- Evidence: (a) reuse detection recognises only the previous refresh token, so a token rotated twice ago is rejected without revoking the session; (b) sessions have an absolute lifetime of 14 days by default and no server-side inactivity timeout (the staff idle sign-out is in the browser); (c) MFA challenge tokens (300 s) and realtime tickets (60 s) are signed JWTs with no single-use record; the second-step code itself is single use.
- Impact: a stolen refresh token stays useful for up to 14 days if it is used before the owner refreshes again; replays of challenge tokens need a valid second-step code anyway.
- Fix: keep a short chain of previous hashes or a token family id, add an idle timeout, optionally record challenge `jti`s.
- Status: Open

### AUTH-010 — LOW — Incomplete implementation — Realtime socket session expiry not verified

- Files: `apps/api/src/app/realtime/realtime.gateway.ts:64-123`.
- Evidence: connection resolves the ticket through the same `fromSession` checks, but this audit did not establish whether an already connected socket is closed when the session is revoked later (documentation says so). Not tested.
- Fix: confirm by test, close sockets on `auth.session.revoke`.
- Status: Open

### AUTH-011 — LOW — Confirmed vulnerability — MyHealth password reset relies on an unverified email and a guessable second item

- Files: `portal-account.service.ts:336` (email set at activation without verification), `portal-password-reset.service.ts:87-202` (date of birth is the only extra proof, no MFA code).
- Evidence: the reset link goes to the sign-in email entered at activation; the date of birth is the additional knowledge check, with 5 attempts per link and 3 links per hour. Staff reset, by contrast, requires a current MFA code for accounts with MFA (`staff-password-reset.service.ts:171-181`). A reset does not remove portal MFA, so MFA-protected accounts still need the second step at sign-in.
- Exploitability: a patient who mistyped their email at activation, and a stranger who owns that mistyped address and knows the patient's birth date.
- Fix: verify the email before it can receive reset links, or require a current second step for accounts that have one.
- Status: Open

### AUTH-012 — LOW — Confirmed vulnerability — Any `lab.result.read` holder at any facility can acknowledge a critical result

- Files: `lab-result.service.ts:445-475`; `laboratory.controllers.ts:426-428`.
- Evidence: acknowledgement checks only the alert's state, not the facility, the ordering clinician or the care team.
- Impact: a critical value can be acknowledged by someone who is not responsible for the patient, ending the escalation.
- Fix: bind acknowledgement to the ordering practitioner or a permission such as `lab.critical.acknowledge` at the alert's facility.
- Status: Open

### AUTH-013 — INFO — Staff accounts are global and enumerable by administrators

- Files: `users.service.ts:183-214`.
- Evidence: adding an email that already exists on the platform adds that person as a member of the administrator's organization; a new email without `initialPassword` returns `initial_password_required`, so an administrator can learn which addresses exist on the platform. Staff email addresses are never verified.
- Fix: invite-by-link flow with verification; uniform error.
- Status: Open

### AUTH-014 — INFO — Clinic reset of a patient's MyHealth MFA has no second approval

- File: `portal-mfa.service.ts:65-86`.
- Evidence: one staff member with `patient.portal.manage` can switch MFA off after "checking identity"; sessions end, the patient is emailed, and it is audited.
- Fix: optional four-eyes approval or cooling-off notice; document the identity check in the procedure.
- Status: Open

### AUTH-015 — INFO — Items verified as secure (no finding)

JWT algorithm pinning, issuer, audience and type separation; per-request session, user and membership checks; atomic lockout counter; reset and activation single-use tokens stored as hashes; recovery codes stored as hashes; single-use TOTP steps with row lock; passkey counter and origin checks; proxy grant scope by HTTP method; webhook signature check; organization predicate on all 32 sampled routes.
