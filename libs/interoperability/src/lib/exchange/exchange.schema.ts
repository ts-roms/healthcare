import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Mirrors database/migrations/0021_philhealth_claims.sql, 0022_integration_worker.sql and 0046_integration_payload_keys.sql.

const ts = (name: string) => timestamp(name, { withTimezone: true });

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
  lastAttemptAt: ts("last_attempt_at"),
  resolvedAt: ts("resolved_at"),
  resolvedBy: uuid("resolved_by"),
  resolutionNote: text("resolution_note"),
});

/** The encrypted payload handed from the API to the integration worker; deleted once the exchange is final. */
export const integrationExchangePayload = pgTable("integration_exchange_payload", {
  exchangeId: uuid("exchange_id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  /** The key the payload is sealed with (INTEGRATION_PAYLOAD_KEYS); null for payloads sealed before key ids existed. */
  keyId: text("key_id"),
  ciphertext: text("ciphertext").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type IntegrationExchangeRecord = typeof integrationExchange.$inferSelect;
