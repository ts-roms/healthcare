# Identity & access (`libs/auth`)

## Purpose
Staff authentication, sessions, MFA, organization membership, roles and
permissions, and the global `AccessGuard`. See also `docs/security/access-control.md`.

## Entities
`app_user`, `organization_membership`, `role` (system templates or
organization-owned), `permission` (catalog), `role_permission`,
`role_assignment` (optional facility/department scope; revocations kept),
`auth_session` (hashed rotating refresh tokens).

## Commands
Login (with organization selection and MFA challenge), verify MFA, refresh,
logout, change password, MFA setup/confirm/disable, add member (creates the
account if new), suspend/reactivate membership, grant/revoke role, create role.

## Queries
`GET /auth/me`, users with role assignments, roles with permissions, permission catalog.

## Events
None published. All actions are audited.

## Permissions
`user.read`, `user.manage`, `role.manage`. Organization creation requires platform admin.

## Integration points
- Reads facilities/departments from `libs/organization` to validate request context.
- `AccessService.resolvePermissions` is the single place permissions are computed.
- `PermissionCatalogCheck` fails startup if the catalog in `libs/core` and the
  `permission` table disagree.
