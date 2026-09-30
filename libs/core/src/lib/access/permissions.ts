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
  "patient.portal.proxy.manage",
  // Patient merge (migration 0068)
  "patient.merge",
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
  // Phase 7 — billing (migration 0019)
  "billing.charge.read",
  "billing.charge.capture",
  "billing.invoice.issue",
  "billing.invoice.void",
  "billing.payment.record",
  "billing.refund.issue",
  "billing.discount.apply",
  "billing.pricelist.manage",
  "billing.report.read",
  // Phase 8 — interoperability (migration 0020)
  "interop.fhir.read",
  // Phase 8 — PhilHealth eClaims adapter stubs (migration 0021)
  "philhealth.claim.submit",
  "philhealth.settings.manage",
  // PhilHealth eligibility adapter stubs (migration 0024)
  "philhealth.eligibility.manage",
  // Phase 8 — DOH reporting adapter stubs (migration 0023)
  "doh.report.manage",
  "doh.settings.manage",
  // Integration exchange review (migration 0025)
  "integration.exchange.manage",
  // Billing follow-ups — patient deposits and credit notes (migration 0035).
  // Refunds of deposit or credit balance use billing.refund.issue.
  "billing.deposit.record",
  "billing.credit-note.issue",
  // Billing follow-ups — debit notes (migration 0036).
  "billing.debit-note.issue",
  // Phase 9 — inventory (migration 0026)
  "inventory.read",
  "inventory.move",
  "inventory.adjust",
  "inventory.catalog.manage",
  // Phase 9 — purchase orders (migration 0052); approval is separate from submission
  "inventory.procurement.manage",
  "inventory.procurement.approve",
  // Phase 9 — dispensing from prescriptions (migration 0053)
  "prescription.dispense",
  // Phase 6 — dental (migration 0027)
  "dental.record.read",
  "dental.record.write",
  "dental.chart.write",
  "dental.treatment-plan.manage",
  "dental.procedure.record",
  "dental.imaging.read",
  "dental.imaging.upload",
  "dental.settings.manage",
  // MyHealth dental images: a dentist releases each one explicitly (migration 0058)
  "dental.imaging.release",
  // Phase 9 — laboratory quality control and instruments (migration 0050)
  "lab.qc.read",
  "lab.qc.enter",
  "lab.qc.manage",
  // Phase 8 — FHIR R4 inbound imports into a review queue (migration 0048). Submitting never writes the record;
  // reviewers match the patient and accept or reject each entry.
  "interop.fhir.import",
  "interop.fhir.import.review",
  // Management dashboard: cross-domain operational figures, counts and amounts only (migration 0059).
  "management.dashboard.read",
  // Inventory valuation: stock values and the cost of stock received, used and written off (migration 0061).
  "inventory.valuation.read",
  // Records requests: review patients' requests for copies of their records, share documents or decline (migration 0068).
  "patient.records-request.manage",
  // Two-way messaging: read patients' MyHealth conversations; reply, start, assign, close (migration 0076).
  "patient.message.read",
  "patient.message.manage",
  // Write the organization's consent wording that patients read before giving a consent online (migration 0078).
  "consent.wording.manage",
  // Compliance configuration (migration 0074): who validated each area's configuration; the controlled-item register;
  // document retention periods and their review. No government rule is encoded; values are the organization's.
  "compliance.review.manage",
  "inventory.controlled-register.read",
  "document.retention.manage",
  // Analyzer interfaces: the instrument gateway's integration account submits result messages (migration 0075).
  "lab.instrument.message.submit",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
