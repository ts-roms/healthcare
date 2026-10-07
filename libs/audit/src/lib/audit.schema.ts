import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Partitioned by month on `occurred_at` (0110_audit_partitions.sql), hence the two-column primary key. */
export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid("id").notNull().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    organizationId: uuid("organization_id"),
    facilityId: uuid("facility_id"),
    actorType: text("actor_type").$type<AuditActorType>().notNull(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    patientId: uuid("patient_id"),
    outcome: text("outcome").$type<AuditOutcome>().notNull(),
    reason: text("reason"),
    changes: jsonb("changes").$type<AuditChanges>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    requestId: text("request_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [primaryKey({ columns: [t.id, t.occurredAt] })],
);

export type AuditActorType = "user" | "patient" | "system" | "anonymous";
export type AuditOutcome = "success" | "denied" | "failure";
export type AuditChanges = Record<string, { from: unknown; to: unknown }>;
