import { createHash } from "node:crypto";
import { createGzip, gunzipSync } from "node:zlib";
import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  APP_CONFIG,
  type AppConfig,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  NotFoundError,
} from "@healthcare/core";
import { OBJECT_STORAGE, type ObjectStorage } from "@healthcare/documents";
import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { auditArchive, type AuditArchiveRecord } from "./audit-archive.schema";
import { archivable, removable } from "./audit-retention.rules";

const POLL_INTERVAL_MS = 60_000;
const ENSURE_INTERVAL_MS = 24 * 60 * 60_000;
const STALE_AFTER_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
const BATCH = 5_000;
/** Months of partitions kept ready ahead of time (with the current one). */
export const AUDIT_MONTHS_AHEAD = 3;

export interface AuditPartitionView {
  partitionName: string;
  rangeFrom: string | null;
  rangeTo: string | null;
  isDefault: boolean;
  /** The planner's estimate (exact counts are taken when a partition is archived). */
  estimatedRows: number;
  archive: AuditArchiveView | null;
  archivable: boolean;
  removable: boolean;
}

export interface AuditArchiveView {
  id: string;
  status: AuditArchiveRecord["status"];
  rowCount: number | null;
  sizeBytes: number | null;
  sha256: string | null;
  lastError: string | null;
  requestedAt: string;
  completedAt: string | null;
  removedAt: string | null;
  removalReason: string | null;
}

interface PartitionRow extends Record<string, unknown> {
  partition_name: string;
  range_from: Date | null;
  range_to: Date | null;
  is_default: boolean;
  estimated_rows: string | number;
}

/**
 * Audit trail retention (docs/runbooks/audit-retention.md, 0110_audit_partitions.sql): monthly partitions kept ready,
 * archives of closed months written to object storage and verified in the background, and removal of an archived
 * month past the deployment's AUDIT_RETENTION_MONTHS by a separate request. Platform-wide (a month holds every
 * organization's events), so every route is for platform administrators.
 */
@Injectable()
export class AuditRetentionService implements OnApplicationShutdown {
  private readonly logger = new Logger(AuditRetentionService.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
  ) {}

  /** Keeps partitions ready daily and runs requested archives. Called once at API start-up. */
  start(): void {
    if (this.timers.length > 0) return;
    void this.ensurePartitions();
    this.timers.push(setInterval(() => void this.ensurePartitions(), ENSURE_INTERVAL_MS));
    this.timers.push(setInterval(() => void this.tick(), POLL_INTERVAL_MS));
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  /** Creates the partitions of the current and the next months that do not exist yet; returns how many. */
  async ensurePartitions(): Promise<number> {
    try {
      const result = await this.db.execute<{ created: number }>(sql`SELECT ensure_audit_partitions(${AUDIT_MONTHS_AHEAD}) AS created`);
      return Number(result.rows[0]?.created ?? 0);
    } catch (error) {
      this.logger.error({ event: "audit.partitions_failed", message: `Audit partitions were not created: ${String(error)}` });
      return 0;
    }
  }

  async partitions(now = new Date()): Promise<{ retentionMonths: number | null; partitions: AuditPartitionView[] }> {
    const [rows, archives] = await Promise.all([
      this.db.execute<PartitionRow>(sql`SELECT * FROM audit_partitions()`),
      this.db.select().from(auditArchive).where(ne(auditArchive.status, "failed")),
    ]);
    const failed = await this.db.select().from(auditArchive).where(eq(auditArchive.status, "failed")).orderBy(asc(auditArchive.requestedAt));
    const retention = this.config.AUDIT_RETENTION_MONTHS;
    return {
      retentionMonths: retention ?? null,
      partitions: rows.rows.map((row) => {
        const archive =
          archives.find((a) => a.partitionName === row.partition_name) ?? failed.filter((a) => a.partitionName === row.partition_name).at(-1) ?? null;
        const live = archive && archive.status !== "failed" ? { status: archive.status, removedAt: archive.removedAt } : null;
        const state = { rangeTo: row.range_to ? new Date(row.range_to) : null, isDefault: row.is_default, archive: live as never };
        return {
          partitionName: row.partition_name,
          rangeFrom: row.range_from ? new Date(row.range_from).toISOString() : null,
          rangeTo: row.range_to ? new Date(row.range_to).toISOString() : null,
          isDefault: row.is_default,
          estimatedRows: Number(row.estimated_rows),
          archive: archive ? archiveView(archive) : null,
          archivable: archivable(state, now),
          removable: removable(state, now, retention),
        };
      }),
    };
  }

  /** Queues the archive of a closed month; the background runner writes and verifies it. */
  async requestArchive(actor: Actor, partitionName: string, now = new Date()): Promise<AuditArchiveView> {
    const partition = await this.partition(partitionName);
    const existing = await this.liveArchive(this.db, partitionName);
    if (!archivable({ rangeTo: partition.rangeTo, isDefault: partition.isDefault, archive: existing ? { status: "pending", removedAt: null } : null }, now)) {
      if (existing) throw new ConflictError("This month is already archived or being archived", undefined, "audit_archive_exists");
      throw new BusinessRuleError("Only a month that has ended can be archived", "audit_partition_open");
    }
    const row = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(auditArchive)
        .values({ partitionName, rangeFrom: partition.rangeFrom, rangeTo: partition.rangeTo!, requestedBy: actor.userId! })
        .returning();
      await this.audit.record(tx, actor, {
        action: "audit.archive-request",
        resourceType: "audit_archive",
        resourceId: created!.id,
        metadata: { partition: partitionName, rangeTo: partition.rangeTo!.toISOString() },
      });
      return created!;
    });
    this.kick();
    return archiveView(row);
  }

  /** Detaches and drops an archived month past the retention period (as the owner, through the database function). */
  async remove(actor: Actor, partitionName: string, reason: string, now = new Date()): Promise<{ removedEvents: number }> {
    const retention = this.config.AUDIT_RETENTION_MONTHS;
    if (!retention) throw new BusinessRuleError("No audit retention period is set (AUDIT_RETENTION_MONTHS); nothing is removed", "audit_retention_unset");
    const partition = await this.partition(partitionName);
    const archive = await this.liveArchive(this.db, partitionName);
    const state = {
      rangeTo: partition.rangeTo,
      isDefault: partition.isDefault,
      archive: archive ? { status: archive.status as "verified", removedAt: archive.removedAt } : null,
    };
    if (!removable(state, now, retention)) {
      if (archive?.status !== "verified") throw new BusinessRuleError("Archive this month and let the archive be verified first", "audit_not_archived");
      throw new BusinessRuleError(`This month is within the ${retention}-month retention period`, "audit_within_retention");
    }
    return this.db.transaction(async (tx) => {
      let removedEvents: number;
      try {
        const result = await tx.execute<{ removed: string }>(
          sql`SELECT remove_audit_partition(${partitionName}, ${retention}, ${actor.userId}, ${reason}) AS removed`,
        );
        removedEvents = Number(result.rows[0]?.removed ?? 0);
      } catch (error) {
        throw new BusinessRuleError(`The month was not removed: ${(error as Error).message}`, "audit_removal_refused");
      }
      await this.audit.record(tx, actor, {
        action: "audit.partition-remove",
        resourceType: "audit_archive",
        resourceId: archive!.id,
        reason,
        metadata: { partition: partitionName, removedEvents, retentionMonths: retention, sha256: archive!.sha256 },
      });
      return { removedEvents };
    });
  }

  /** The archived file, for a platform administrator to keep or inspect (audited). */
  async download(actor: Actor, archiveId: string): Promise<{ fileName: string; body: Buffer }> {
    const [archive] = await this.db.select().from(auditArchive).where(eq(auditArchive.id, archiveId));
    if (!archive || archive.status !== "verified" || !archive.storageKey) throw new NotFoundError("Audit archive");
    const body = await this.storage.get(archive.storageKey);
    if (!body) throw new BusinessRuleError("The archive file is missing from storage", "audit_archive_missing");
    if (sha256(body) !== archive.sha256) throw new BusinessRuleError("The archive file no longer matches its checksum", "audit_archive_changed");
    await this.audit.recordStandalone(actor, {
      action: "audit.archive-download",
      resourceType: "audit_archive",
      resourceId: archive.id,
      metadata: { partition: archive.partitionName },
    });
    return { fileName: `${archive.partitionName}.jsonl.gz`, body };
  }

  /** Runs requested archives, and resumes interrupted ones, until none remain. Returns how many were finished. */
  async runPending(now: () => Date = () => new Date()): Promise<number> {
    let runs = 0;
    for (let row = await this.claim(now()); row; row = await this.claim(now())) {
      await this.run(row);
      runs++;
    }
    return runs;
  }

  // ---- internals -----------------------------------------------------------------------------

  private kick(): void {
    if (this.timers.length > 0) void this.tick();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runPending();
    } catch (error) {
      this.logger.error({ event: "audit.archive_failed", message: `Audit archive failed: ${String(error)}` });
    } finally {
      this.running = false;
    }
  }

  private async partition(name: string): Promise<{ rangeFrom: Date | null; rangeTo: Date | null; isDefault: boolean }> {
    const result = await this.db.execute<PartitionRow>(sql`SELECT * FROM audit_partitions() WHERE partition_name = ${name}`);
    const row = result.rows[0];
    if (!row) throw new NotFoundError("Audit partition");
    return { rangeFrom: row.range_from ? new Date(row.range_from) : null, rangeTo: row.range_to ? new Date(row.range_to) : null, isDefault: row.is_default };
  }

  private async liveArchive(executor: DbExecutor, partitionName: string): Promise<AuditArchiveRecord | undefined> {
    const [row] = await executor
      .select()
      .from(auditArchive)
      .where(and(eq(auditArchive.partitionName, partitionName), ne(auditArchive.status, "failed")));
    return row;
  }

  /** Claims the oldest requested or interrupted archive (SKIP LOCKED: one runner per archive across API instances). */
  private async claim(now: Date): Promise<AuditArchiveRecord | undefined> {
    return this.db.transaction(async (tx) => {
      for (;;) {
        const [row] = await tx
          .select()
          .from(auditArchive)
          .where(
            or(
              eq(auditArchive.status, "pending"),
              and(
                eq(auditArchive.status, "running"),
                or(isNull(auditArchive.heartbeatAt), lt(auditArchive.heartbeatAt, new Date(now.getTime() - STALE_AFTER_MS))),
              ),
            ),
          )
          .orderBy(asc(auditArchive.requestedAt))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!row) return undefined;
        if (row.attempts >= MAX_ATTEMPTS) {
          await this.fail(tx, row.id, row.lastError ?? "Interrupted too many times");
          continue;
        }
        const [claimed] = await tx
          .update(auditArchive)
          .set({ status: "running", attempts: row.attempts + 1, startedAt: row.startedAt ?? now, heartbeatAt: now })
          .where(eq(auditArchive.id, row.id))
          .returning();
        return claimed;
      }
    });
  }

  /** Exports the month as JSON lines (all columns, oldest first), gzipped; stores it once; reads it back and checks it. */
  private async run(row: AuditArchiveRecord): Promise<void> {
    try {
      // Compressed as it is read, so only the compressed bytes are held in memory.
      const gzip = createGzip();
      const chunks: Buffer[] = [];
      gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
      const finished = new Promise<void>((resolve, reject) => {
        gzip.on("end", resolve);
        gzip.on("error", reject);
      });
      let exported = 0;
      let after: { at: string; id: string } | null = null;
      for (;;) {
        const page: { rows: Array<{ line: string; at: string; id: string }> } = await this.db.execute(sql`
          SELECT row_to_json(e)::text AS line, to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at, e.id::text AS id
          FROM audit_event e
          WHERE e.occurred_at < ${row.rangeTo}
            ${row.rangeFrom ? sql`AND e.occurred_at >= ${row.rangeFrom}` : sql``}
            ${after ? sql`AND (e.occurred_at, e.id) > (${after.at}::timestamptz, ${after.id}::uuid)` : sql``}
          ORDER BY e.occurred_at, e.id
          LIMIT ${BATCH}`);
        if (page.rows.length > 0) gzip.write(page.rows.map((item) => `${item.line}\n`).join(""));
        exported += page.rows.length;
        if (page.rows.length < BATCH) break;
        const last = page.rows.at(-1)!;
        after = { at: last.at, id: last.id };
        await this.db.update(auditArchive).set({ heartbeatAt: new Date() }).where(eq(auditArchive.id, row.id));
      }
      gzip.end();
      await finished;
      const body = Buffer.concat(chunks);
      const digest = sha256(body);
      const storageKey = `audit-archive/${row.partitionName}/${row.id}.jsonl.gz`;
      await this.storage.putIfAbsent(storageKey, body, "application/gzip");
      // Read back: the stored bytes, their checksum and their line count must match what was exported.
      const stored = await this.storage.get(storageKey);
      if (!stored || sha256(stored) !== digest) throw new Error("the stored archive does not match what was written");
      const storedLines = gunzipSync(stored).toString("utf8").split("\n").filter(Boolean).length;
      const [{ count } = { count: -1 }] = (
        await this.db.execute<{ count: string }>(sql`
          SELECT count(*) AS count FROM audit_event
          WHERE occurred_at < ${row.rangeTo} ${row.rangeFrom ? sql`AND occurred_at >= ${row.rangeFrom}` : sql``}`)
      ).rows.map((r) => ({ count: Number(r.count) }));
      if (storedLines !== exported || count !== exported) throw new Error(`row counts differ (exported ${exported}, stored ${storedLines}, now ${count})`);
      await this.db
        .update(auditArchive)
        .set({ status: "verified", rowCount: exported, sizeBytes: body.length, sha256: digest, storageKey, completedAt: new Date(), lastError: null })
        .where(eq(auditArchive.id, row.id));
      this.logger.log({ event: "audit.archived", message: `Archived ${row.partitionName}: ${exported} events` });
    } catch (error) {
      const message = String((error as Error).message ?? error).slice(0, 2000);
      this.logger.error({ event: "audit.archive_failed", message: `Archive of ${row.partitionName} failed: ${message}` });
      await this.db.transaction(async (tx) => {
        const [current] = await tx.select().from(auditArchive).where(eq(auditArchive.id, row.id));
        if (current && current.attempts >= MAX_ATTEMPTS) await this.fail(tx, row.id, message);
        else await tx.update(auditArchive).set({ status: "pending", lastError: message, heartbeatAt: null }).where(eq(auditArchive.id, row.id));
      });
    }
  }

  private async fail(tx: DbExecutor, id: string, message: string): Promise<void> {
    await tx
      .update(auditArchive)
      .set({ status: "failed", lastError: message.slice(0, 2000), completedAt: new Date() })
      .where(and(eq(auditArchive.id, id), inArray(auditArchive.status, ["pending", "running"])));
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function archiveView(row: AuditArchiveRecord): AuditArchiveView {
  return {
    id: row.id,
    status: row.status,
    rowCount: row.rowCount,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    lastError: row.lastError,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    removedAt: row.removedAt?.toISOString() ?? null,
    removalReason: row.removalReason,
  };
}
