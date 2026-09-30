# Security: identity, access control and audit

## Authentication

- Email + password (argon2id, OWASP parameters); minimum 12 characters.
- Lockout: 5 consecutive failures lock the account for 15 minutes (MFA failures count too).
- Login responses do not reveal whether an email exists; unknown emails still
  run a password verification for similar timing.
- Optional TOTP MFA (RFC 6238). Secrets are encrypted at rest with AES-256-GCM
  (`MFA_ENCRYPTION_KEY`). Enrollment requires confirming a code.
- Sessions: see ADR-0004. Logout, password change (other sessions) and
  membership suspension end access immediately.
- Credential endpoints are rate limited to 10/min per client; the API default is 300/min.

### Password reset by email

Migration `0089` (`staff_password_reset`, `StaffPasswordResetService`). Signed out, staff use **Forgot your password?**
(`/forgot-password`): `POST /auth/password-reset/request { email }` answers `204` whether or not the account exists; a link
goes only to an active staff account with an active membership, at most 3 per hour, to its sign-in email through
`NotificationService` (template `staff.password-reset`, internal, the link blanked once sent; recorded under the
organization joined first). The link is `STAFF_BASE_URL/reset-password#token=…` (the fragment never reaches a server);
only the token's SHA-256 is stored; it works once, for 30 minutes, and a new request supersedes it. `POST
/auth/password-reset { token, password, code? }`: with two-step verification on, a current code is required
(`401 mfa_code_required`; five wrong codes burn the link). A reset ends every session, clears a lockout and a temporary
password, is audited (`auth.password-reset`, failures with their reason) and the account's email is told
(`staff.password-changed`). Without `STAFF_BASE_URL` no link is sent. Both endpoints are rate limited like sign-in.

### Required two-step verification

An organization can require two-step verification of its staff (`organization.staff_mfa_required`, migration `0089`;
Company settings, `organization.manage`, audited in `organization.update`). A member without it who signs in gets a
session in which only the account routes (`@AllowAccountSetup()`: me, password, two-step set-up, sign-out) answer; the
rest refuse with `403 mfa_enrollment_required` and the staff app shows only "Set up two-step verification". While the
rule is on, turning it off is refused (`mfa_required_by_organization`). An administrator can still turn off a member's
two-step verification after a lost phone (below); the member then sets it up again at the next sign-in.

### Credential resets by an administrator

Migration `0088`. With `user.manage`, an administrator can help a member of the organization sign in (`libs/auth`,
`UsersService`); both need a reason, end every session of the person at once and are audited (`user.password-reset`,
`user.mfa-reset`, with the sessions ended):

- **Temporary password** (`POST /users/:id/password-reset`, `{ temporaryPassword, reason }`; same rules as any password):
  the administrator gives it to the person directly. It also clears a lockout. `app_user.password_change_required` is
  set: until the person changes it (`POST /auth/password`, which clears it), the `AccessGuard` refuses every route not
  marked `@AllowAccountSetup()` (`/auth/me`, `/auth/me/facilities`, `/auth/password`, `/auth/logout`) with
  `403 password_change_required`, and the staff app shows only "Choose your own password".
- **Two-step verification off** (`POST /users/:id/mfa-reset`, `{ reason }`): for a lost phone; the secret (and any
  unfinished enrolment) is removed and the person can enrol again under My account (`mfa_not_enabled` when it is off).
- Never your own account (`self_modification`; use My account). A staff account's credentials are shared by every
  organization it belongs to, so an account that is also a member elsewhere, or a platform administrator's, is refused
  (`account_shared`) unless the administrator is a platform administrator. Another organization's member is not found.
- No emailed reset link for staff: there is no verified staff email channel yet. The administrator should confirm the
  person's identity in person before a reset (the reason records how).

## Authorization model

```
User ──membership──▶ Organization
  └──role_assignment(role, facility?, department?)──▶ Role ──▶ Permissions
```

- A grant with no facility applies organization-wide; a facility grant applies
  only when the request carries that `X-Facility-Id`; a department grant only
  with that `X-Department-Id`.
- System roles (`org_admin`, `physician`, `nurse`, `receptionist`,
  `records_officer`, `auditor`) are templates; organizations can define custom roles.
  Clinic permissions (migration 0012): physicians document, sign, amend and
  prescribe; nurses triage, record allergies and manage care plans;
  receptionists manage appointments and the queue; records officers read.
- Clinical identity: starting or signing an encounter and prescribing also
  require the account to be linked to an active practitioner of an allowed
  profession — a permission alone is not enough. Only the responsible
  practitioner may sign an encounter.
- Nobody can grant a role or create a role containing permissions they do not
  hold themselves (privilege-escalation guard, audited).
- Platform administrators (`is_platform_admin`) can create organizations.
- Authorization is enforced server-side on every route; tenant isolation is
  enforced again in every query and by composite foreign keys.

## Audit trail

Recorded in `audit_event`, append-only (trigger + recommended DB grants):
who, what (`action`), when, organization, facility, patient, resource,
outcome, reason, before/after changes, request id, IP and user agent.

Audited in Phase 2 in addition: clinic configuration, appointment booking and
every status change, check-in, queue moves and views, triage, vital signs and
their corrections, allergy changes and reviews, encounter start/view/note
saves/sign/amend, diagnoses, prescriptions (issue/view/replace/cancel),
**decision-support overrides**, care plans, Patient 360 views.

Audited for interoperability: every FHIR read (`fhir.patient-read`,
`fhir.patient-everything`, `fhir.search`) with the patient, resource types and
count; the FHIR interface requires `interop.fhir.read` (migration 0020).
PhilHealth claims (migration 0021): `philhealth.claim.submit` (org_admin, cashier)
and `philhealth.settings.manage` (org_admin); audited `philhealth.claim.preview`,
`philhealth.claim.submit-request`, `philhealth.claim.exchange` (system) and
`philhealth.accreditation.record`.
PhilHealth eligibility (migration 0024): `philhealth.eligibility.manage`
(org_admin, receptionist, cashier); audited `philhealth.eligibility.*`
(answers from an adapter as the system); recorded answers are immutable.
Inventory (migration 0026): `inventory.read`, `inventory.move`,
`inventory.adjust`, `inventory.catalog.manage`; new system role
`inventory_officer`; nurses and medical technologists read and move stock;
every movement is audited (`inventory.*`, reasons for counts and write-offs).
Consent wording (migration 0078): `consent.wording.manage` (org_admin) writes the organization's own wording for the consents patients may give online in MyHealth;
each version is immutable and audited (`consent.wording-publish`, `consent.wording-withdraw`; the audit keeps the version, not the text).
Records requests (migration 0068): `patient.records-request.manage` (org_admin,
records_officer) reviews patients' requests for copies, shares documents or declines
with a reason, and prepares copies of the record (migration 0070; they include the dental record and document list
whatever the preparer's own clinical access, because they answer the patient's own request, and nothing reaches the
patient until shared); audited `patient.records-request.view | review | fulfil | decline | copy`.
Compliance configuration (migration 0074; docs/architecture/compliance-configuration.md):
`compliance.review.manage` (org_admin) records who validated each area; `inventory.controlled-register.read`
(org_admin, pharmacist, inventory_officer) reads and exports the register of controlled items (audited
`inventory.controlled-register.view | export`); `document.retention.manage` (org_admin, records_officer) sets retention
periods and reviews documents past them (audited `document.retention.*`; nothing is deleted). Withholding codes and
procurement methods need `inventory.procurement.approve`; the laboratory licence `lab.qc.manage`; the records-request
procedure `patient.records-request.manage` and `organization.manage`; audited `compliance.review.record`,
`inventory.withholding-code.*`, `inventory.procurement-method.*`, `inventory.controlled-register.setting`,
`lab.licence.record`, `patient.records-request.setting`, `dental.plan.estimate.signed`.
Medical certificates use the encounter permissions (issue: `encounter.sign` and the
consultation's responsible practitioner; void: the issuer or `encounter.amend`).
Inventory valuation (migration 0061): `inventory.valuation.read` (org_admin,
inventory_officer). Supplier invoices use the procurement permissions (approval
never by the recorder — database constraint); audited
`inventory.supplier-invoice.record | approve | pay | void`.
Dental (migration 0027): `dental.record.read`, `dental.record.write`
(corrections), `dental.chart.write`, `dental.treatment-plan.manage`,
`dental.procedure.record`, `dental.imaging.read`, `dental.imaging.upload`,
`dental.settings.manage`; new system roles `dentist` (a physician's clinical
permissions plus dental) and `dental_assistant` (a nurse's plus the dental
record and imaging); recording also requires a practitioner with profession
`dentist`. Audited `dental.*` (views, examinations, plans, procedures, images,
corrections with the reason); image links are audited as `document.download`.
Laboratory quality control (migration 0050): `lab.qc.read`, `lab.qc.enter`
(org_admin, medical_technologist, pathologist), `lab.qc.manage` (org_admin,
pathologist); audited `lab.instrument.*`, `lab.qc.*`; QC runs, corrective actions
and the instrument log are append-only. Quality management (migration 0055)
uses the same permissions; audited `lab.storage-unit.*`, `lab.temperature.record`,
`lab.nonconformance.*`, `lab.eqa.*`, `lab.competency.record`; competency is never
self-assessed.
Management dashboard (migration 0059): `management.dashboard.read` (org_admin);
a facility-scoped grant limits the figures to that facility; revenue, collections
and service revenue (JSON sections and the `services`, `categories`, `revenue` and
`collections` exports) additionally need the existing `billing.report.read` on
**every** facility in scope — otherwise `billing` is `null`, listed in `withheld`,
billing is not queried, and a revenue export is refused (403) and audited as a
denial. Audited `management.dashboard.view` (range, facilities, withheld) and
`management.dashboard.export` (table, range, facilities, withheld, rows). Counts
and amounts only; patient counts 1–4 shown as "<5"; CSV cells are formula-safe.
Integration exchange review (migration 0025): `integration.exchange.manage`
(org_admin); audited `integration.exchange.list`, `.requeue`, `.resolve` (with
the note as the reason). Payloads are never shown.
Analyzer interfaces (migration 0075): `lab.instrument.message.submit` (org_admin; grant it to the instrument
gateway's integration account's role — it can only post analyzer messages, which wait for review); settings need
`lab.qc.manage`, the review `lab.result.read` / `lab.result.enter`; audited `lab.instrument.message.receive`,
`lab.instrument.interface.configure`, `lab.instrument.test-code`, `lab.instrument.result.*`.
FHIR imports (migration 0048): `interop.fhir.import` (org_admin; grant it to an
integration account's role to submit) and `interop.fhir.import.review`
(org_admin, records_officer; clinicians are not granted it by default —
reconciling external records is a records function, and an imported allergy is
recorded unconfirmed for the clinician to confirm). Registering a new patient
from an import also needs `patient.register`. Audited `fhir.import.receive`
(resource types, counts, digest — never content), `.list`, `.view`,
`.candidates` (plus the patient domain's `patient.duplicate-check`), `.match`,
`.entry-accept`, `.entry-reject` and `.reject` (with the reason), `.complete`,
`.purge` (system), and the domain's own `allergy.add` / `external-history.record`
with the import reference. The received content is sealed with the integration
payload key ring; no PHI is kept in clear.
DOH case reporting (migration 0023): `doh.report.manage` (org_admin, physician,
records_officer) and `doh.settings.manage` (org_admin); audited `doh.case.*`
(detection and outcomes as the system; dismissals with the reason),
`doh.rule.*` and `doh.facility-code.record`.

Audited in Phase 1: logins (success/failure/lockout/MFA), logout, password and
MFA changes, session revocation on token reuse, access denials, organization /
facility / department changes, user membership and role changes, patient
registration / duplicate override / view / search / updates / status /
sub-records / consent / preferences, document create / upload / list / download
/ archive, notification creation (including suppression), audit searches.

## Data protection

- Documents: private bucket, server-side encryption, 10-minute upload and
  5-minute download presigned URLs; object keys contain no patient data.
- Outbound messages use reviewed templates; SMS/email/push must not contain
  clinical detail. Free text is limited to in-app messages.
- Logs never contain message bodies; destinations are masked.
- Domain events and realtime messages carry identifiers and statuses only —
  never names or clinical text. Realtime clients are checked on connect with
  the same session, account, facility and permission rules as the REST API:
  a socket receives `queue.updated` only with `clinic.queue.read` and
  `lab.updated` only with `lab.order.read` at that facility (and is refused
  with neither). Browsers present a ticket from
  `POST /auth/realtime-tickets`: a JWT typed `realtime`, valid 60 seconds,
  bound to one session and facility, and refused as an access token (and vice
  versa). A ticket is not single-use: replayed within its minute it opens a
  socket for the same user and facility only, and never after the session ends.
  Server-side clients may still connect with an access token and facility id.

## Known gaps (tracked for later phases)

- MFA is optional; an organization-level "require MFA" policy is not implemented.
- TOTP codes can be replayed within their 30-second window.
- No breached-password screening.
- Rate-limit counters are per instance (move to Redis before scaling out).
- Refresh tokens are returned in JSON; the web app should use an HttpOnly
  cookie / BFF pattern.
- Patient-portal identities (`app_user.kind = 'patient'`) are modeled but not used yet.
- Data retention periods and deletion/anonymization procedures must be defined
  with the organization's Data Protection Officer against current NPC guidance.

Nothing here constitutes a claim of Data Privacy Act compliance; compliance
must be assessed against current official requirements (CLAUDE.md §36).
