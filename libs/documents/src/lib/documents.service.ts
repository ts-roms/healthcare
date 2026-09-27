import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, actorUserId, asPgError, BusinessRuleError, DATABASE, type Database, type DbExecutor, NotFoundError, PgErrorCode } from "@healthcare/core";
import { and, desc, eq, ne } from "drizzle-orm";
import type { z } from "zod";
import type { ALLOWED_CONTENT_TYPES, createDocumentSchema } from "./document.dto";
import { document, type DocumentCategory, type DocumentRecord } from "./document.schema";
import { OBJECT_STORAGE, type ObjectStorage, type PresignedUpload } from "./object-storage";

const UPLOAD_URL_TTL_SECONDS = 10 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export type DocumentView = Omit<DocumentRecord, "storageKey" | "organizationId">;

/** A document the platform generated (e.g. an archived laboratory report). */
export interface GeneratedDocumentInput {
  /** Chosen by the caller so a retry finds the same document (idempotency). */
  id: string;
  facilityId: string | null;
  patientId: string | null;
  category: DocumentCategory;
  title: string;
  fileName: string;
  contentType: (typeof ALLOWED_CONTENT_TYPES)[number];
  body: Buffer;
}

function toView({ storageKey: _key, organizationId: _org, ...rest }: DocumentRecord): DocumentView {
  return rest;
}

/**
 * Two-step upload: metadata is registered first and the client uploads the
 * bytes directly to object storage with a short-lived presigned URL; the
 * document becomes available only after the server verifies the object.
 */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
  ) {}

  async create(actor: Actor, input: z.infer<typeof createDocumentSchema>): Promise<{ document: DocumentView; upload: PresignedUpload }> {
    const id = crypto.randomUUID();
    // Keys carry no patient data; they are opaque and organization-scoped.
    const storageKey = `org/${actor.organizationId}/documents/${id}`;
    let created: DocumentRecord | undefined;
    try {
      created = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(document)
          .values({
            id,
            organizationId: actor.organizationId,
            facilityId: actor.facilityId ?? null,
            patientId: input.patientId ?? null,
            category: input.category,
            title: input.title,
            fileName: input.fileName,
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
            storageKey,
            createdBy: actor.userId,
          })
          .returning();
        await this.audit.record(tx, actor, {
          action: "document.create",
          resourceType: "document",
          resourceId: id,
          patientId: input.patientId,
          metadata: { category: input.category, contentType: input.contentType, sizeBytes: input.sizeBytes },
        });
        return row;
      });
    } catch (error) {
      // The composite FK rejects a patient from another organization as well as a missing one.
      if (asPgError(error)?.code === PgErrorCode.foreignKeyViolation && input.patientId) throw new NotFoundError("Patient");
      throw error;
    }
    if (!created) throw new Error("Document insert returned no row");
    const upload = await this.storage.presignUpload(storageKey, input.contentType, input.sizeBytes, UPLOAD_URL_TTL_SECONDS);
    return { document: toView(created), upload };
  }

  async completeUpload(actor: Actor, documentId: string): Promise<DocumentView> {
    const record = await this.find(actor.organizationId, documentId);
    if (record.status !== "pending_upload") throw new BusinessRuleError("Upload was already completed", "upload_already_completed");
    const stored = await this.storage.head(record.storageKey);
    if (!stored) throw new BusinessRuleError("The file has not been uploaded yet", "upload_missing");
    if (stored.sizeBytes !== record.sizeBytes) {
      throw new BusinessRuleError("Uploaded file size does not match the declared size", "upload_size_mismatch", {
        declared: record.sizeBytes,
        actual: stored.sizeBytes,
      });
    }
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(document)
        .set({ status: "available", uploadedAt: new Date() })
        .where(and(eq(document.id, documentId), eq(document.status, "pending_upload")))
        .returning();
      if (!updated) throw new BusinessRuleError("Upload was already completed", "upload_already_completed");
      await this.audit.record(tx, actor, {
        action: "document.upload-complete",
        resourceType: "document",
        resourceId: documentId,
        patientId: record.patientId ?? undefined,
      });
      return toView(updated);
    });
  }

  async get(actor: Actor, documentId: string): Promise<DocumentView> {
    return toView(await this.find(actor.organizationId, documentId));
  }

  async listForPatient(actor: Actor, patientId: string, includeArchived: boolean): Promise<DocumentView[]> {
    const conditions = [eq(document.organizationId, actor.organizationId), eq(document.patientId, patientId), ne(document.status, "pending_upload")];
    if (!includeArchived) conditions.push(ne(document.status, "archived"));
    const rows = await this.db
      .select()
      .from(document)
      .where(and(...conditions))
      .orderBy(desc(document.createdAt));
    await this.audit.recordStandalone(actor, {
      action: "document.list",
      resourceType: "document",
      patientId,
      metadata: { count: rows.length },
    });
    return rows.map(toView);
  }

  /** Issues a short-lived download URL. Every issuance is audited as an access. */
  async downloadUrl(actor: Actor, documentId: string): Promise<{ url: string; expiresAt: string }> {
    const record = await this.find(actor.organizationId, documentId);
    if (record.status !== "available") throw new BusinessRuleError("Document is not available for download", "document_unavailable");
    const url = await this.storage.presignDownload(record.storageKey, record.fileName, record.contentType, DOWNLOAD_URL_TTL_SECONDS);
    await this.audit.recordStandalone(actor, {
      action: "document.download",
      resourceType: "document",
      resourceId: documentId,
      patientId: record.patientId ?? undefined,
    });
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString() };
  }

  /**
   * Stores a document the platform generated: the object is written once (never replaced) and the document is
   * recorded as available in the same transaction as the caller's own bookkeeping (`within`). Idempotent by id: a
   * retry after a crash reuses the object already written, or returns the existing document (running `within` again,
   * so it must be idempotent).
   */
  async storeGenerated(actor: Actor, input: GeneratedDocumentInput, within?: (tx: DbExecutor, stored: DocumentView) => Promise<void>): Promise<DocumentView> {
    const [existing] = await this.db
      .select()
      .from(document)
      .where(and(eq(document.organizationId, actor.organizationId), eq(document.id, input.id)));
    if (existing) {
      // Stored by an earlier attempt: the caller's bookkeeping may not have committed (it must be idempotent).
      const view = toView(existing);
      if (within) await this.db.transaction((tx) => within(tx, view));
      return view;
    }
    const storageKey = `org/${actor.organizationId}/documents/${input.id}`;
    await this.storage.putIfAbsent(storageKey, input.body, input.contentType);
    // An earlier attempt may have written the object before failing: record what is stored, not what was rendered now.
    const stored = await this.storage.head(storageKey);
    if (!stored) throw new Error(`Generated document ${input.id} was not stored`);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(document)
        .values({
          id: input.id,
          organizationId: actor.organizationId,
          facilityId: input.facilityId,
          patientId: input.patientId,
          category: input.category,
          title: input.title,
          fileName: input.fileName,
          contentType: input.contentType,
          sizeBytes: stored.sizeBytes,
          storageKey,
          status: "available",
          uploadedAt: new Date(),
          createdBy: actorUserId(actor),
          source: "generated",
        })
        .returning();
      if (!row) throw new Error("Document insert returned no row");
      await this.audit.record(tx, actor, {
        action: "document.generate",
        resourceType: "document",
        resourceId: row.id,
        patientId: row.patientId ?? undefined,
        metadata: { category: row.category, contentType: row.contentType, sizeBytes: row.sizeBytes },
      });
      const view = toView(row);
      await within?.(tx, view);
      return view;
    });
  }

  /**
   * The bytes of an available document, for a caller that has already authorized the access (e.g. the laboratory's
   * archived reports). Audited as a download.
   */
  async content(actor: Actor, documentId: string): Promise<{ document: DocumentView; body: Buffer }> {
    const record = await this.find(actor.organizationId, documentId);
    if (record.status !== "available") throw new BusinessRuleError("Document is not available for download", "document_unavailable");
    const body = await this.storage.get(record.storageKey);
    if (!body) throw new NotFoundError("Stored document");
    await this.audit.recordStandalone(actor, {
      action: "document.download",
      resourceType: "document",
      resourceId: documentId,
      patientId: record.patientId ?? undefined,
    });
    return { document: toView(record), body };
  }

  /** Documents are archived, never deleted; the object is retained per retention policy. */
  async archive(actor: Actor, documentId: string, reason: string): Promise<DocumentView> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(document)
        .set({ status: "archived", archivedAt: new Date(), archivedBy: actor.userId, archiveReason: reason })
        .where(and(eq(document.organizationId, actor.organizationId), eq(document.id, documentId), eq(document.status, "available")))
        .returning();
      if (!updated) throw new NotFoundError("Available document");
      await this.audit.record(tx, actor, {
        action: "document.archive",
        resourceType: "document",
        resourceId: documentId,
        patientId: updated.patientId ?? undefined,
        reason,
      });
      return toView(updated);
    });
  }

  private async find(organizationId: string, documentId: string): Promise<DocumentRecord> {
    const [row] = await this.db
      .select()
      .from(document)
      .where(and(eq(document.organizationId, organizationId), eq(document.id, documentId)));
    if (!row) throw new NotFoundError("Document");
    return row;
  }
}
