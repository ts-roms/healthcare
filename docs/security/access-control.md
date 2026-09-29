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
