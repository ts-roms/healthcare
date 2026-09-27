import { date, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0021_philhealth_claims.sql (the migration is the source of truth).

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const philhealthFacilityAccreditation = pgTable("philhealth_facility_accreditation", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  accreditationNumber: text("accreditation_number").notNull(),
  validFrom: date("valid_from", { mode: "string" }),
  validUntil: date("valid_until", { mode: "string" }),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const EXCHANGE_STATUSES = ["queued", "accepted", "rejected", "failed", "not_configured"] as const;
export type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];

export const integrationExchange = pgTable("integration_exchange", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  system: text("system").notNull(),
  operation: text("operation").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  patientId: uuid("patient_id"),
  resourceType: text("resource_type").notNull(),
  resourceId: uuid("resource_id").notNull(),
  status: text("status").$type<ExchangeStatus>().notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  payloadDigest: text("payload_digest").notNull(),
  externalReference: text("external_reference"),
  outcomeDetail: jsonb("outcome_detail").$type<Record<string, unknown>>().notNull().default({}),
  lastError: text("last_error"),
  requestedBy: uuid("requested_by").notNull(),
  requestedAt: ts("requested_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
});

export type AccreditationRecord = typeof philhealthFacilityAccreditation.$inferSelect;
export type IntegrationExchangeRecord = typeof integrationExchange.$inferSelect;
