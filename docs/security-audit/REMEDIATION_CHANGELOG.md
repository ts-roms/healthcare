# Remediation changelog (Stage B, started 2026-11-02)

Status vocabulary: Fixed - Pending Verification means the change is made and unit/typecheck/lint/build pass, but the finding is not "Verified Fixed" until the retest (isolated database, integration and E2E suites, scanners) has run. Nothing is committed.

| Register ID | Change | Files | Tests run | Status |
|---|---|---|---|---|
| VR-08 | Re-added `eslint-plugin-react` ^7.37.5 as a root devDependency (needed by `nx.configs["flat/react"]` in `libs/ui`) | `package.json`, `pnpm-lock.yaml` | `nx lint @healthcare/ui`: 0 errors | Fixed - Pending Verification |
| VR-07 | `ContextPool` now handles the pool's `error` event (logs `db.pool_error`, no crash) | `libs/core/src/lib/database/database-context.ts` | New `context-pool.spec.ts`; core suite 64 passed | Fixed - Pending Verification |
| VR-05 | Unhandled-error log no longer prints the raw message of failed database queries (statement and bound parameters); keeps error name, driver cause and stack frames | `libs/core/src/lib/http/safe-error.ts`, `exception.filter.ts` | New `safe-error.spec.ts` (parameters absent from output) | Fixed - Pending Verification. Real drizzle error text not exercised against a live database |
| VR-01 | `next` upgraded to 16.4.3 (>= 16.4.1) in `staff` and `portal` | both `package.json`, lockfile | typecheck, unit (staff 381, portal 91), production build of both: pass | Fixed - Pending Verification. Playwright journeys not run; `pnpm audit` not re-run |
| VR-02 | User administration containment: suspending, resetting the sign-in of, or revoking a role from a member now requires the actor to hold every permission that member holds in the organization (platform administrators exempt); denial audited as `target_outranks_actor` | `libs/auth/src/lib/users.service.ts` (`assertOutranks`) | New case in `apps/api/test/staff-credential-reset.int.spec.ts`; typecheck, lint, unit pass. **The integration test was written but NOT run: Docker/PostgreSQL were not available** | Fixed - Pending Verification (test unexecuted) |

## Not done yet (still Open)

VR-03/04/24 (restricted DB role and RLS enforcement: deployment decisions), VR-06/26 (zod, multer, body-parser, nodemailer upgrades), VR-09 onward (Batches 3 to 5). VR-09 (`grantRole` ignoring the actor's grant scope) is related to VR-02 but was not changed.

## Known limits of this round

- Roles that rely on `user.manage` today to administer an org admin will now be refused; this is intended, but confirm no operational runbook depends on it.
- `assertOutranks` compares permission keys only, not facility scope.
