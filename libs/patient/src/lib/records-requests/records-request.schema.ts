import { bigint, date, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0068_medical_certificates_records_requests.sql (records requests; the migration is the
// source of truth).

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** What a patient may ask copies of. */
export const RECORDS_REQUEST_SCOPES = ["consultations", "laboratory", "prescriptions", "dental", "imaging", "certificates", "other"] as const;
export type RecordsRequestScope = (typeof RECORDS_REQUEST_SCOPES)[number];
export const RECORDS_REQUEST_STATUSES = ["submitted", "in_review", "fulfilled", "declined", "withdrawn"] as const;
export type RecordsRequestStatus = (typeof RECORDS_REQUEST_STATUSES)[number];

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
