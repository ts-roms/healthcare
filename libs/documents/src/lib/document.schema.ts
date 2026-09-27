import { bigint, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const DOCUMENT_CATEGORIES = [
  'consent_form',
  'identification',
  'medical_certificate',
  'laboratory_report',
  'imaging',
  'referral_letter',
  'prescription',
  'clinical_attachment',
  'billing',
  'other',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export type DocumentStatus = 'pending_upload' | 'available' | 'archived';

export const document = pgTable('document', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  facilityId: uuid('facility_id'),
  patientId: uuid('patient_id'),
  category: text('category').$type<DocumentCategory>().notNull(),
  title: text('title').notNull(),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  storageKey: text('storage_key').notNull(),
  status: text('status').$type<DocumentStatus>().notNull().default('pending_upload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedBy: uuid('archived_by'),
  archiveReason: text('archive_reason'),
  version: integer('version').notNull().default(1),
});

export type DocumentRecord = typeof document.$inferSelect;
