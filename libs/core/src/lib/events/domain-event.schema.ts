import { bigserial, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const domainEvent = pgTable("domain_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  position: bigserial("position", { mode: "number" }).notNull(),
  organizationId: uuid("organization_id").notNull(),
  eventType: text("event_type").notNull(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  facilityId: uuid("facility_id"),
  patientId: uuid("patient_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  failedAt: timestamp("failed_at", { withTimezone: true }),
});

export type DomainEventRecord = typeof domainEvent.$inferSelect;
