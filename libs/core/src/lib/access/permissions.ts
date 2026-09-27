/**
 * Permission catalog. Must match the `permission` table (database/migrations);
 * the API verifies this at startup. Adding a permission requires a migration.
 */
export const PERMISSIONS = [
  "organization.read",
  "organization.manage",
  "user.read",
  "user.manage",
  "role.manage",
  "patient.search",
  "patient.read",
  "patient.register",
  "patient.update",
  "patient.consent.manage",
  "document.read",
  "document.upload",
  "document.archive",
  "notification.send",
  "notification.read",
  "audit.read",
  // Phase 2 — clinic (migration 0012)
  "clinic.configure",
  "appointment.read",
  "appointment.manage",
  "clinic.queue.read",
  "clinic.queue.manage",
  "clinic.triage.write",
  "clinical.read",
  "allergy.manage",
  "encounter.read",
  "encounter.write",
  "encounter.sign",
  "encounter.amend",
  "prescription.read",
  "prescription.issue",
  "prescription.cancel",
  "care-plan.read",
  "care-plan.manage",
  "clinic.dashboard.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
