# Healthcare data privacy audit (Stage A, read-only)

Date: 2026-11-02. Scope: PHI/PII catalogue, exposure paths, logs, events, masking, exports and downloads, audit-trail completeness for reads, retention, Data Privacy Act (RA 10173) mapping. Method: static reading and grep of `libs/*`, `apps/api`, migrations and `docs/security/data-privacy-act.md`. Nothing was run, no database or network was touched. This is an engineering review, not legal advice; the Act's requirements as interpreted by the National Privacy Commission are not encoded here and must be validated by the organization's DPO/counsel.

Classification: Verified secure, Tested no issue (none: nothing was run), Not tested, Incomplete implementation, Confirmed vulnerability (code-level).

## 1. PHI / PII catalogue

See DATABASE_INVENTORY.md section 6 for table-level detail. Summary of sensitivity (RA 10173 "sensitive personal information" includes health, government-issued identifiers, and sexual life):

| Class                                                                                                    | Where                                                                                                                | Protection seen                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Government identifiers (PhilHealth PIN, PhilSys, senior/PWD ID, passport, licence)                       | `patient_identifier.value` clear text (0005:49-66)                                                                   | No column encryption; returned in clear by the patient record API (PRIV-003)                                                                                        |
| Contact data (phone, email, address, emergency contacts, guardians)                                      | `patient_contact_point`, `patient_address`, `patient_relationship`                                                   | RLS by organization; masked in communications log (`maskPhone`/`maskEmail`, `libs/core/src/lib/ph/mobile.ts:13,19`)                                                 |
| Clinical record (notes, diagnoses, vitals, allergies, prescriptions, procedures, immunizations, history) | clinic/prescription/care-plan tables                                                                                 | RBAC per permission, audit on reads, append-only/amend-only                                                                                                         |
| Sexual history, substance use                                                                            | history tables (0082)                                                                                                | Needs `history.read` plus `encounter.write`; null and `sensitiveWithheld` otherwise; not in notices/timeline/search/audit values (CLAUDE.md; code not re-read)      |
| Laboratory, dental (incl. images), telemedicine chat, messages, attachments                              | respective libs; files in object storage                                                                             | private bucket, SSE-S3 `AES256` (`libs/documents/src/lib/object-storage.ts:61,110`), signed short-lived URLs, malware scan, checksum, integrity review (0098, 0105) |
| Financial (invoices, payments, PhilHealth claim packages)                                                | billing/philhealth                                                                                                   | claim payloads sealed AES-256-GCM, digest-only exchange log                                                                                                         |
| Credentials (password hashes, TOTP secrets, passkeys, recovery codes)                                    | auth tables                                                                                                          | MFA secrets encrypted with `MFA_ENCRYPTION_KEY`; recovery codes hashed                                                                                              |
| Derived copies                                                                                           | `idempotency_record.response_body`; `lab_report_archive`; `record_copy` documents; scheduled management report files | copies listed in PRIV-002 (idempotency), others access-controlled and audited                                                                                       |

## 2. Exposure paths: cross-patient, cross-facility, cross-tenant

| Path                                        | Result                                     | Evidence                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-tenant at database                    | Verified present as second line, with gaps | RLS `organization_isolation` on 247 tables (0111); gaps DB-002..DB-004 in POSTGRESQL_DATABASE_SECURITY_AUDIT.md                                                                                                                                                                                                                     |
| Cross-tenant at application                 | Verified pattern, not exhaustively         | services scope by `actor.organizationId`; after org-scoped loads, by-id UPDATEs (258 single-key `where(eq(x.id, id))` calls) are used on rows already fetched under the actor's organization (sampled billing, care plan, appointment). Under `enforce` RLS adds a backstop. Exhaustive per-route authorization testing: Not tested |
| Cross-facility                              | Not verified                               | facility scope is application-level (`@RequireFacility`, facility-scoped grants, e.g. `GET /communications` facility filter 0106, management dashboard scope). No database control                                                                                                                                                  |
| Cross-patient (merged records)              | Verified                                   | records filed under a retired duplicate are read through `patient_record_ids`; new care under merged record refused by trigger `refuse_record_for_merged_patient` (0068+)                                                                                                                                                           |
| Patient portal (MyHealth) horizontal access | Not tested                                 | separate guard `PatientAccessGuard`, tokens with `healthcare-portal` audience, proxy grants audited with `proxyGrantId`; only released results are shown. Authorization tests not run                                                                                                                                               |
| FHIR read/export                            | Verified design                            | `interop.fhir.read` required, every access audited (`fhir.controller.ts:60` `fhir.patient-read`), released lab results only, external-import data tagged. Bulk `$everything` exposure to a granted integration account is by design                                                                                                 |
| Timeline / Patient 360 aggregation          | Verified design                            | each kind needs its own domain permission, others listed in `withheld` without counts; rows carry ids, statuses, codes, names, not notes or values; one audit per request (`patient-timeline.service.ts:180`, `patient-workspace.service.ts:404`). Content of every timeline row type not individually re-read                      |
| Search                                      | Verified design                            | `patient.search` audited (`patient-search.service.ts:108`); minimal summary; QR scan returns minimal summary, payload not audited                                                                                                                                                                                                   |
| Integration account / instrument gateway    | Not tested                                 | `lab.instrument.message.submit` scoped account                                                                                                                                                                                                                                                                                      |

## 3. Sensitive fields in API responses

- PhilHealth PIN and other identifiers: the patient record endpoint returns `identifiers[].value` unmasked to any caller with `patient.read` (`libs/patient/src/lib/patient-record.service.ts:130-137`). Masking exists only in the staff web app (`apps/staff/src/lib/patient-workspace.ts:73-82`) and in the PhilHealth claim preview (`libs/philhealth/src/lib/claim-package.ts:186`, `philhealth-claims.service.ts:60`). CLAUDE.md says the 360 banner masks the PIN; that is a display rule, not an API rule (PRIV-003).
- Billing identifier masking helper exists (`libs/billing/src/lib/billing-support.ts:26`) and notification destinations are masked in the communication log and portal preference reads (`portal-preferences.rules.ts:26`).
- Error responses: generic 500 envelope with request id; no stack in the response (`libs/core/src/lib/http/exception.filter.ts:25-60`). Unique-violation responses expose the constraint name (`:56`), low risk.
- Sensitive history sections are withheld server side (CLAUDE.md "Patient history"); code Not re-read.

## 4. Logs, events, notifications

### 4.1 Application logs

- 81 `logger.*` call sites in `apps/` and `libs/` (non-test). Most log ids, counters, error strings. Access log records method, route template, status, duration, request id, actor kind and user id, never bodies or URLs with ids (`libs/core/src/lib/http/access-log.ts:22-48`). Verified secure for the access log.
- Confirmed PHI-in-logs path: `HttpExceptionFilter` logs `exception.stack` for any unhandled 5xx (`exception.filter.ts:35-38`). With the installed `drizzle-orm` 0.45.3, a failed query is thrown as `DrizzleQueryError` whose message is `Failed query: <sql>\nparams: <values>` (`node_modules/drizzle-orm/errors.js:10-14`), and the pool is created with `drizzle(pool)` without a custom logger (`database.module.ts:21`). The stack's first line therefore contains bound parameter values (names, dates of birth, notes, identifiers, token hashes) whenever a database error becomes a 500 (deadlock, serialization failure, connection loss, CHECK violation not mapped). `fhir-exception.filter.ts:62-65` does the same plus the request path containing the patient id. Not exercised (PRIV-001).
- Development-only logs print an email address with a verification code, password reset links and activation refusal reasons when `NODE_ENV === "development"`: `apps/api/src/app/portal/portal-security-notices.ts:38,58`, `staff-security-notices.ts:34`, `libs/patient/src/lib/portal/portal-account.service.ts:241`. `NODE_ENV` defaults to `development` when unset (`app-config.ts:41`), so a mis-configured staging or production container would log secrets (PRIV-004).
- Dev channel stubs log the last 4 digits of a destination and message length (`libs/notification/src/lib/channel-senders.ts:25`), acceptable.
- Not verified: log shipping destination, retention and access controls (no backend chosen, ADR-0012); OpenTelemetry spans are scrubbed of URLs, queries, headers and addresses per CLAUDE.md (code not re-read).

### 4.2 Audit values

- Audit events record actor, action, resource and ids; reads use `recordStandalone`. Sensitive history sections are not placed in audit values (CLAUDE.md). A full review of every audit `before/after` payload was not done: Not verified.

### 4.3 Domain events (outbox)

- Convention "payloads carry ids, never clinical text". Sample: `encounterEvent` payload is `practitionerId`, `modality` (`libs/clinic/src/lib/encounters/encounter.service.ts:47-55`). Other event payloads not enumerated (Not verified).

### 4.4 Notifications

- Content-free design for results, records and dental updates (CLAUDE.md); `notification` table has `destination` but no body column in 0007 (templates rendered at send; Not verified for later migrations). Staff push is content-free by template (`renderPush`); free-text staff messages never pushed. Outreach campaigns use non-clinical segments and an opt-out link.
- The communication log shows masked destinations and no content (`notification.log.view`/`export` audited).

### 4.5 Idempotency cache

- Full response bodies stored in clear in `idempotency_record` with no purge job (DB-005 in the database audit; PRIV-002 here).

## 5. Export and download controls

| Control                           | Result                   | Evidence                                                                                                                                                                                                              |
| --------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documents                         | Verified secure (design) | private bucket, signed URL with expiry (`object-storage.ts:55-90`), `document.download` audited (`documents.service.ts:452`), malware scan and checksum on upload, quarantine, integrity findings withhold files      |
| CSV exports                       | Verified design          | formula-safe `toCsv` in `libs/core`; communications export capped at 5,000 rows and audited; management dashboard exports audited per table with gated tables refused and logged as denials; counts 1-4 shown as "<5" |
| Scheduled management reports      | Verified design          | stored as documents, downloads re-check each section's permission and are audited (`management.report.download`, `management-report.service.ts:362,375`)                                                              |
| Copy of record / records requests | Verified design          | prepared by the records office only, audited `patient.records-request.copy`, shared per request; no deadline/fee encoded                                                                                              |
| Full audit-trail export           | Verified design          | archives to object storage with checksum; platform administrators only                                                                                                                                                |
| Download of archived DB dumps     | Not verified             | operator-controlled (backup-and-restore runbook says to encrypt; the tooling is not specified)                                                                                                                        |

## 6. Retention and deletion

- Clinical data is never casually deleted by policy (statuses, amendments, entered-in-error); the database enforces this only for append-only tables (DB-006).
- Document retention periods per category are configuration and flag documents past them for review; nothing is auto-deleted (`document.retention.manage`, migration 0074). Rejected FHIR import content is purged after 30 days (`fhir-import-retention.ts`). Push receipts are kept 30 days. Idempotency records: not purged (PRIV-002). Audit retention: `AUDIT_RETENTION_MONTHS` unset = never removed (safe default).
- Erasure/rectification/objection requests are recorded and answered by a person; the platform changes or deletes nothing automatically (0114). Anonymisation/erasure tooling does not exist (Incomplete implementation; correct for a medical record, but disposal after the retention period has no mechanism). Backups are not covered by any deletion process.

## 7. Audit-trail completeness for reads (20+ routes sampled)

Each row: read route/operation, audit action, location. All Verified by reading the call site.

| #   | Read                          | Audit action                                                | Location                                                            |
| --- | ----------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Patient search                | `patient.search`                                            | `libs/patient/src/lib/patient-search.service.ts:108`                |
| 2   | Patient clinical summary      | `patient.summary-view`                                      | `apps/api/src/app/patient-360/patient-summary.controller.ts:48`     |
| 3   | Patient 360 workspace         | `patient.workspace.view`                                    | `apps/api/src/app/patient-360/patient-workspace.service.ts:404`     |
| 4   | Patient timeline              | `patient.timeline.view`                                     | `apps/api/src/app/patient-timeline/patient-timeline.service.ts:180` |
| 5   | Encounter view                | `encounter.view`                                            | `libs/clinic/src/lib/encounters/encounter.service.ts:179`           |
| 6   | Encounter list                | `encounter.list`                                            | `encounter.service.ts:215`                                          |
| 7   | Encounter revision history    | `encounter.view-history`                                    | `encounter.service.ts:199`                                          |
| 8   | Prescription view             | `prescription.view`                                         | `libs/prescription/src/lib/prescription.service.ts:160`             |
| 9   | Allergies                     | `allergy.view`                                              | `libs/clinic/src/lib/triage/triage.service.ts:162`                  |
| 10  | Vitals                        | `vitals.view`                                               | `triage.service.ts:134`                                             |
| 11  | Care plan                     | `care-plan.view`                                            | `libs/care-plan/src/lib/care-plan.service.ts:129`                   |
| 12  | Lab order                     | `lab.order.view`                                            | `libs/laboratory/src/lib/orders/lab-order.service.ts:160`           |
| 13  | Lab results / trend / history | `lab.result.list`, `lab.result.trend`, `lab.result.history` | `libs/laboratory/src/lib/results/lab-result.service.ts:284,335,259` |
| 14  | Patient history               | `history.view`                                              | `libs/clinic/src/lib/history/history.service.ts:290`                |
| 15  | Dental record                 | `dental.record.view`                                        | `libs/dental/src/lib/dental-record.service.ts:54`                   |
| 16  | Immunizations                 | `immunization.view`                                         | `libs/clinic/src/lib/immunizations/immunization.service.ts:517`     |
| 17  | Outside results               | `outside-result.view`                                       | `libs/clinic/src/lib/outside-results/outside-result.service.ts:153` |
| 18  | External history              | `external-history.view`                                     | `libs/clinic/src/lib/external/external-records.service.ts:110`      |
| 19  | Referral                      | `encounter.referral.view`                                   | `libs/clinic/src/lib/referrals/referral.service.ts:226`             |
| 20  | Document download             | `document.download`                                         | `libs/documents/src/lib/documents.service.ts:452`                   |
| 21  | Invoice view                  | `billing.invoice.view`                                      | `libs/billing/src/lib/invoices/invoice.service.ts:459`              |
| 22  | Telemedicine session          | `telemedicine.session-view`                                 | `libs/telemedicine/src/lib/telemedicine.service.ts:144`             |
| 23  | FHIR patient read             | `fhir.patient-read`                                         | `apps/api/src/app/fhir/fhir.controller.ts:60`                       |
| 24  | Portal results                | `portal.results-view`                                       | `apps/api/src/app/portal/portal-records.controller.ts:61`           |

Coverage assessment: strong for the sampled set; there are 197 `recordStandalone` call sites and about 200 audit action names containing view/list/read/download. Gaps not excluded: no automated check that every `@Get` handler returning patient data calls the audit service (a lint or integration test enumerating routes would prove it; Not tested). Whether a failure to write a read audit row blocks the read: Not verified.

## 8. Data Privacy Act mapping

### 8.1 Technical controls built (evidence cited; effectiveness needs testing)

| RA 10173 theme                             | Technical control                                                                                                                                                              | Evidence                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Consent and lawful basis records           | Append-only consent history with wording version, channel, electronic/manual; wording shipped empty, organization supplies it                                                  | `patient_consent` trigger (0005), `consent_text` (0078)     |
| Data subject access / portability          | Records requests (access), copy-of-record PDF, FHIR read                                                                                                                       | 0068, 0070, 0114; `docs/security/data-privacy-act.md`       |
| Rectification, erasure, objection requests | Request workflow only; no automatic change                                                                                                                                     | 0114                                                        |
| Security: access control                   | RBAC with org/facility scope, global `AccessGuard`, MFA (staff optional policy, patient policy, passkeys), session controls, breached-password screening, rate limits, lockout | CLAUDE.md sections; migrations 0073, 0086, 0092, 0100, 0108 |
| Security: audit                            | Append-only audit trail, partitioned, archivable; PHI read audit                                                                                                               | 0110 and section 7                                          |
| Security: encryption                       | TLS (deployment), SSE-S3 object storage, sealed integration payloads, encrypted TOTP secrets                                                                                   | `object-storage.ts:61`; app-config key checks               |
| Security: tenant isolation                 | App filters + RLS second line                                                                                                                                                  | 0111 (gaps DB-001..004)                                     |
| Document safety                            | malware scan, checksum, integrity review, signed URLs                                                                                                                          | 0098, 0105                                                  |
| Breach management                          | Breach register with organization-set notification window, assessment, NPC reference, trail; nothing sent automatically                                                        | 0114 `privacy_incident`                                     |
| Idle session                               | staff idle sign-out                                                                                                                                                            | `apps/staff/src/lib/idle.ts`                                |
| Minimisation                               | content-free notifications, "<5" suppression in dashboards, minimal search/QR responses                                                                                        | see sections 4-5                                            |

### 8.2 Organizational and legal items (NOT provided by software, must be done by the organization)

Appointment and registration of the Data Protection Officer and NPC registration of the data processing system; privacy notice text and the consent wording itself; lawful-basis decisions (including whether research or outreach use is permitted); breach notification decisions and content to the NPC and data subjects within the legally required period; privacy impact assessments; processor/transfer agreements (Expo push, PayMongo, email/SMS providers, hosting region, LiveKit, PhilHealth, DOH); retention schedules and disposal rules per record class; handling of data subject requests deadlines and fees; staff training and confidentiality agreements; physical security of devices and premises; backup policy and its encryption; incident response plan; hosting contract and cross-border considerations. These are tracked in `docs/security/compliance-dependencies.md`; this audit did not re-verify that register.

### 8.3 Technical gaps relevant to the Act

Items in the Findings below (PRIV-001 to PRIV-009) and DB-001 to DB-010: logging of parameters, copy retention, unmasked identifiers, and the unproven backup/disposal process.

## Findings

### PRIV-001 HIGH - Database query parameters (PHI/PII, credentials hashes) can be written to logs on any 5xx database error

- Location: `libs/core/src/lib/http/exception.filter.ts:35-38`; `apps/api/src/app/fhir/fhir-exception.filter.ts:62-65`; `libs/core/src/lib/database/database.module.ts:21`; library behaviour `node_modules/drizzle-orm/errors.js:10-14` (drizzle-orm 0.45.3).
- Evidence: `DrizzleQueryError.message = "Failed query: <sql>\nparams: <values>"`; the filter logs `exception.stack`, whose first line is that message. Any non-mapped database error (deadlock, serialization failure, connection reset, unmapped CHECK) therefore emits patient names, dates of birth, notes text, identifiers, tokens, etc. to the log pipeline. Mapped errors (unique violation, merged-patient) take another path and are not logged.
- Exploitability: needs only a database error that becomes a 500; an attacker able to provoke one (large inputs, races) can also force it. Reading logs requires log access, which is typically wider than record access and not audited.
- Impact: uncontrolled PHI/PII copies in the logging system, outside RBAC, audit and retention; breach-register relevant.
- Fix: unwrap the error before logging (log `cause.code`, `cause.constraint`, SQL template without params, never `message`/`params`); add a logger scrubber that drops `params:` content; add a test that a failing query yields no parameter text in logs. Check any other `logger.error(..., stack)` sinks.
- Status: Open (code-level; not exercised)

### PRIV-002 MEDIUM - Idempotency cache keeps complete PHI responses, unpurged

- Location: `libs/core/src/lib/idempotency/idempotency.interceptor.ts:56-85`, 0001:14-28.
- Evidence and fix: as DB-005. Responses to registration, encounter and billing POSTs with an `Idempotency-Key` persist in clear in a table with no organization column, no RLS and no purge; deleting happens only on reuse of the same key.
- Impact: a PHI duplicate outside retention governance, included in every backup.
- Status: Open

### PRIV-003 MEDIUM - Government identifiers returned unmasked by the API; masking is a UI convention

- Location: `libs/patient/src/lib/patient-record.service.ts:130-137`; masking at `apps/staff/src/lib/patient-workspace.ts:73-82` and claim preview only.
- Evidence: the record API includes `identifiers[].value` for every type (PhilHealth PIN, PhilSys, passport, licence, senior/PWD ID). Any role with `patient.read` (broad: clinical, front desk, billing) receives them in clear in network responses and any API consumer sees them; the identifiers are also stored unencrypted.
- Exploitability: any authorized-but-unneeding user, a compromised low-privilege account, or a browser extension/API client; patient lookup by identifier is a legitimate need but display is not.
- Impact: unnecessary exposure of sensitive identifiers (data minimisation).
- Fix: return masked values by default and a separate permissioned, audited "reveal" endpoint (`patient.identifier.reveal`); consider column encryption with a blind index (`value_normalized` is already stored for search, which currently also reveals the value to DB readers).
- Status: Open

### PRIV-004 MEDIUM - Secrets and email addresses are logged when `NODE_ENV=development`, which is the default

- Location: `apps/api/src/app/portal/portal-security-notices.ts:38,58`; `apps/api/src/app/staff-security-notices.ts:34`; `libs/patient/src/lib/portal/portal-account.service.ts:241`; `libs/core/src/lib/config/app-config.ts:41`.
- Evidence: single-use password-reset links and 6-digit verification codes with the recipient email are written to the log in development; `NODE_ENV` defaults to `development`.
- Exploitability: a deployed instance with `NODE_ENV` unset or set wrongly lets anyone with log access take over MyHealth or staff accounts that request a reset.
- Fix: require `NODE_ENV` explicitly (no default) in deployed environments, gate these lines on an explicit `DEV_LOG_SECRETS=1`, and add a production readiness warning when `NODE_ENV` is not `production`.
- Status: Open

### PRIV-005 MEDIUM - Read-audit completeness is by convention, not enforced

- Location: 197 `recordStandalone` call sites; no route-enumerating test found.
- Evidence: 24 sampled read operations all audit (section 7); there is no mechanism (decorator, interceptor, test) that guarantees a new `@Get` returning patient data audits. Behaviour when the audit write fails on a read is Not verified.
- Fix: an integration test that walks the route table and requires either an `@Audited()` marker or a documented exemption; fail closed for patient-record reads if audit write fails.
- Status: Open

### PRIV-006 LOW - FHIR error log includes the request path with patient id

- Location: `apps/api/src/app/fhir/fhir-exception.filter.ts:62-65`.
- Evidence: `Unhandled error on <method> <request.path>`; path contains `Patient/{uuid}` and search parameters are excluded (path only).
- Impact: pseudonymous identifier in logs; low on its own, relevant combined with PRIV-001.
- Fix: log the route template (`request.route?.path`) like the access log does.
- Status: Open

### PRIV-007 MEDIUM - No disposal mechanism for records past retention; backups and idempotency/derived copies are outside any retention process

- Location: `docs/security/data-privacy-act.md` (retention row), migration 0074 retention review ("nothing deleted"), `docs/runbooks/backup-and-restore.md`.
- Evidence: the platform lists documents past retention but offers no archival/deletion flow; no policy for patient records, notifications, `notification` rows, `idempotency_record`, or backup expiry.
- Impact: indefinite retention of sensitive data conflicts with storage-limitation principles unless the organization sets and enforces a policy; erasure requests cannot be fulfilled technically.
- Fix: organization-approved retention schedule per record class, then tooling (archive/anonymise with audit and legal hold) and backup expiry; document that clinical erasure is exceptional.
- Status: Open

### PRIV-008 LOW - Sensitive-section and timeline exclusions are asserted in docs, not re-verified

- Evidence: CLAUDE.md states substance use/sexual history are withheld from notices, timeline, search and audit values; timeline rows exclude notes and values; this audit read only call sites for audit names, not each mapper.
- Fix: add tests that fail if those fields appear in timeline, FHIR export without permission, notifications, audit values or CSV.
- Status: Open

### PRIV-009 INFO - Technical and legal responsibilities are separated correctly in the documentation

- Evidence: `docs/security/data-privacy-act.md` states no NPC rule is encoded and leaves DPO, privacy notice, notification content and retention to the organization; section 8.2 of this file lists the same items. No action beyond completing `docs/security/compliance-dependencies.md`.
- Status: Open (informational)
