# Audit executive summary — Stage A (read-only), 2026-11-02

Scope: the directive in `docs/audit/SYSTEM-FULL-AUDIT.md`. Method: six parallel static reviews of the repository plus the lead's re-check of selected findings. **No dynamic testing was done:** no integration or E2E tests, no load tests, no penetration tests, and none of ZAP, Semgrep, Gitleaks, Trivy or Burp was installed or run. Findings are therefore code-reading results, not exploited vulnerabilities.

## 1. Overall security posture

The design is deliberate and unusually thorough for the size of the system: deny-by-default global guard, Zod validation, Argon2id, JWT algorithm/issuer/audience pinning, refresh rotation with reuse detection, append-only history and audit trail, sealed integration payloads, database-level invariants. The auditors found no SQL injection, no cross-tenant read in 32 sampled routes, and no tracked private or live keys. The main risks are **operational defaults that weaken the strong design** (RLS in `observe`, restricted DB role optional), **one authorization containment gap** (user administration), **an outdated framework with critical advisories**, and **unproven runtime/backup/hardening claims**.

## 2. Patient data protection

Reads of patient data sampled (24 operations) were all audited, and organization scoping held in all routes sampled. Weaker points: PHI can reach logs through unhandled-error stacks and development-mode logging (VR-05, VR-19), government identifiers are unmasked in API responses (VR-18), idempotency records keep PHI response bodies indefinitely (VR-15), and facility-level isolation inside an organization is incomplete for reads (VR-10). Not verified: live RLS behaviour, production encryption at rest/in transit, backup security.

## 3. Confirmed vulnerabilities by severity

"Confirmed" here means re-read by the lead in code; none was exercised.

- Critical: 0 confirmed by exploitation; 1 by advisory (Next.js RCE, VR-01, version confirmed, reachability open).
- High: 7 (VR-02..08); of these, VR-02, VR-07, VR-08 and the existence of the default in VR-04 were re-read by the lead; VR-05's log call was.
- Medium: 21 (VR-09..29). Low/Info: about 40 (see register).

## 4. Potential and unverified findings

Everything marked Reported in the register, the redirect behaviour of the push library (SSRF depth), drizzle parameter inclusion in errors, Terraform not enforcing RLS, and all items under "Not verified" in the register.

## 5-8. Coverage

Modules inspected: all 30 Nx projects (inventory in `MODULE_COVERAGE.md`; claimed features were found present by file/symbol search, behaviour not run). Endpoints: 799 routes inventoried statically (`API_INVENTORY.md`), 0 tested dynamically. Database: 262 tables and about 135 migrations inspected statically. Workflows: none executed this round.

## 9. Automated testing results (executed this session)

| Check                                                       | Result                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `nx run-many -t typecheck`                                  | Passed, all projects                                                                                          |
| `nx run-many -t test` (unit)                                | Passed, 27 projects                                                                                           |
| `nx run-many -t lint`                                       | Failed in `@healthcare/ui` only (missing `eslint-plugin-react`, VR-08); other projects 0 errors with warnings |
| `pnpm audit`                                                | Executed: 6 critical, 33 high, 45 moderate, 10 low advisories (reachability not assessed)                     |
| Circular dependency check                                   | 0 cycles across 30 projects                                                                                   |
| Integration, E2E, load, ZAP, Semgrep, Gitleaks, Trivy, Burp | **Not executed**                                                                                              |

## 10. Functional defects

The CI lint gate is broken (VR-08). Test gaps rather than observed defects: no billing invoice/payment E2E, no pagination or concurrency tests for core lists, no token-tampering tests, thin unit coverage in five libraries (VR-28, VR-29). Documented incomplete implementations (unconfigured PhilHealth/DOH/SMS adapters) are intentional dependencies, listed in the earlier unfinished-features check.

## 11. Areas not tested

Dynamic behaviour of any kind; production deployment configuration, TLS, headers at the edge, CORS; backup restore; realtime socket revocation; load and resilience; the committed `myhealth.apk`; git history for secrets; legal/organizational compliance (needs the organization's own validation).

## 12. Remediation priorities

See `REMEDIATION_ROADMAP.md`. First: VR-08, VR-07, VR-05, VR-01, then VR-02 and the database-role/RLS enforcement (VR-03, VR-04).

## 13. Production readiness

**Not ready for production certification on this evidence.** Controlled pilot use is reasonable only after VR-01, VR-02, VR-03/04, VR-05 and VR-07 are fixed and verified, the restricted database role is confirmed in the deployed environment, and a dynamic test round (integration/E2E on an isolated database, scanners, backup restore) has been completed. This is not a claim that the application is secure.

## Status legend used in the area reports

Verified secure / Tested with no issue / Not tested / Incomplete implementation / Confirmed vulnerability. In Stage A nothing qualifies as "Tested with no issue" dynamically; items described as secure are secure _as read_.

**Stage A ends here. Awaiting explicit approval before any Stage B remediation.**
