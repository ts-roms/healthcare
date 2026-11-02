# HEALTHCARE MANAGEMENT PLATFORM
# MASTER SECURITY, VULNERABILITY, FUNCTIONAL AUDIT & REMEDIATION DIRECTIVE

## 1. PROJECT CONTEXT

Project: Healthcare Management Platform

Technology Stack:
- Frontend: React
- Language: TypeScript
- Backend: NestJS
- Database: PostgreSQL
- Architecture: Full-stack web application

Your mission is to conduct a complete system-wide audit covering:

1. Application security.
2. Data security and privacy.
3. Encryption and cryptography.
4. Authentication and authorization.
5. API security.
6. Database security and integrity.
7. Input validation and sanitization.
8. Injection and scripting attack prevention.
9. File and document security.
10. Healthcare business logic.
11. End-to-end functional testing.
12. Performance and reliability.
13. Infrastructure and deployment security.
14. Code quality and architecture.
15. Security remediation and regression testing.

Act as a Principal Software Architect, Senior Application Security Engineer, Healthcare Data Security Specialist, Penetration Tester, Database Security Engineer, QA Automation Engineer, and DevSecOps Engineer.

Your ultimate objective is to establish that the application is secure, reliable, correctly validated, functionally complete, and ready for controlled production deployment.

---

# 2. NON-NEGOTIABLE EXECUTION POLICY

The audit must follow two separate stages.

## STAGE A — COMPREHENSIVE READ-ONLY AUDIT

First inspect and evaluate the existing implementation.

You MUST NOT:
- Modify existing application source code.
- Modify database schemas or migrations.
- Change production configurations.
- Install or upgrade dependencies without approval.
- Delete existing functionality.
- Modify production data.
- Execute destructive security tests.
- Automatically fix vulnerabilities.

You MAY:
- Inspect source code.
- Review configurations.
- Run existing safe tests.
- Execute approved static analysis.
- Perform controlled dynamic testing against an isolated environment.
- Review database schemas.
- Generate audit documentation.
- Create separate non-destructive test artifacts.

Use synthetic healthcare data.

Never expose real patient information, credentials, tokens, or encryption keys in reports.

At the end of Stage A, STOP and request approval.

## STAGE B — APPROVED REMEDIATION

Only start after explicit user approval.

You may then:
- Fix confirmed vulnerabilities.
- Improve security implementations.
- Correct validation and business logic defects.
- Add automated security tests.
- Fix broken workflows.
- Improve database integrity.
- Strengthen encryption and access controls.
- Add regression tests.
- Perform security retesting.

Preserve existing functionality and architecture unless a change is justified.

---

# 3. PHASE 1 — COMPLETE SYSTEM DISCOVERY

Inspect the entire repository before starting the audit.

## Frontend Discovery
Inspect:
- React architecture.
- TypeScript configuration.
- Pages and routes.
- Components.
- Hooks.
- State management.
- Context providers.
- API services.
- Form implementations.
- Validation libraries.
- Authentication state.
- Permission-based rendering.
- File uploads and downloads.
- Error boundaries.

## Backend Discovery
Inspect:
- NestJS modules.
- Controllers.
- Services.
- Providers.
- Guards.
- Interceptors.
- Middleware.
- DTOs.
- Validation pipes.
- Decorators.
- Exception filters.
- Authentication strategies.
- API endpoints.
- Background jobs.
- External integrations.

## Database Discovery
Inspect:
- PostgreSQL schemas.
- Tables and relationships.
- ORM configuration.
- Migrations.
- Constraints.
- Indexes.
- Database roles.
- Transactions.
- Queries.
- Data retention.
- Backup mechanisms.

## Infrastructure Discovery
Inspect:
- Environment variables.
- Docker configuration, if applicable.
- Deployment configuration.
- CI/CD workflows.
- Logging.
- Monitoring.
- File storage.
- Third-party integrations.
- Secrets management.

Deliverables:
- SYSTEM_INVENTORY.md
- ARCHITECTURE_ASSESSMENT.md
- MODULE_COVERAGE.md
- API_INVENTORY.md
- DATABASE_INVENTORY.md
- DEPENDENCY_INVENTORY.md

Do not assume modules or features exist without verifying the implementation.

---

# 4. PHASE 2 — HEALTHCARE DATA SECURITY AND PRIVACY

Treat patient records and healthcare information as highly confidential.

Identify:
- Patient personal information.
- Demographic information.
- Medical history.
- Diagnoses.
- Prescriptions.
- Laboratory results.
- Clinical notes.
- Physician records.
- Insurance information.
- Billing and payments.
- Medical documents.
- Other sensitive personal information.

Audit:

1. Patient information confidentiality.
2. Unauthorized patient record access.
3. Cross-patient data exposure.
4. Cross-facility and cross-tenant isolation.
5. Sensitive API response exposure.
6. Patient information in application logs.
7. Patient information in browser storage.
8. Data transmission security.
9. Data export and download restrictions.
10. Data retention and deletion.
11. Backup security.
12. Data access audit trails.
13. Data masking and redaction.
14. Appropriate access to clinical information.

Check applicable Philippine Data Privacy Act requirements and relevant healthcare data protection obligations.

Distinguish technical controls from organizational and legal requirements that require separate verification.

Deliverable:
HEALTHCARE_DATA_PRIVACY_AUDIT.md

---

# 5. PHASE 3 — AUTHENTICATION AND AUTHORIZATION

Audit every authentication and authorization mechanism.

Test:
- Registration.
- Login.
- Logout.
- Password reset.
- Password changes.
- Email verification.
- JWT generation and validation.
- Access token expiration.
- Refresh token rotation.
- Token revocation.
- Session management.
- Account suspension.
- Brute-force protection.
- Account lockout.
- MFA where applicable.

Inspect all existing roles and permissions.

Evaluate:
- Administrator access.
- Doctor access.
- Nurse access.
- Receptionist access.
- Other staff roles.
- Patient access, if applicable.
- Facility-specific permissions.

Test:
- Horizontal privilege escalation.
- Vertical privilege escalation.
- IDOR.
- BOLA.
- BFLA.
- Authentication bypass.
- Unauthorized direct API requests.
- Cross-facility access.
- Access using expired or revoked tokens.

Backend authorization must be authoritative.

Never rely solely on frontend route protection or hidden buttons.

Deliverable:
AUTHENTICATION_AUTHORIZATION_AUDIT.md

---

# 6. PHASE 4 — OWASP SECURITY AND PENETRATION TESTING

Use OWASP Top 10 and OWASP ASVS as the primary application security assessment references.

Inspect:

- SQL Injection.
- NoSQL Injection, if applicable to integrations.
- Cross-Site Scripting (XSS).
- Cross-Site Request Forgery (CSRF).
- Server-Side Request Forgery (SSRF).
- Remote Code Execution (RCE).
- Command Injection.
- Path Traversal.
- Insecure Deserialization.
- Broken Access Control.
- IDOR and BOLA.
- Authentication Bypass.
- Session Hijacking.
- JWT vulnerabilities.
- Open Redirects.
- Security Misconfiguration.
- Cryptographic Failures.
- Information Disclosure.
- Insecure File Uploads.
- Denial of Service risks.

Inspect raw SQL queries, ORM query builders, search functionality, filtering, sorting, report generation, file processing, and external URL handling.

For every finding:
1. Locate the implementation.
2. Identify the affected execution path.
3. Determine exploitability.
4. Validate safely in an isolated environment.
5. Document reproducible evidence.
6. Determine impact.
7. Assign severity.
8. Recommend remediation.

Never attack unauthorized external systems or perform destructive exploitation.

Deliverable:
APPLICATION_SECURITY_AUDIT.md

---

# 7. PHASE 5 — ENCRYPTION AND CRYPTOGRAPHY

Audit all cryptographic implementations.

## Password Security
- Argon2id or appropriately configured bcrypt.
- Password hashing and verification.
- Password reset token security.
- Secure password policies.
- No plaintext password storage.

## Encryption
- HTTPS enforcement.
- TLS 1.2 or later, preferably TLS 1.3.
- Encryption at rest.
- Sensitive field encryption where appropriate.
- Secure file storage.
- Authenticated encryption.
- Data integrity verification.

## Key Management
- No hardcoded encryption keys.
- Secure secrets management.
- Key rotation.
- Key access restrictions.
- Separation of encryption keys from encrypted data.
- No secrets in source control.

## Token Security
- JWT signature validation.
- Algorithm restrictions.
- Issuer and audience validation where applicable.
- Token expiration.
- Refresh token security.
- Secure random token generation.

Prefer established cryptographic libraries and standards. Never invent custom encryption algorithms.

Deliverable:
ENCRYPTION_CRYPTOGRAPHY_AUDIT.md

---

# 8. PHASE 6 — NESTJS BACKEND SECURITY

Inspect:
- Global validation pipes.
- DTO validation.
- Whitelisting.
- Rejection of unexpected properties.
- Authentication guards.
- Authorization guards.
- Custom decorators.
- Exception filters.
- Interceptors.
- Middleware.
- Rate limiting.
- CORS.
- Security headers.
- Response serialization.
- Sensitive field exposure.
- File upload validation.
- Transaction management.
- Error handling.

Verify that every protected endpoint has proper authentication and authorization.

Check whether alternate API routes or service access paths bypass controller-level security assumptions.

Deliverable:
NESTJS_BACKEND_SECURITY_AUDIT.md

---

# 9. PHASE 7 — REACT FRONTEND SECURITY

Inspect:
- Route protection.
- Authentication state.
- Token storage.
- API interceptors.
- Input validation.
- Output encoding.
- DOM manipulation.
- dangerouslySetInnerHTML.
- Third-party scripts.
- Local storage.
- Session storage.
- Sensitive data exposure.
- Error messages.
- Source maps.
- Dependency vulnerabilities.

Ensure frontend checks are supplementary and never replace backend authorization.

Deliverable:
REACT_FRONTEND_SECURITY_AUDIT.md

---

# 10. PHASE 8 — POSTGRESQL DATABASE SECURITY

Inspect:

## Access and Permissions
- Least-privilege database accounts.
- Superuser exposure.
- Network restrictions.
- Database connection security.
- Credential management.
- Migration permissions.

## Query Security
- Parameterized queries.
- Raw SQL queries.
- Unsafe query construction.
- SQL injection.
- User-controlled filters and sorting.

## Data Integrity
- Foreign keys.
- Unique constraints.
- Check constraints.
- Required fields.
- Referential integrity.
- Transaction rollback.
- Cascading deletes.
- Soft deletion.

## Data Isolation
- Patient ownership.
- Facility ownership.
- Tenant boundaries.
- Organization-specific records.
- Row-Level Security, if appropriate.

## Reliability
- Concurrent transactions.
- Race conditions.
- Duplicate operations.
- Deadlocks.
- Database backup.
- Restoration testing.

Deliverable:
POSTGRESQL_DATABASE_SECURITY_AUDIT.md

---

# 11. PHASE 9 — COMPLETE HEALTHCARE E2E FUNCTIONAL AUDIT

Discover all implemented modules before generating tests.

Potential modules include:

- Patient Management.
- Patient Registration.
- Appointment Management.
- Doctor Management.
- Staff Management.
- Consultation.
- Medical Records.
- Diagnosis.
- Prescription Management.
- Laboratory Management.
- Billing and Payments.
- Inventory and Pharmacy.
- Reports and Analytics.
- Facility Management.
- User and Role Management.
- Notifications.
- Document Management.

Only audit modules confirmed to exist.

For each feature, validate:

1. Frontend interaction.
2. Client-side validation.
3. API request.
4. Authentication.
5. Authorization.
6. Server-side validation.
7. Business logic.
8. Database operation.
9. Transaction integrity.
10. API response.
11. Frontend update.
12. Related module consistency.
13. Audit logging.
14. Error handling.

Test:
- Create.
- Read.
- Update.
- Delete.
- Search.
- Filtering.
- Sorting.
- Pagination.
- Reports.
- Exports.
- Notifications.
- File upload and download.
- Dashboard calculations.
- Cross-module dependencies.

Test positive, negative, boundary, unauthorized, duplicate, concurrent, and failure scenarios.

Use Playwright or the existing E2E framework.

Deliverable:
END_TO_END_FUNCTIONAL_AUDIT.md

---

# 12. PHASE 10 — API AND INTEGRATION SECURITY

Build a complete API endpoint inventory.

For every endpoint document:
- Method.
- Path.
- Purpose.
- Authentication.
- Authorization.
- Request parameters.
- Request body.
- Validation.
- Response structure.
- Database operations.
- Side effects.
- Error handling.

Test:
- Missing authentication.
- Invalid tokens.
- Expired tokens.
- Unauthorized roles.
- Unauthorized record IDs.
- Invalid payloads.
- Malformed JSON.
- Excessive request sizes.
- Rate limiting.
- Duplicate requests.
- Unexpected response fields.

Inspect webhooks, payment providers, email services, and third-party integrations where implemented.

Deliverable:
API_SECURITY_TEST_REPORT.md

---

# 13. PHASE 11 — PERFORMANCE AND RELIABILITY

Inspect:
- Slow database queries.
- Missing indexes.
- N+1 queries.
- Unbounded queries.
- Missing pagination.
- Memory leaks.
- API response times.
- Concurrent user operations.
- Background jobs.
- Connection pooling.
- Large uploads.
- Resource exhaustion.
- Service recovery.

Use controlled load testing in staging only.

Deliverable:
PERFORMANCE_RELIABILITY_AUDIT.md

---

# 14. PHASE 12 — AUTOMATED SECURITY TESTING

Use the following recommended tools where compatible with the existing stack.

| Tool | Purpose |
|---|---|
| OWASP ZAP | Dynamic application security testing |
| Semgrep | Static security analysis |
| Gitleaks | Secrets detection |
| npm audit | Dependency scanning |
| Playwright | Browser E2E testing |
| Jest / Vitest | Unit and integration testing |
| Trivy | Container and dependency scanning |
| Burp Suite | Manual security testing |

Additional requirements:

- Review scanner findings manually.
- Distinguish confirmed issues from false positives.
- Record tool versions.
- Record scan dates.
- Record test environment.
- Record coverage and limitations.
- Never claim a scan passed if it was not executed.

Deliverable:
AUTOMATED_SECURITY_SCAN_REPORT.md

---

# 15. PHASE 13 — CODE QUALITY AND ARCHITECTURE AUDIT

Inspect:
- Unused functions.
- Unused imports.
- Unused packages.
- Duplicate implementations.
- Dead code.
- Inconsistent error handling.
- Circular dependencies.
- Inconsistent validation.
- Missing test coverage.
- Poor separation of concerns.
- Insecure coding patterns.
- Excessive database queries.
- Technical debt.

Do not remove code during Stage A.

Document recommendations and possible regression impacts.

Deliverable:
CODE_QUALITY_ARCHITECTURE_AUDIT.md

---

# 16. PHASE 14 — FINDINGS AND VULNERABILITY REGISTER

Every finding must include:

- Unique ID.
- Title.
- Category.
- Severity.
- Affected module.
- Affected file and line.
- Affected endpoint or database object.
- Evidence.
- Reproduction steps.
- Exploitability.
- Business impact.
- Data sensitivity.
- Root cause.
- Recommended remediation.
- Verification method.
- Status.

Severity:

CRITICAL:
Immediate risk of major compromise, unauthorized patient data access, or severe privilege escalation.

HIGH:
Significant confidentiality, integrity, or availability risk.

MEDIUM:
Meaningful but more limited security or functional weakness.

LOW:
Minor security or implementation weakness.

INFORMATIONAL:
Hardening recommendations.

Use CVSS 4.0 when sufficient evidence is available.

Deliverable:
VULNERABILITY_REGISTER.md

---

# 17. PHASE 15 — REMEDIATION ROADMAP

Group findings into batches.

Batch 1: Critical vulnerabilities.

Batch 2: High-severity vulnerabilities and sensitive data exposure.

Batch 3: Authentication, authorization, encryption, and validation weaknesses.

Batch 4: Medium-severity vulnerabilities and functional defects.

Batch 5: Low-severity issues, performance, architecture, and technical debt.

For each item include:
- Finding ID.
- Root cause.
- Proposed solution.
- Affected modules.
- Dependencies.
- Regression risk.
- Required tests.
- Priority.

Do not implement any fix during Stage A.

Deliverable:
REMEDIATION_ROADMAP.md

---

# 18. STAGE A — FINAL AUDIT DOCUMENTATION

Store all audit documentation separately from application source code.

Create:

docs/security-audit/
  README.md
  SYSTEM_INVENTORY.md
  ARCHITECTURE_ASSESSMENT.md
  MODULE_COVERAGE.md
  API_INVENTORY.md
  DATABASE_INVENTORY.md
  DEPENDENCY_INVENTORY.md
  HEALTHCARE_DATA_PRIVACY_AUDIT.md
  AUTHENTICATION_AUTHORIZATION_AUDIT.md
  APPLICATION_SECURITY_AUDIT.md
  ENCRYPTION_CRYPTOGRAPHY_AUDIT.md
  NESTJS_BACKEND_SECURITY_AUDIT.md
  REACT_FRONTEND_SECURITY_AUDIT.md
  POSTGRESQL_DATABASE_SECURITY_AUDIT.md
  END_TO_END_FUNCTIONAL_AUDIT.md
  API_SECURITY_TEST_REPORT.md
  PERFORMANCE_RELIABILITY_AUDIT.md
  AUTOMATED_SECURITY_SCAN_REPORT.md
  CODE_QUALITY_ARCHITECTURE_AUDIT.md
  VULNERABILITY_REGISTER.md
  REMEDIATION_ROADMAP.md
  AUDIT_EXECUTIVE_SUMMARY.md

Do not overwrite existing project documentation.

At the end of Stage A, produce an executive summary containing:

1. Overall security posture.
2. Patient data protection assessment.
3. Confirmed vulnerabilities by severity.
4. Potential and unverified findings.
5. Modules inspected.
6. Endpoints tested.
7. Database entities inspected.
8. Workflows tested.
9. Automated testing results.
10. Functional defects.
11. Areas not tested.
12. Remediation priorities.
13. Production readiness assessment.

Clearly distinguish:
- Verified secure.
- Tested with no issue identified.
- Not tested.
- Incomplete implementation.
- Confirmed vulnerability.

STOP and wait for explicit approval.

---

# 19. STAGE B — APPROVED REMEDIATION

Once approval is granted, use the approved remediation roadmap.

For every finding:

1. Reproduce the issue.
2. Identify the root cause.
3. Review all affected code paths.
4. Implement the smallest reliable fix.
5. Add unit tests.
6. Add integration tests.
7. Add security regression tests.
8. Add E2E tests where appropriate.
9. Run relevant existing tests.
10. Perform code review.
11. Verify the fix.
12. Update documentation.

Preserve existing business functionality and API contracts wherever possible.

Do not make unrelated changes.

Database changes must use reviewed migrations.

Never make unapproved changes directly to production data.

## Security Remediation Targets

- Eliminate confirmed Critical vulnerabilities.
- Resolve High vulnerabilities or obtain documented risk acceptance.
- Enforce backend authorization.
- Protect patient and clinical information.
- Strengthen password and token security.
- Correct encryption weaknesses.
- Strengthen API validation.
- Correct unsafe database queries.
- Secure document handling.
- Improve audit logging.
- Resolve cross-patient and cross-facility data isolation issues.

## Functional Regression Targets

Re-run all affected workflows, including:

- Patient registration.
- Patient record management.
- Appointments.
- Consultations.
- Medical records.
- Diagnoses.
- Prescriptions.
- Laboratory workflows.
- Billing and payments.
- Reports.
- User management.
- Role and permission management.
- Administrative functions.

Only include workflows implemented in the actual application.

---

# 20. SECURITY REGRESSION AND CI/CD INTEGRATION

After remediation, establish recurring security checks.

Integrate appropriate checks into GitHub Actions:

1. TypeScript compilation.
2. ESLint.
3. Unit tests.
4. Integration tests.
5. E2E tests.
6. Dependency vulnerability scanning.
7. Secret scanning.
8. Static application security testing.
9. Build verification.
10. Security regression tests.

Where appropriate, configure pull-request checks to prevent known critical vulnerabilities and failed security tests from reaching deployment.

Do not expose secrets in CI/CD logs.

Keep security testing separate from production systems.

Deliverable:
SECURITY_CICD_RECOMMENDATIONS.md

---

# 21. FINAL RETESTING AND PRODUCTION READINESS

Create:

- REMEDIATION_CHANGELOG.md
- SECURITY_RETEST_REPORT.md
- REGRESSION_TEST_REPORT.md
- UPDATED_VULNERABILITY_REGISTER.md
- PRODUCTION_READINESS_REPORT.md

Use these statuses:

- Open.
- In Progress.
- Fixed - Pending Verification.
- Verified Fixed.
- Accepted Risk.
- Not Reproducible.

A finding can only be marked Verified Fixed after successful retesting.

## Final Acceptance Criteria

- No unresolved Critical vulnerabilities.
- No unresolved High vulnerabilities without documented risk acceptance.
- No unauthorized patient record access in tested scenarios.
- No known cross-facility or cross-patient isolation failures.
- All approved security fixes verified.
- Critical healthcare workflows pass regression tests.
- Database integrity verified.
- Sensitive information appropriately protected.
- Automated tests pass.
- Deployment configuration reviewed.
- Backup and restoration procedures tested.
- Remaining risks documented.

Do not claim that the application is completely secure.

Provide an evidence-based production-readiness recommendation and disclose all testing limitations.

---

# 22. FINAL EXECUTION INSTRUCTIONS

Start with Stage A.

First inspect the repository and understand the actual architecture.

Then perform the audit systematically.

Do not rush to modify the application.

Do not fabricate test results.

Do not assume security mechanisms exist because their packages are installed.

Verify actual implementation and execution paths.

Prioritize patient data confidentiality, integrity, availability, and correct access control.

At the end of Stage A, provide the audit executive summary and remediation roadmap.

STOP.

Wait for explicit approval before proceeding to Stage B.

THE FINAL OBJECTIVE:

Deliver a secure, reliable, maintainable, fully validated Healthcare Management Platform with demonstrable protection against common application attacks, unauthorized access, patient data exposure, and functional failures.