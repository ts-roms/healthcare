import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ImportKind } from "./inbound-model";

// Mirrors database/migrations/0048_fhir_import.sql and 0080 (immunizations) (the migrations are the source of truth).

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const FHIR_IMPORT_STATUSES = ["pending_review", "accepted", "partially_accepted", "rejected"] as const;
export type FhirImportStatus = (typeof FHIR_IMPORT_STATUSES)[number];
export const FHIR_IMPORT_ENTRY_OUTCOMES = ["pending", "accepted", "rejected", "not_supported"] as const;
export type FhirImportEntryOutcome = (typeof FHIR_IMPORT_ENTRY_OUTCOMES)[number];
export type FhirImportResultType = "allergy_intolerance" | "external_history_entry" | "immunization" | "patient";

/** A received import: non-PHI metadata and the review state (the content is sealed in fhir_import_content). */
export const fhirImport = pgTable("fhir_import", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  idempotencyKeyDigest: text("idempotency_key_digest").notNull(),
  contentDigest: text("content_digest").notNull(),
  sourceKind: text("source_kind").$type<"bundle" | "resource">().notNull(),
  bundleType: text("bundle_type").$type<"collection" | "document" | "searchset">(),
  declaredSource: text("declared_source"),
  resourceCounts: jsonb("resource_counts").$type<Record<string, number>>().notNull(),
  entryCount: integer("entry_count").notNull(),
  status: text("status").$type<FhirImportStatus>().notNull().default("pending_review"),
  patientId: uuid("patient_id"),
  matchedBy: uuid("matched_by"),
  matchedAt: ts("matched_at"),
  rejectionReason: text("rejection_reason"),
  receivedBy: uuid("received_by").notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
  completedBy: uuid("completed_by"),
  completedAt: ts("completed_at"),
  contentPurgedAt: ts("content_purged_at"),
  version: integer("version").notNull().default(1),
});

/** The received content, sealed with the integration payload key ring ("v2.<key id>.…"). */
export const fhirImportContent = pgTable("fhir_import_content", {
  importId: uuid("import_id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  keyId: text("key_id").notNull(),
  ciphertext: text("ciphertext").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** One received entry: its resource type and review outcome. */
export const fhirImportEntry = pgTable("fhir_import_entry", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  importId: uuid("import_id").notNull(),
  entryIndex: integer("entry_index").notNull(),
  resourceType: text("resource_type").notNull(),
  kind: text("kind").$type<ImportKind>().notNull(),
  outcome: text("outcome").$type<FhirImportEntryOutcome>().notNull(),
  reason: text("reason"),
  resultType: text("result_type").$type<FhirImportResultType>(),
  resultId: uuid("result_id"),
  decidedBy: uuid("decided_by"),
  decidedAt: ts("decided_at"),
});

export type FhirImportRecord = typeof fhirImport.$inferSelect;
export type FhirImportEntryRecord = typeof fhirImportEntry.$inferSelect;
