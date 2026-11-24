# Platform console (tenants)

Platform administrators run the platform for every organization on it. The console at staff `/platform` is where they
see each tenant, create a new one and suspend or reactivate one. Everything else stays inside an organization: seeing a
tenant's patients, staff or settings still means being a member of that organization and signing in to it.

## Who can use it

- Platform administrators only (`app_user.is_platform_admin`), on routes marked `@RequirePlatformAdmin()`. Where
  `PLATFORM_ADMIN_MFA_REQUIRED` applies (production by default), the API answers `403 platform_admin_mfa_required`
  until the administrator has two-step verification; the page then points to **My account**.
- The staff navigation shows **Platform** (foot of the sidebar) to platform administrators; the API decides access.

## What it shows

`GET /api/v1/platform/tenants` lists every organization: name, code, status, created, active and total facilities,
active staff members, active patients, active MyHealth accounts and the latest staff sign-in, with totals.
`GET /api/v1/platform/tenants/:id` adds the facilities (name, code, type, place, status), the holders of the built-in
`org_admin` role (name, email, membership and account status, two-step verification, temporary password, last
sign-in) and the status history.

- **No patient's data.** Patient counts from 1 to 4 are shown as `<5` (the management dashboard's small-cell rule,
  `suppressCount`). Staff names and emails appear only for the organization's administrators, so the platform can
  reach the tenant.
- **Composed in the API** (`apps/api/src/app/platform`) from each domain's own figures: organizations and facilities
  (`OrganizationService.platformOrganizations`), staff (`UsersService.platformMemberFigures`,
  `organizationAdministrators`), patients and MyHealth accounts (`PatientReportingQueries.platformFigures`). The
  queries cross organizations on purpose, under the platform scope (`asPlatform`; platform administrator routes are
  stamped with it by `AccessGuard`).
- **Audited:** `platform.tenant.list` in the administrator's own organization; `platform.tenant.view` in the viewed
  organization's trail, so its own administrators can see that the platform looked.

## Creating a tenant

`POST /api/v1/platform/tenants` with the organization (code, name), its first facility and its first administrator,
in **one transaction**:

1. the organization (`organization_code_taken` if the code is in use) and its first facility;
2. the administrator: an email new to the platform gets a staff account with the temporary password given
   (screened against known breached passwords before the transaction; `initial_password_required` without one), which
   they must replace at their first sign-in (`password_change_required`); an existing staff account keeps its own
   password and is only added as a member (`not_a_staff_account` for a patient account);
3. the built-in `org_admin` role.

Every step is audited in the **new organization's** trail (`organization.create`, `facility.create`,
`user.add-member`, `user.role-grant`). The organization code is permanent; patients type it to sign in to MyHealth.
`pnpm db:org:new` (tools/db/new-organization.ts) stays for the first deployment and scripted set-up.

## Suspending and reactivating

`POST /api/v1/platform/tenants/:id/status` with `status` `suspended` or `active`, a reason (10 to 1,000 characters)
and the organization's `version` (optimistic lock; `organization_status_unchanged` when it already has that status;
an archived organization is not changed here).

- **Suspension** sets `organization.status = 'suspended'` and, in the same transaction, ends every staff session
  (`auth_session`) and every MyHealth session (`patient_portal_session`) of the organization, with the reason
  `organization_suspended`. While it lasts, staff sign-in has no active organization (`403`), every staff request is
  refused (`ActorResolver` checks the membership and the organization's status), MyHealth sign-in, activation, password
  reset and pre-registration find no clinic, and every MyHealth request is refused (`PortalAccountService.principalFor`
  joins the organization's status). Kiosk, display and print-agent accounts are staff accounts and stop with it.
  Scheduled outreach campaigns wait (`CrmService.sendDue` skips them) and are sent after a reactivation if still due.
- **Not stopped by a suspension:** background work that finishes what was already recorded (laboratory report
  archives, notification delivery already queued, reminders, the outbox), public payment notifications and the
  outreach opt-out link (a patient can always opt out). Records are not changed, hidden or deleted.
- The organization the administrator is signed in to cannot be suspended from inside it
  (`cannot_suspend_current_organization`); sign in to another organization first.
- **Reactivation** sets it back to `active`. Sessions that ended stay ended; people sign in again.
- Each change is kept in `organization_status_change` (migration `0151`: from, to, reason, who, when; append-only by
  trigger) and audited as `organization.suspend` / `organization.reactivate` in the organization's trail.

## Not built

Archiving or deleting a tenant, editing a tenant's settings from the console, billing of tenants (subscriptions,
invoices), usage beyond the counts above, per-tenant health of integrations and storage, impersonation (signing in as a
tenant's user — deliberately not offered), and telling a tenant's staff or patients about a suspension (the
organization's own communication).
