import { Inject, Injectable } from "@nestjs/common";
import { AuditService, type PatientAuditContext } from "@healthcare/audit";
import {
  type Actor,
  actorUserId,
  asPgError,
  BusinessRuleError,
  DATABASE,
  type Database,
  type DbExecutor,
  NotFoundError,
  isFiledAs,
  PatientMergedError,
  PgErrorCode,
  filedAsPatient,
} from "@healthcare/core";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import type { ALLOWED_CONTENT_TYPES, createDocumentSchema } from "./document.dto";
import { document, type DocumentCategory, type DocumentManager, type DocumentRecord } from "./document.schema";
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
  /** Upload types, plus CSV for server-generated tables (management reports); uploads keep their own list. */
  contentType: (typeof ALLOWED_CONTENT_TYPES)[number] | "text/csv";
  body: Buffer;
}

/**
 * Which documents a call may touch. Omitted (the documents API, consent forms, FHIR…): ordinary documents only. A
 * managing domain passes its own name to reach the documents it manages — and applies its own access rules first.
 */
export interface DocumentScope {
  managedBy?: DocumentManager | null;
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

  /**
   * Readiness probe (docs/architecture/observability.md): a head of a key that never exists, which fails only when
   * object storage cannot be reached or refuses the credentials. Not audited; no document is read.
   */
  async probeStorage(): Promise<"ok" | "unreachable"> {
    try {
      await this.storage.head("healthcheck/probe");
      return "ok";
    } catch {
      return "unreachable";
    }
  }

  async create(
    actor: Actor,
    input: z.infer<typeof createDocumentSchema>,
    scope: DocumentScope = {},
  ): Promise<{ document: DocumentView; upload: PresignedUpload }> {
    const id = crypto.randomUUID();
    // Keys carry no patient data; they are opaque and organization-scoped.
    const storageKey = `org/${actor.organizationId}/documents/${id}`;
    let created: DocumentRecord | undefined;
    try {
      created = await this.db.transaction(async (tx) => {
        // Staff uploads go to the surviving record of a merged patient (ADR-0009); domain-managed files of earlier work
        // (e.g. corrections) stay with the record they belong to.
        if (input.patientId && !scope.managedBy) {
          const { rows } = await tx.execute<{ survivor: string | null }>(sql`SELECT patient_canonical_id(${input.patientId}::uuid) AS survivor`);
          const survivor = rows[0]?.survivor;
          if (survivor && survivor !== input.patientId) throw new PatientMergedError(survivor);
        }
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
            managedBy: scope.managedBy ?? null,
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

  async completeUpload(actor: Actor, documentId: string, scope: DocumentScope = {}): Promise<DocumentView> {
    const record = await this.find(actor.organizationId, documentId, scope);
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

  async get(actor: Actor, documentId: string, scope: DocumentScope = {}): Promise<DocumentView> {
    return toView(await this.find(actor.organizationId, documentId, scope));
  }

  /**
   * Titles, categories and statuses of documents by id (no content, no link), for a domain that lists documents it
   * refers to (e.g. those shared in answer to a records request). Not audited: opening one is.
   */
  async describe(
    organizationId: string,
    documentIds: readonly string[],
  ): Promise<Map<string, Pick<DocumentView, "title" | "category" | "status" | "patientId">>> {
    if (!documentIds.length) return new Map();
    const rows = await this.db
      .select({ id: document.id, title: document.title, category: document.category, status: document.status, patientId: document.patientId })
      .from(document)
      .where(and(eq(document.organizationId, organizationId), inArray(document.id, [...new Set(documentIds)])));
    return new Map(rows.map(({ id, ...rest }) => [id, rest]));
  }

  async listForPatient(actor: Actor, patientId: string, includeArchived: boolean): Promise<DocumentView[]> {
    const conditions = [
      eq(document.organizationId, actor.organizationId),
      filedAsPatient(document.patientId, patientId),
      ne(document.status, "pending_upload"),
      // Documents a domain manages are listed by that domain (e.g. attachments of results not yet released).
      isNull(document.managedBy),
    ];
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
  async downloadUrl(actor: Actor, documentId: string, scope: DocumentScope = {}): Promise<{ url: string; expiresAt: string }> {
    const record = await this.find(actor.organizationId, documentId, scope);
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
   * A short-lived download URL for the patient themself (MyHealth), for a document of theirs that the calling domain
   * has decided to release. Audited as the patient's access.
   */
  async downloadUrlForPatient(context: PatientAuditContext, documentId: string): Promise<{ url: string; expiresAt: string }> {
    const record = await this.find(context.organizationId, documentId, {});
    if (!(await isFiledAs(this.db, record.patientId, context.patientId))) throw new NotFoundError("Document");
    if (record.status !== "available") throw new BusinessRuleError("Document is not available for download", "document_unavailable");
    const url = await this.storage.presignDownload(record.storageKey, record.fileName, record.contentType, DOWNLOAD_URL_TTL_SECONDS);
    await this.audit.recordStandalone(context, {
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
  async content(actor: Actor, documentId: string, scope: DocumentScope = {}): Promise<{ document: DocumentView; body: Buffer }> {
    const record = await this.find(actor.organizationId, documentId, scope);
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
  async archive(actor: Actor, documentId: string, reason: string, scope: DocumentScope = {}): Promise<DocumentView> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(document)
        .set({ status: "archived", archivedAt: new Date(), archivedBy: actor.userId, archiveReason: reason })
        .where(and(eq(document.organizationId, actor.organizationId), eq(document.id, documentId), eq(document.status, "available"), managedByIs(scope)))
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

  private async find(organizationId: string, documentId: string, scope: DocumentScope = {}): Promise<DocumentRecord> {
    const [row] = await this.db
      .select()
      .from(document)
      .where(and(eq(document.organizationId, organizationId), eq(document.id, documentId), managedByIs(scope)));
    if (!row) throw new NotFoundError("Document");
    return row;
  }
}

function managedByIs(scope: DocumentScope) {
  return scope.managedBy ? eq(document.managedBy, scope.managedBy) : isNull(document.managedBy);
}
