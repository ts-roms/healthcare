import { bigint, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0047_reference_laboratory.sql (the migration is the source of truth).

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const SEND_OUT_STATUSES = ["prepared", "dispatched", "results_received", "rejected", "cancelled"] as const;
export type SendOutStatus = (typeof SEND_OUT_STATUSES)[number];

export const labReferenceLaboratory = pgTable("lab_reference_laboratory", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  /** As recorded by staff (e.g. from the laboratory's licence); not verified. */
  accreditationReference: text("accreditation_reference"),
  notes: text("notes"),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const labTestReferral = pgTable(
  "lab_test_referral",
  {
    facilityId: uuid("facility_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    testId: uuid("test_id").notNull(),
    referenceLaboratoryId: uuid("reference_laboratory_id").notNull(),
    turnaroundMinutes: integer("turnaround_minutes"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.facilityId, t.testId] })],
);

export const labSendOutManifestSequence = pgTable("lab_send_out_manifest_sequence", {
  organizationId: uuid("organization_id").primaryKey(),
  nextValue: bigint("next_value", { mode: "number" }).notNull(),
});

export const labSendOutDispatch = pgTable("lab_send_out_dispatch", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  referenceLaboratoryId: uuid("reference_laboratory_id").notNull(),
  manifestNumber: text("manifest_number").notNull(),
  courier: text("courier").notNull(),
  courierReference: text("courier_reference"),
  dispatchedAt: ts("dispatched_at").notNull(),
  dispatchedBy: uuid("dispatched_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  electronicReference: text("electronic_reference"),
  electronicAcknowledgedAt: ts("electronic_acknowledged_at"),
});

export const labSendOut = pgTable("lab_send_out", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  orderId: uuid("order_id").notNull(),
  orderItemId: uuid("order_item_id").notNull(),
  specimenId: uuid("specimen_id").notNull(),
  referenceLaboratoryId: uuid("reference_laboratory_id").notNull(),
  status: text("status").$type<SendOutStatus>().notNull().default("prepared"),
  turnaroundMinutes: integer("turnaround_minutes"),
  preparedAt: ts("prepared_at").notNull().defaultNow(),
  preparedBy: uuid("prepared_by").notNull(),
  dispatchId: uuid("dispatch_id"),
  dispatchedAt: ts("dispatched_at"),
  referenceAccession: text("reference_accession"),
  resultsReceivedAt: ts("results_received_at"),
  resultsReceivedBy: uuid("results_received_by"),
  rejectedAt: ts("rejected_at"),
  rejectedBy: uuid("rejected_by"),
  rejectionReason: text("rejection_reason"),
  cancelledAt: ts("cancelled_at"),
  cancelledBy: uuid("cancelled_by"),
  cancellationReason: text("cancellation_reason"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type LabReferenceLaboratoryRecord = typeof labReferenceLaboratory.$inferSelect;
export type LabTestReferralRecord = typeof labTestReferral.$inferSelect;
export type LabSendOutDispatchRecord = typeof labSendOutDispatch.$inferSelect;
export type LabSendOutRecord = typeof labSendOut.$inferSelect;
