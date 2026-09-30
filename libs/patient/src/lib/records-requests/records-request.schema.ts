import { bigint, boolean, date, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0068_medical_certificates_records_requests.sql (records requests) and 0070_record_export.sql
// (copies of the record) and 0074 (the organization's procedure); the migrations are the source of truth.

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** What a patient may ask copies of. */
export const RECORDS_REQUEST_SCOPES = ["consultations", "laboratory", "prescriptions", "dental", "imaging", "certificates", "other"] as const;
export type RecordsRequestScope = (typeof RECORDS_REQUEST_SCOPES)[number];
export const RECORDS_REQUEST_STATUSES = ["submitted", "in_review", "fulfilled", "declined", "withdrawn"] as const;
export type RecordsRequestStatus = (typeof RECORDS_REQUEST_STATUSES)[number];
/** The sections a copy of the record may contain. */
export const RECORD_COPY_SECTIONS = [
  "allergies",
  "consultations",
  "laboratory",
  "prescriptions",
  "care_plans",
  "dental",
  "certificates",
  "documents",
  "immunizations",
  "history",
] as const;
export type RecordCopySection = (typeof RECORD_COPY_SECTIONS)[number];

export const recordsRequestNumberSequence = pgTable("records_request_number_sequence", {
  organizationId: uuid("organization_id").primaryKey(),
  nextValue: bigint("next_value", { mode: "number" }).notNull(),
});

export const recordsRequest = pgTable("records_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  requestNumber: text("request_number").notNull(),
  scope: text("scope").array().$type<RecordsRequestScope[]>().notNull(),
  periodFrom: date("period_from", { mode: "string" }),
  periodTo: date("period_to", { mode: "string" }),
  details: text("details"),
  purpose: text("purpose"),
  status: text("status").$type<RecordsRequestStatus>().notNull().default("submitted"),
  submittedAt: ts("submitted_at").notNull().defaultNow(),
  portalAccountId: uuid("portal_account_id").notNull(),
  reviewStartedAt: ts("review_started_at"),
  reviewStartedBy: uuid("review_started_by"),
  responseNote: text("response_note"),
  closedAt: ts("closed_at"),
  closedBy: uuid("closed_by"),
  version: integer("version").notNull().default(1),
  // 0074: the response date from the organization's own response time, and how the requester's identity was confirmed.
  respondBy: date("respond_by", { mode: "string" }),
  identityCheckMethod: text("identity_check_method"),
  identityCheckedBy: uuid("identity_checked_by"),
  identityCheckedAt: ts("identity_checked_at"),
});
export type RecordsRequestRecord = typeof recordsRequest.$inferSelect;

export const recordsRequestDocument = pgTable(
  "records_request_document",
  {
    organizationId: uuid("organization_id").notNull(),
    requestId: uuid("request_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    documentId: uuid("document_id").notNull(),
    sharedAt: ts("shared_at").notNull().defaultNow(),
    sharedBy: uuid("shared_by").notNull(),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.documentId] })],
);

export const recordsRequestExport = pgTable("records_request_export", {
  /** The stored PDF's document id. */
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  requestId: uuid("request_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  sections: text("sections").array().$type<RecordCopySection[]>().notNull(),
  periodFrom: date("period_from", { mode: "string" }),
  periodTo: date("period_to", { mode: "string" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

/** The organization's own records-request procedure (0074): response time, identity check, what patients read first. */
export const recordsRequestSetting = pgTable("records_request_setting", {
  organizationId: uuid("organization_id").primaryKey(),
  responseDays: integer("response_days"),
  identityCheckRequired: boolean("identity_check_required").notNull().default(false),
  patientNotice: text("patient_notice"),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
export type RecordsRequestSettingRecord = typeof recordsRequestSetting.$inferSelect;
