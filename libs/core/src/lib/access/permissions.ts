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
  "patient.portal.manage",
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
  // Phase 3 — laboratory (migration 0015)
  "lab.catalog.manage",
  "lab.order.read",
  "lab.order.create",
  "lab.order.cancel",
  "lab.specimen.collect",
  "lab.specimen.receive",
  "lab.specimen.reject",
  "lab.result.read",
  "lab.result.enter",
  "lab.result.verify",
  "lab.result.approve",
  "lab.result.release",
  "lab.result.amend",
  "lab.critical.manage",
  "lab.dashboard.read",
  // Phase 5 — telemedicine (migration 0016)
  "telemedicine.read",
  "telemedicine.conduct",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
