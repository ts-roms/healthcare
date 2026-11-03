# Security audit — Stage A (read-only), 2026-11-02

Start with `AUDIT_EXECUTIVE_SUMMARY.md`, then `VULNERABILITY_REGISTER.md` and `REMEDIATION_ROADMAP.md`. The directive is `docs/audit/SYSTEM-FULL-AUDIT.md`.

| Area                | Report                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Inventory           | SYSTEM_INVENTORY, ARCHITECTURE_ASSESSMENT, MODULE_COVERAGE, DEPENDENCY_INVENTORY                                            |
| API                 | API_INVENTORY, NESTJS_BACKEND_SECURITY_AUDIT, API_SECURITY_TEST_REPORT                                                      |
| Identity and crypto | AUTHENTICATION_AUTHORIZATION_AUDIT, ENCRYPTION_CRYPTOGRAPHY_AUDIT                                                           |
| Application         | APPLICATION_SECURITY_AUDIT, REACT_FRONTEND_SECURITY_AUDIT                                                                   |
| Data                | DATABASE_INVENTORY, POSTGRESQL_DATABASE_SECURITY_AUDIT, HEALTHCARE_DATA_PRIVACY_AUDIT                                       |
| Quality             | END_TO_END_FUNCTIONAL_AUDIT, PERFORMANCE_RELIABILITY_AUDIT, AUTOMATED_SECURITY_SCAN_REPORT, CODE_QUALITY_ARCHITECTURE_AUDIT |

Finding ID prefixes in the area reports: INV, API, AUTH, CRY, APP, FE, DB, PRIV, QA, PERF. The register re-numbers them as VR-nn and merges duplicates.

Limits: static review only; no dynamic tests or security scanners were run. Not yet produced (Stage B, after approval): SECURITY_CICD_RECOMMENDATIONS, REMEDIATION_CHANGELOG, SECURITY_RETEST_REPORT, REGRESSION_TEST_REPORT, UPDATED_VULNERABILITY_REGISTER, PRODUCTION_READINESS_REPORT.
