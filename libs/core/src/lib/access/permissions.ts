/**
 * Permission catalog. Must match the `permission` table (database/migrations);
 * the API verifies this at startup. Adding a permission requires a migration.
 */
export const PERMISSIONS = [
  'organization.read',
  'organization.manage',
  'user.read',
  'user.manage',
  'role.manage',
  'patient.search',
  'patient.read',
  'patient.register',
  'patient.update',
  'patient.consent.manage',
  'document.read',
  'document.upload',
  'document.archive',
  'notification.send',
  'notification.read',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
