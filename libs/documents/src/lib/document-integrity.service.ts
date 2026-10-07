import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPlatform,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  NotFoundError,
  systemActor,
} from "@healthcare/core";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { checkIntegrity, countOutcome, EMPTY_COUNTS, type IntegrityCounts, type IntegrityOutcome, type StoredBytes } from "./document-integrity.rules";
import {
  document,
  type DocumentCategory,
  documentIntegrityFinding,
  type DocumentIntegrityFindingRecord,
  documentIntegrityRun,
  type DocumentIntegrityRunRecord,
  type IntegrityFindingOutcome,
} from "./document.schema";
import { OBJECT_STORAGE, type ObjectStorage } from "./object-storage";

/** Documents read per page; progress (counts and the cursor) is saved after each page. */
const PAGE_SIZE = 50;
/** Objects read from storage at once within a page. */
const READ_CONCURRENCY = 4;
/** A running review whose heartbeat is older than this was interrupted (e.g. an API restart) and is resumed. */
const STALE_AFTER_MS = 5 * 60_000;
/** Runs (first run and resumptions) before a review is recorded as failed. */
export const INTEGRITY_RUN_MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 15_000;
const FINDINGS_LIMIT = 200;
const SYSTEM_SOURCE = "document-integrity";

export interface IntegrityFindingView {
  id: string;
  runId: string;
  outcome: IntegrityFindingOutcome;
  recordedSha256: string | null;
  computedSha256: string | null;
  foundAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  document: {
    id: string;
    patientId: string | null;
    facilityId: string | null;
    category: DocumentCategory;
    title: string;
    fileName: string;
    status: string;
    source: string;
    managedBy: string | null;
  };
}

/**
 * Integrity review of stored documents (migration 0105, docs/domains/documents.md): the records office asks for the
 * organization's available documents (or those of one category) to be read back from object storage and compared
 * with the SHA-256 recorded when each was stored. The review runs in the background (a poller in the API, one review
 * at a time per organization, resumable from its cursor, safe on several API instances). A mismatch or a missing
 * object becomes a finding that withholds the document from every reader until it is resolved with a note; a
 * document without a recorded hash (stored before 0098) is baselined. Nothing is repaired, replaced or deleted.
 */
@Injectable()
export class DocumentIntegrityService implements OnApplicationShutdown {
  private readonly logger = new Logger(DocumentIntegrityService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
  ) {}

  /** Queues a review of the organization's available documents, all categories or one. */
  async request(actor: Actor, input: { category?: DocumentCategory }) {
    const row = await this.db.transaction(async (tx) => {
      const [inserted] = (await tx
        .insert(documentIntegrityRun)
        .values({ organizationId: actor.organizationId, category: input.category ?? null, requestedBy: actor.userId })
        // One review at a time per organization (document_integrity_run_one_open).
        .onConflictDoNothing()
        .returning()) as DocumentIntegrityRunRecord[];
      if (!inserted) throw new ConflictError("An integrity review is already in progress", undefined, "integrity_run_in_progress");
      await this.audit.record(tx, actor, {
        action: "document.integrity.run",
        resourceType: "document_integrity_run",
        resourceId: inserted.id,
        metadata: { category: input.category ?? null },
      });
      return inserted;
    });
    this.kick();
    return runView(row);
  }

  /** The organization's recent reviews, newest first, and how many findings are open. */
  async list(actor: Actor) {
    const [runs, [open]] = await Promise.all([
      this.db
        .select()
        .from(documentIntegrityRun)
        .where(eq(documentIntegrityRun.organizationId, actor.organizationId))
        .orderBy(desc(documentIntegrityRun.requestedAt))
        .limit(10),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(documentIntegrityFinding)
        .where(and(eq(documentIntegrityFinding.organizationId, actor.organizationId), isNull(documentIntegrityFinding.resolvedAt))),
    ]);
    await this.audit.recordStandalone(actor, { action: "document.integrity.view", resourceType: "organization", resourceId: actor.organizationId });
    return { runs: runs.map(runView), openFindings: open?.count ?? 0 };
  }

  async get(actor: Actor, runId: string) {
    return runView(await this.findRun(actor.organizationId, runId));
  }

  /** Stops a queued or running review where it is; what it checked so far stays recorded. */
  async cancel(actor: Actor, runId: string) {
    return this.db.transaction(async (tx) => {
      const [cancelled] = (await tx
        .update(documentIntegrityRun)
        .set({ status: "cancelled", cancelledBy: actor.userId, completedAt: new Date() })
        .where(
          and(
            eq(documentIntegrityRun.organizationId, actor.organizationId),
            eq(documentIntegrityRun.id, runId),
            inArray(documentIntegrityRun.status, ["queued", "running"]),
          ),
        )
        .returning()) as DocumentIntegrityRunRecord[];
      if (!cancelled) {
        await this.findRun(actor.organizationId, runId);
        throw new BusinessRuleError("This review has already finished", "integrity_run_finished");
      }
      await this.audit.record(tx, actor, { action: "document.integrity.cancel", resourceType: "document_integrity_run", resourceId: runId });
      return runView(cancelled);
    });
  }

  /** Findings, open (oldest first) or resolved (latest first), with the document each is about (metadata only). */
  async findings(actor: Actor, status: "open" | "resolved"): Promise<{ findings: IntegrityFindingView[]; more: boolean }> {
    const rows = await this.db
      .select({ finding: documentIntegrityFinding, document })
      .from(documentIntegrityFinding)
      .innerJoin(document, eq(document.id, documentIntegrityFinding.documentId))
      .where(
        and(
          eq(documentIntegrityFinding.organizationId, actor.organizationId),
          status === "open" ? isNull(documentIntegrityFinding.resolvedAt) : isNotNull(documentIntegrityFinding.resolvedAt),
        ),
      )
      .orderBy(status === "open" ? asc(documentIntegrityFinding.foundAt) : desc(documentIntegrityFinding.resolvedAt))
      .limit(FINDINGS_LIMIT + 1);
    await this.audit.recordStandalone(actor, {
      action: "document.integrity.view",
      resourceType: "organization",
      resourceId: actor.organizationId,
      metadata: { findings: status, count: Math.min(rows.length, FINDINGS_LIMIT) },
    });
    return { findings: rows.slice(0, FINDINGS_LIMIT).map((r) => findingView(r.finding, r.document)), more: rows.length > FINDINGS_LIMIT };
  }

  /**
   * Records what the records office decided about a finding. The document is not changed: it serves again once the
   * finding is resolved; taking it out of use is an archive with a reason, as for any document.
   */
  async resolve(actor: Actor, findingId: string, note: string) {
    return this.db.transaction(async (tx) => {
      const [resolved] = (await tx
        .update(documentIntegrityFinding)
        .set({ resolvedAt: new Date(), resolvedBy: actor.userId, resolutionNote: note })
        .where(
          and(
            eq(documentIntegrityFinding.organizationId, actor.organizationId),
            eq(documentIntegrityFinding.id, findingId),
            isNull(documentIntegrityFinding.resolvedAt),
          ),
        )
        .returning()) as DocumentIntegrityFindingRecord[];
      if (!resolved) {
        const [any] = await tx
          .select({ id: documentIntegrityFinding.id })
          .from(documentIntegrityFinding)
          .where(and(eq(documentIntegrityFinding.organizationId, actor.organizationId), eq(documentIntegrityFinding.id, findingId)));
        if (!any) throw new NotFoundError("Integrity finding");
        throw new BusinessRuleError("This finding was already resolved", "integrity_finding_resolved");
      }
      const [doc] = await tx.select().from(document).where(eq(document.id, resolved.documentId));
      await this.audit.record(tx, actor, {
        action: "document.integrity.resolve",
        resourceType: "document_integrity_finding",
        resourceId: findingId,
        patientId: doc?.patientId ?? undefined,
        reason: note,
        metadata: { documentId: resolved.documentId, outcome: resolved.outcome },
      });
      return findingView(resolved, doc!);
    });
  }

  /** Polls for queued (and interrupted) reviews. Called once at API start-up. */
  start(intervalMs = POLL_INTERVAL_MS): void {
    this.timer ??= setInterval(() => asPlatform("document integrity reviews", () => void this.tick()), intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Runs queued reviews, and resumes interrupted ones, until none remain. Returns how many were run. */
  async runPending(now: () => Date = () => new Date()): Promise<number> {
    let runs = 0;
    for (let row = await this.claim(now()); row; row = await this.claim(now())) {
      await this.run(row);
      runs++;
    }
    return runs;
  }

  // ---- internals -----------------------------------------------------------------------------

  private async findRun(organizationId: string, runId: string): Promise<DocumentIntegrityRunRecord> {
    const [row] = await this.db
      .select()
      .from(documentIntegrityRun)
      .where(and(eq(documentIntegrityRun.organizationId, organizationId), eq(documentIntegrityRun.id, runId)));
    if (!row) throw new NotFoundError("Integrity review");
    return row;
  }

  private kick(): void {
    if (this.timer) void this.tick();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runPending();
    } catch (error) {
      this.logger.error(`Integrity review failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** Claims the oldest queued or interrupted review (SKIP LOCKED: one runner per review across API instances). */
  private async claim(now: Date): Promise<DocumentIntegrityRunRecord | undefined> {
    return this.db.transaction(async (tx) => {
      for (;;) {
        const [row] = await tx
          .select()
          .from(documentIntegrityRun)
          .where(
            or(
              eq(documentIntegrityRun.status, "queued"),
              and(
                eq(documentIntegrityRun.status, "running"),
                or(isNull(documentIntegrityRun.heartbeatAt), lt(documentIntegrityRun.heartbeatAt, new Date(now.getTime() - STALE_AFTER_MS))),
              ),
            ),
          )
          .orderBy(documentIntegrityRun.requestedAt)
          .limit(1)
          .for("update", { skipLocked: true });
        if (!row) return undefined;
        if (row.attempts >= INTEGRITY_RUN_MAX_ATTEMPTS) {
          await this.fail(tx, row, row.lastError ?? "Interrupted too many times");
          continue;
        }
        const [claimed] = (await tx
          .update(documentIntegrityRun)
          .set({ status: "running", attempts: row.attempts + 1, startedAt: row.startedAt ?? now, heartbeatAt: now })
          .where(eq(documentIntegrityRun.id, row.id))
          .returning()) as [DocumentIntegrityRunRecord];
        return claimed;
      }
    });
  }

  private async run(row: DocumentIntegrityRunRecord): Promise<void> {
    try {
      let cursor = row.cursorDocumentId;
      for (;;) {
        const page = await this.db
          .select({ id: document.id, storageKey: document.storageKey, sha256: document.sha256, patientId: document.patientId, facilityId: document.facilityId })
          .from(document)
          .where(
            and(
              eq(document.organizationId, row.organizationId),
              eq(document.status, "available"),
              row.category ? eq(document.category, row.category) : undefined,
              cursor ? gt(document.id, cursor) : undefined,
            ),
          )
          .orderBy(asc(document.id))
          .limit(PAGE_SIZE);
        let counts = EMPTY_COUNTS;
        for (let i = 0; i < page.length; i += READ_CONCURRENCY) {
          const chunk = page.slice(i, i + READ_CONCURRENCY);
          const stored = await Promise.all(chunk.map((d) => this.read(d.storageKey)));
          for (const [j, doc] of chunk.entries()) {
            const outcome = await this.record(row, doc, stored[j]!);
            counts = countOutcome(counts, outcome);
          }
        }
        const last = page.at(-1);
        if (last) cursor = last.id;
        const [progressed] = await this.db
          .update(documentIntegrityRun)
          .set({
            checked: sql`${documentIntegrityRun.checked} + ${counts.checked}`,
            verified: sql`${documentIntegrityRun.verified} + ${counts.verified}`,
            baselined: sql`${documentIntegrityRun.baselined} + ${counts.baselined}`,
            mismatched: sql`${documentIntegrityRun.mismatched} + ${counts.mismatched}`,
            missing: sql`${documentIntegrityRun.missing} + ${counts.missing}`,
            unreadable: sql`${documentIntegrityRun.unreadable} + ${counts.unreadable}`,
            cursorDocumentId: cursor ?? null,
            heartbeatAt: new Date(),
          })
          .where(and(eq(documentIntegrityRun.id, row.id), eq(documentIntegrityRun.status, "running")))
          .returning({ id: documentIntegrityRun.id });
        // Cancelled meanwhile: stop where we are (what was checked stays recorded).
        if (!progressed) return;
        if (page.length < PAGE_SIZE) break;
      }
      await this.db.transaction(async (tx) => {
        const [done] = (await tx
          .update(documentIntegrityRun)
          .set({ status: "completed", lastError: null, completedAt: new Date() })
          .where(and(eq(documentIntegrityRun.id, row.id), eq(documentIntegrityRun.status, "running")))
          .returning()) as DocumentIntegrityRunRecord[];
        if (!done) return;
        await this.audit.record(tx, systemActor(row.organizationId, null, SYSTEM_SOURCE), {
          action: "document.integrity.completed",
          resourceType: "document_integrity_run",
          resourceId: done.id,
          metadata: countsOf(done),
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Integrity review ${row.id} (attempt ${row.attempts}) failed: ${message}`);
      await this.db.transaction(async (tx) => {
        if (row.attempts >= INTEGRITY_RUN_MAX_ATTEMPTS) return this.fail(tx, row, message);
        // Left running: it is resumed from its cursor once its heartbeat is stale (a natural back-off).
        await tx
          .update(documentIntegrityRun)
          .set({ lastError: message.slice(0, 2000), heartbeatAt: new Date() })
          .where(and(eq(documentIntegrityRun.id, row.id), eq(documentIntegrityRun.status, "running")));
      });
    }
  }

  /** The object's bytes, that there are none, or that storage did not answer (never thrown: the review moves on). */
  private async read(storageKey: string): Promise<StoredBytes> {
    try {
      const bytes = await this.storage.get(storageKey);
      return bytes ? { kind: "bytes", bytes } : { kind: "missing" };
    } catch (error) {
      this.logger.warn({ event: "document.integrity_unreadable", reason: error instanceof Error ? error.message : String(error) });
      return { kind: "unreadable" };
    }
  }

  /**
   * Records one document's outcome: its latest status, a baseline hash where none was recorded, and a finding (one
   * open per document) for anything but verified. A new mismatch or missing finding is announced (ids only) so the
   * records office is told.
   */
  private async record(
    run: DocumentIntegrityRunRecord,
    doc: { id: string; sha256: string | null; patientId: string | null; facilityId: string | null },
    stored: StoredBytes,
  ): Promise<IntegrityOutcome> {
    const check = checkIntegrity(doc.sha256, stored);
    const actor = systemActor(run.organizationId, doc.facilityId, SYSTEM_SOURCE);
    await this.db.transaction(async (tx) => {
      await tx
        .update(document)
        .set({
          integrityStatus: check.outcome,
          integrityCheckedAt: new Date(),
          ...(check.outcome === "baselined" ? { sha256: check.computedSha256 } : {}),
        })
        .where(eq(document.id, doc.id));
      if (check.outcome === "baselined") {
        await this.audit.record(tx, actor, {
          action: "document.integrity.baseline",
          resourceType: "document",
          resourceId: doc.id,
          patientId: doc.patientId ?? undefined,
          metadata: { runId: run.id },
        });
      }
      if (check.outcome === "verified" || check.outcome === "baselined") return;
      const [finding] = (await tx
        .insert(documentIntegrityFinding)
        .values({
          organizationId: run.organizationId,
          runId: run.id,
          documentId: doc.id,
          outcome: check.outcome,
          recordedSha256: doc.sha256,
          computedSha256: check.computedSha256,
        })
        // One open finding per document (document_integrity_finding_open): a document still unresolved adds nothing.
        .onConflictDoNothing()
        .returning()) as DocumentIntegrityFindingRecord[];
      if (!finding) return;
      await this.audit.record(tx, actor, {
        action: "document.integrity.finding",
        resourceType: "document_integrity_finding",
        resourceId: finding.id,
        patientId: doc.patientId ?? undefined,
        outcome: "failure",
        metadata: { documentId: doc.id, runId: run.id, outcome: check.outcome },
      });
      if (check.outcome === "unreadable") return;
      await this.events.record(tx, {
        type: "DocumentIntegrityFailed",
        organizationId: run.organizationId,
        aggregateType: "document",
        aggregateId: doc.id,
        facilityId: doc.facilityId,
        patientId: doc.patientId,
        payload: { documentId: doc.id, findingId: finding.id, runId: run.id, outcome: check.outcome },
      });
    });
    return check.outcome;
  }

  private async fail(tx: DbExecutor, row: DocumentIntegrityRunRecord, message: string): Promise<void> {
    const [failed] = (await tx
      .update(documentIntegrityRun)
      .set({ status: "failed", lastError: message.slice(0, 2000), completedAt: new Date() })
      .where(and(eq(documentIntegrityRun.id, row.id), inArray(documentIntegrityRun.status, ["queued", "running"])))
      .returning()) as DocumentIntegrityRunRecord[];
    if (!failed) return;
    await this.audit.record(tx, systemActor(row.organizationId, null, SYSTEM_SOURCE), {
      action: "document.integrity.failed",
      resourceType: "document_integrity_run",
      resourceId: row.id,
      outcome: "failure",
      metadata: countsOf(failed),
    });
  }
}

function countsOf(run: DocumentIntegrityRunRecord): IntegrityCounts {
  return {
    checked: run.checked,
    verified: run.verified,
    baselined: run.baselined,
    mismatched: run.mismatched,
    missing: run.missing,
    unreadable: run.unreadable,
  };
}

function runView(row: DocumentIntegrityRunRecord) {
  const { organizationId: _o, cursorDocumentId: _c, heartbeatAt: _h, attempts: _a, ...rest } = row;
  return rest;
}

function findingView(finding: DocumentIntegrityFindingRecord, doc: typeof document.$inferSelect): IntegrityFindingView {
  return {
    id: finding.id,
    runId: finding.runId,
    outcome: finding.outcome,
    recordedSha256: finding.recordedSha256,
    computedSha256: finding.computedSha256,
    foundAt: finding.foundAt,
    resolvedAt: finding.resolvedAt,
    resolvedBy: finding.resolvedBy,
    resolutionNote: finding.resolutionNote,
    document: {
      id: doc.id,
      patientId: doc.patientId,
      facilityId: doc.facilityId,
      category: doc.category,
      title: doc.title,
      fileName: doc.fileName,
      status: doc.status,
      source: doc.source,
      managedBy: doc.managedBy,
    },
  };
}
