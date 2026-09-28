import { bigint, boolean, date, integer, numeric, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0015_laboratory.sql, 0030_lab_report_archive.sql and 0040_lab_result_attachments.sql (the migrations are the source of truth).

export const RESULT_TYPES = ["numeric", "text", "coded"] as const;
export type ResultType = (typeof RESULT_TYPES)[number];
export const ORDER_SOURCES = ["clinic", "telemedicine", "dental", "external", "patient_request"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];
export const ORDER_PRIORITIES = ["routine", "stat", "scheduled"] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];
export type OrderStatus = "active" | "completed" | "cancelled";
export type OrderItemStatus = "pending_collection" | "collected" | "received" | "resulted" | "released" | "cancelled";
export type SpecimenStatus = "collected" | "received" | "rejected" | "stored" | "disposed";
export type SpecimenEventType = "collected" | "received" | "rejected" | "recollection_requested" | "routed" | "stored" | "disposed";
export type ResultStatus = "entered" | "verified" | "approved" | "released" | "superseded" | "cancelled";
export type ResultFlag = "normal" | "low" | "high" | "critical_low" | "critical_high" | "abnormal";
export const COMMUNICATION_METHODS = ["phone", "in_person", "secure_message", "other"] as const;
export type CriticalAlertStatus = "open" | "communicated" | "acknowledged";
type CatalogStatus = "active" | "inactive";

const decimal = (name: string) => numeric(name, { mode: "number" });

export const labDepartment = pgTable("lab_department", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  status: text("status").$type<CatalogStatus>().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const labSpecimenType = pgTable("lab_specimen_type", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  container: text("container"),
  collectionInstructions: text("collection_instructions"),
  status: text("status").$type<CatalogStatus>().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const labTest = pgTable("lab_test", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  departmentId: uuid("department_id").notNull(),
  specimenTypeId: uuid("specimen_type_id").notNull(),
  loincCode: text("loinc_code"),
  resultType: text("result_type").$type<ResultType>().notNull(),
  unit: text("unit"),
  decimalPlaces: smallint("decimal_places"),
  codedValues: text("coded_values").array().notNull().default([]),
  abnormalCodedValues: text("abnormal_coded_values").array().notNull().default([]),
  turnaroundMinutes: integer("turnaround_minutes"),
  requiresFasting: boolean("requires_fasting").notNull().default(false),
  patientReleasable: boolean("patient_releasable").notNull().default(true),
  collectionInstructions: text("collection_instructions"),
  status: text("status").$type<CatalogStatus>().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const labReferenceRange = pgTable("lab_reference_range", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  testId: uuid("test_id").notNull(),
  sex: text("sex").$type<"male" | "female">(),
  ageMinDays: integer("age_min_days").notNull().default(0),
  ageMaxDays: integer("age_max_days"),
  low: decimal("low"),
  high: decimal("high"),
  criticalLow: decimal("critical_low"),
  criticalHigh: decimal("critical_high"),
  textRange: text("text_range"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export const labPanel = pgTable("lab_panel", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  status: text("status").$type<CatalogStatus>().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const labPanelTest = pgTable(
  "lab_panel_test",
  {
    organizationId: uuid("organization_id").notNull(),
    panelId: uuid("panel_id").notNull(),
    testId: uuid("test_id").notNull(),
    position: smallint("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.panelId, t.testId] })],
);

export const labFacilityPolicy = pgTable("lab_facility_policy", {
  facilityId: uuid("facility_id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  allowSelfVerification: boolean("allow_self_verification").notNull().default(false),
  allowSelfApproval: boolean("allow_self_approval").notNull().default(false),
  releaseOnApproval: boolean("release_on_approval").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const labOrderNumberSequence = pgTable("lab_order_number_sequence", {
  organizationId: uuid("organization_id").primaryKey(),
  nextValue: bigint("next_value", { mode: "number" }).notNull(),
});

export const labAccessionSequence = pgTable(
  "lab_accession_sequence",
  {
    facilityId: uuid("facility_id").notNull(),
    accessionDate: date("accession_date").notNull(),
    nextValue: integer("next_value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.facilityId, t.accessionDate] })],
);

export const labOrder = pgTable("lab_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  encounterId: uuid("encounter_id"),
  orderingPractitionerId: uuid("ordering_practitioner_id"),
  externalOrderer: text("external_orderer"),
  orderNumber: text("order_number").notNull(),
  source: text("source").$type<OrderSource>().notNull(),
  priority: text("priority").$type<OrderPriority>().notNull().default("routine"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  clinicalIndication: text("clinical_indication"),
  notes: text("notes"),
  fastingRequired: boolean("fasting_required").notNull().default(false),
  status: text("status").$type<OrderStatus>().notNull().default("active"),
  orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull().defaultNow(),
  orderedBy: uuid("ordered_by").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by"),
  cancellationReason: text("cancellation_reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const labSpecimen = pgTable("lab_specimen", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  orderId: uuid("order_id").notNull(),
  specimenTypeId: uuid("specimen_type_id").notNull(),
  accessionNumber: text("accession_number").notNull(),
  status: text("status").$type<SpecimenStatus>().notNull().default("collected"),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
  collectedBy: uuid("collected_by").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  receivedBy: uuid("received_by"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectedBy: uuid("rejected_by"),
  rejectionReason: text("rejection_reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const labSpecimenEvent = pgTable("lab_specimen_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  specimenId: uuid("specimen_id").notNull(),
  event: text("event").$type<SpecimenEventType>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  actorUserId: uuid("actor_user_id").notNull(),
  reason: text("reason"),
});

export const labOrderItem = pgTable("lab_order_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  orderId: uuid("order_id").notNull(),
  testId: uuid("test_id").notNull(),
  testCode: text("test_code").notNull(),
  testName: text("test_name").notNull(),
  panelId: uuid("panel_id"),
  panelCode: text("panel_code"),
  specimenId: uuid("specimen_id"),
  status: text("status").$type<OrderItemStatus>().notNull().default("pending_collection"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by"),
  cancellationReason: text("cancellation_reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const labResult = pgTable("lab_result", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  orderId: uuid("order_id").notNull(),
  orderItemId: uuid("order_item_id").notNull(),
  testId: uuid("test_id").notNull(),
  versionNumber: smallint("version_number").notNull(),
  supersedesResultId: uuid("supersedes_result_id"),
  correctionReason: text("correction_reason"),
  status: text("status").$type<ResultStatus>().notNull().default("entered"),
  resultType: text("result_type").$type<ResultType>().notNull(),
  valueNumeric: decimal("value_numeric"),
  valueText: text("value_text"),
  valueCoded: text("value_coded"),
  unit: text("unit"),
  flag: text("flag").$type<ResultFlag>(),
  critical: boolean("critical").notNull().default(false),
  referenceRangeId: uuid("reference_range_id"),
  refLow: decimal("ref_low"),
  refHigh: decimal("ref_high"),
  refCriticalLow: decimal("ref_critical_low"),
  refCriticalHigh: decimal("ref_critical_high"),
  refText: text("ref_text"),
  comment: text("comment"),
  method: text("method"),
  instrument: text("instrument"),
  patientReleasable: boolean("patient_releasable").notNull(),
  enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
  enteredBy: uuid("entered_by").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: uuid("verified_by"),
  selfVerified: boolean("self_verified").notNull().default(false),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: uuid("approved_by"),
  selfApproved: boolean("self_approved").notNull().default(false),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  releasedBy: uuid("released_by"),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by"),
  cancellationReason: text("cancellation_reason"),
});

export const labCriticalAlert = pgTable("lab_critical_alert", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  resultId: uuid("result_id").notNull(),
  status: text("status").$type<CriticalAlertStatus>().notNull().default("open"),
  raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
  communicatedAt: timestamp("communicated_at", { withTimezone: true }),
  communicatedBy: uuid("communicated_by"),
  communicatedTo: text("communicated_to"),
  communicationMethod: text("communication_method").$type<(typeof COMMUNICATION_METHODS)[number]>(),
  readBackConfirmed: boolean("read_back_confirmed"),
  communicationNote: text("communication_note"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedBy: uuid("acknowledged_by"),
});

export type LabReportArchiveStatus = "pending" | "stored" | "failed";

export const labReportArchive = pgTable("lab_report_archive", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  orderId: uuid("order_id").notNull(),
  archiveVersion: smallint("archive_version").notNull(),
  resultIds: uuid("result_ids").array().notNull(),
  resultSetKey: text("result_set_key").notNull(),
  corrected: boolean("corrected").notNull().default(false),
  status: text("status").$type<LabReportArchiveStatus>().notNull().default("pending"),
  documentId: uuid("document_id"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  storedAt: timestamp("stored_at", { withTimezone: true }),
});

export type LabResultAttachmentStatus = "pending" | "attached" | "removed";

/** A file attached to a result version (the file is a laboratory-managed document); see migration 0040. */
export const labResultAttachment = pgTable("lab_result_attachment", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  resultId: uuid("result_id").notNull(),
  documentId: uuid("document_id").notNull(),
  title: text("title").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  status: text("status").$type<LabResultAttachmentStatus>().notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  attachedAt: timestamp("attached_at", { withTimezone: true }),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  removedBy: uuid("removed_by"),
  removalReason: text("removal_reason"),
});

export type LabDepartmentRecord = typeof labDepartment.$inferSelect;
export type LabSpecimenTypeRecord = typeof labSpecimenType.$inferSelect;
export type LabTestRecord = typeof labTest.$inferSelect;
export type LabReferenceRangeRecord = typeof labReferenceRange.$inferSelect;
export type LabPanelRecord = typeof labPanel.$inferSelect;
export type LabFacilityPolicyRecord = typeof labFacilityPolicy.$inferSelect;
export type LabOrderRecord = typeof labOrder.$inferSelect;
export type LabOrderItemRecord = typeof labOrderItem.$inferSelect;
export type LabSpecimenRecord = typeof labSpecimen.$inferSelect;
export type LabSpecimenEventRecord = typeof labSpecimenEvent.$inferSelect;
export type LabResultRecord = typeof labResult.$inferSelect;
export type LabCriticalAlertRecord = typeof labCriticalAlert.$inferSelect;
export type LabResultAttachmentRecord = typeof labResultAttachment.$inferSelect;
export type LabReportArchiveRecord = typeof labReportArchive.$inferSelect;
