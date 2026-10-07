import { bigint, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export type AuditArchiveStatus = "pending" | "running" | "verified" | "failed";

/**
 * An archive of one closed month of the audit trail in object storage (0110_audit_partitions.sql,
 * docs/runbooks/audit-retention.md). Platform-wide: a partition holds every organization's events.
 */
export const auditArchive = pgTable("audit_archive", {
  id: uuid("id").primaryKey().defaultRandom(),
  partitionName: text("partition_name").notNull(),
  rangeFrom: ts("range_from"),
  rangeTo: ts("range_to").notNull(),
  status: text("status").$type<AuditArchiveStatus>().notNull().default("pending"),
  rowCount: bigint("row_count", { mode: "number" }),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  sha256: text("sha256"),
  storageKey: text("storage_key"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  requestedBy: uuid("requested_by").notNull(),
  requestedAt: ts("requested_at").notNull().defaultNow(),
  startedAt: ts("started_at"),
  heartbeatAt: ts("heartbeat_at"),
  completedAt: ts("completed_at"),
  removedAt: ts("removed_at"),
  removedBy: uuid("removed_by"),
  removalReason: text("removal_reason"),
});
export type AuditArchiveRecord = typeof auditArchive.$inferSelect;
