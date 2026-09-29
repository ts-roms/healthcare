import { createHash } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  asPgError,
  DATABASE,
  type Database,
  DomainEventHandlers,
  type DomainEventRecord,
  NotFoundError,
  PgErrorCode,
  systemActor,
  filedAsPatient,
} from "@healthcare/core";
import { DocumentsService } from "@healthcare/documents";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { labOrder, labReportArchive, type LabReportArchiveRecord, labResult } from "../laboratory.schema";
import { found } from "../laboratory-support";
import { LabReportService } from "./lab-report";

/** Hands an archive to background rendering (BullMQ in production). */
export interface LabReportArchiveQueue {
  enqueue(archiveId: string): Promise<void>;
}
export const LAB_REPORT_ARCHIVE_QUEUE = Symbol("LAB_REPORT_ARCHIVE_QUEUE");

/**
 * Attempts, over queue retries and re-queueing, before an archive is parked as failed (shown to staff; support can set
 * it back to pending).
 */
export const LAB_REPORT_ARCHIVE_MAX_ATTEMPTS = 8;
const RECONCILE_AFTER_MINUTES = 10;

export interface ArchivedReportView {
  id: string;
  orderId: string;
  orderNumber: string;
  archiveVersion: number;
  resultCount: number;
  corrected: boolean;
  status: LabReportArchiveRecord["status"];
  createdAt: Date;
  storedAt: Date | null;
}

/**
 * Keeps a copy of each released laboratory report in private object storage,
 * as a document of the patient. A release records `LaboratoryReportReleased`
 * with the set of released result versions; this handler turns it into an
 * archive row (one per order and set: a correction makes a new set, so a new
 * archived version) and queues it; the queue consumer renders the PDF and
 * stores it through the documents library. Stored archives never change.
 */
@Injectable()
export class LabReportArchive implements OnModuleInit {
  private readonly logger = new Logger(LabReportArchive.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly handlers: DomainEventHandlers,
    private readonly reports: LabReportService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    @Inject(LAB_REPORT_ARCHIVE_QUEUE) private readonly queue: LabReportArchiveQueue,
  ) {}

  onModuleInit(): void {
    this.handlers.on("LaboratoryReportReleased", "laboratory.archive-report", (event) => this.schedule(event));
  }

  /** Outbox handler (at-least-once): records the archive once per order and result set, then queues it. */
  async schedule(event: DomainEventRecord): Promise<void> {
    const orderId = event.payload["orderId"];
    const resultIds = event.payload["resultIds"];
    if (typeof orderId !== "string" || !Array.isArray(resultIds) || resultIds.length === 0) return;
    const ids = [...new Set(resultIds.map(String))].sort();
    const key = resultSetKey(ids);
    let archive = await this.findByKey(event.organizationId, orderId, key);
    if (!archive) {
      try {
        archive = await this.db.transaction(async (tx) => {
          const [order] = await tx
            .select()
            .from(labOrder)
            .where(and(eq(labOrder.organizationId, event.organizationId), eq(labOrder.id, orderId)));
          const current = found(order, "Laboratory order");
          const versions = await tx
            .select({ versionNumber: labResult.versionNumber })
            .from(labResult)
            .where(and(eq(labResult.orderId, orderId), inArray(labResult.id, ids)));
          const [{ next } = { next: 1 }] = await tx
            .select({ next: sql<number>`coalesce(max(${labReportArchive.archiveVersion}), 0)::int + 1` })
            .from(labReportArchive)
            .where(eq(labReportArchive.orderId, orderId));
          const [row] = await tx
            .insert(labReportArchive)
            .values({
              organizationId: current.organizationId,
              facilityId: current.facilityId,
              patientId: current.patientId,
              orderId,
              archiveVersion: next,
              resultIds: ids,
              resultSetKey: key,
              corrected: versions.some((v) => v.versionNumber > 1),
            })
            .returning();
          const created = found(row, "Laboratory report archive");
          await this.audit.record(tx, systemActor(created.organizationId, created.facilityId, "lab-report-archive"), {
            action: "lab.report.archive.schedule",
            resourceType: "lab_order",
            resourceId: orderId,
            patientId: created.patientId,
            metadata: { archiveId: created.id, version: created.archiveVersion, results: ids.length },
          });
          return created;
        });
      } catch (error) {
        // Another instance recorded the same set first (or the same version number): the outbox retries, and finds it.
        if (asPgError(error)?.code === PgErrorCode.uniqueViolation) throw new Error("Archive recorded concurrently; retrying");
        throw error;
      }
    }
    if (archive.status === "pending") await this.queue.enqueue(archive.id);
  }

  /**
   * Queue consumer: renders the report for the archived result set and stores it once. Returns what happened;
   * throws to have the queue retry (after LAB_REPORT_ARCHIVE_MAX_ATTEMPTS the archive is parked as failed).
   */
  async process(archiveId: string): Promise<"stored" | "skipped"> {
    const [row] = await this.db.select().from(labReportArchive).where(eq(labReportArchive.id, archiveId));
    if (!row || row.status !== "pending") return "skipped";
    const actor = systemActor(row.organizationId, row.facilityId, "lab-report-archive");
    try {
      const { filename, pdf } = await this.reports.archivedReport(row.organizationId, row.orderId, row.resultIds, row.archiveVersion);
      const orderNumber = filename.replace(/-v\d+\.pdf$/, "");
      await this.documents.storeGenerated(
        actor,
        {
          // The document's id is the archive's: a retry finds (and never duplicates) it.
          id: row.id,
          facilityId: row.facilityId,
          patientId: row.patientId,
          category: "laboratory_report",
          title: `Laboratory report ${orderNumber} (version ${row.archiveVersion})`,
          fileName: filename,
          contentType: "application/pdf",
          body: pdf,
        },
        async (tx, stored) => {
          const now = new Date();
          const [updated] = await tx
            .update(labReportArchive)
            .set({ status: "stored", documentId: stored.id, storedAt: now, updatedAt: now, attempts: sql`${labReportArchive.attempts} + 1`, lastError: null })
            .where(and(eq(labReportArchive.id, row.id), eq(labReportArchive.status, "pending")))
            .returning({ id: labReportArchive.id });
          // Already finished by a concurrent attempt.
          if (!updated) return;
          await this.audit.record(tx, actor, {
            action: "lab.report.archive",
            resourceType: "lab_order",
            resourceId: row.orderId,
            patientId: row.patientId,
            metadata: { archiveId: row.id, documentId: stored.id, version: row.archiveVersion, sizeBytes: stored.sizeBytes },
          });
        },
      );
      return "stored";
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      const attempts = row.attempts + 1;
      const failed = attempts >= LAB_REPORT_ARCHIVE_MAX_ATTEMPTS;
      await this.db
        .update(labReportArchive)
        .set({ attempts, lastError: message, updatedAt: new Date(), ...(failed ? { status: "failed" as const } : {}) })
        .where(and(eq(labReportArchive.id, row.id), eq(labReportArchive.status, "pending")));
      this.logger.warn(`Archiving laboratory report ${row.id} attempt ${attempts} failed${failed ? " permanently" : ""}: ${message}`);
      throw error;
    }
  }

  /** Pending archives whose job may have been lost (enqueue failed after the outbox handler, worker restart). */
  async findStranded(): Promise<string[]> {
    const rows = await this.db
      .select({ id: labReportArchive.id })
      .from(labReportArchive)
      .where(and(eq(labReportArchive.status, "pending"), lte(labReportArchive.updatedAt, new Date(Date.now() - RECONCILE_AFTER_MINUTES * 60_000))))
      .limit(200);
    return rows.map((r) => r.id);
  }

  /** The patient's archived reports, newest first (audited as an access to the list). */
  async listForPatient(actor: Actor, patientId: string): Promise<ArchivedReportView[]> {
    const rows = await this.db
      .select({ archive: labReportArchive, orderNumber: labOrder.orderNumber })
      .from(labReportArchive)
      .innerJoin(labOrder, eq(labOrder.id, labReportArchive.orderId))
      .where(and(eq(labReportArchive.organizationId, actor.organizationId), filedAsPatient(labReportArchive.patientId, patientId)))
      .orderBy(desc(labReportArchive.createdAt), desc(labReportArchive.archiveVersion))
      .limit(200);
    await this.audit.recordStandalone(actor, {
      action: "lab.report.archive.list",
      resourceType: "lab_order",
      patientId,
      metadata: { count: rows.length },
    });
    return rows.map(({ archive, orderNumber }) => ({
      id: archive.id,
      orderId: archive.orderId,
      orderNumber,
      archiveVersion: archive.archiveVersion,
      resultCount: archive.resultIds.length,
      corrected: archive.corrected,
      status: archive.status,
      createdAt: archive.createdAt,
      storedAt: archive.storedAt,
    }));
  }

  /** The stored PDF of one archived report (audited here and by the documents library). */
  async download(actor: Actor, archiveId: string): Promise<{ filename: string; pdf: Buffer }> {
    const [row] = await this.db
      .select()
      .from(labReportArchive)
      .where(and(eq(labReportArchive.organizationId, actor.organizationId), eq(labReportArchive.id, archiveId)));
    if (!row?.documentId || row.status !== "stored") throw new NotFoundError("Archived laboratory report");
    const { document, body } = await this.documents.content(actor, row.documentId);
    await this.audit.recordStandalone(actor, {
      action: "lab.report.archive.download",
      resourceType: "lab_order",
      resourceId: row.orderId,
      patientId: row.patientId,
      metadata: { archiveId: row.id, version: row.archiveVersion },
    });
    return { filename: document.fileName, pdf: body };
  }

  private async findByKey(organizationId: string, orderId: string, key: string): Promise<LabReportArchiveRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(labReportArchive)
      .where(and(eq(labReportArchive.organizationId, organizationId), eq(labReportArchive.orderId, orderId), eq(labReportArchive.resultSetKey, key)));
    return row;
  }
}

/** SHA-256 of the sorted result version ids: the archive's idempotency key. */
export function resultSetKey(sortedIds: string[]): string {
  return createHash("sha256").update(sortedIds.join(",")).digest("hex");
}
