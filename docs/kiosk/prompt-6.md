# Phase 6 — Complete Security, Integration and E2E Audit

Perform a comprehensive audit of the newly implemented Patient Self-Service Kiosk and Queue Management module.

## Security Audit

Evaluate:

1. Authentication.
2. Authorization.
3. Broken access control.
4. IDOR vulnerabilities.
5. SQL injection.
6. XSS.
7. CSRF where applicable.
8. Session management.
9. Patient information exposure.
10. Sensitive data encryption.
11. API validation.
12. WebSocket authorization.
13. Kiosk device authentication.
14. Rate limiting.
15. Audit log integrity.
16. Printer agent security.
17. Network exposure.

Use safe, controlled testing. Do not perform destructive testing against production systems.

## Queue Integrity Audit

Test:
- Duplicate ticket generation.
- Concurrent ticket generation.
- Concurrent Call Next.
- Duplicate appointment check-in.
- Invalid status transitions.
- Duplicate patient registration.
- Unauthorized priority assignment.
- Unauthorized department transfer.
- Lost WebSocket events.
- Duplicate announcements.

## E2E Testing

Use Playwright.

Test complete journeys:

1. New patient registration.
2. Existing patient check-in.
3. Appointment check-in.
4. Ticket generation.
5. Receptionist calls patient.
6. TV display updates.
7. Voice announcement plays.
8. Patient registration verification.
9. Queue completion.
10. Queue transfer.
11. No-show handling.
12. Printer failure recovery.
13. Session expiration.
14. Network interruption and recovery.
15. Multi-counter concurrency.

## Execution Rules

First generate a comprehensive audit report.

Classify findings:
- Critical.
- High.
- Medium.
- Low.
- Informational.

Provide:
- Evidence.
- Affected files.
- Reproduction steps.
- Business impact.
- Recommended remediation.
- Regression testing requirements.

Do not modify or remediate existing code until I approve the remediation plan.

After approval, fix findings systematically, run tests again, and provide a final audit report.