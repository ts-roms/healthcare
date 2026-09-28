import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import { type Actor, BusinessRuleError, DATABASE, type Database, type DbExecutor, NotFoundError, requireFacilityId } from "@healthcare/core";
import { type ALLOWED_CONTENT_TYPES, DocumentsService, type PresignedUpload } from "@healthcare/documents";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { canSeeUnreleased } from "../lab-read-model";
import { labResult, labResultAttachment, type LabResultAttachmentRecord, type LabResultRecord } from "../laboratory.schema";

const MANAGED = { managedBy: "laboratory" } as const;

export interface AttachmentView {
  id: string;
  resultId: string;
  title: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: LabResultAttachmentRecord["status"];
  createdAt: Date;
  attachedAt: Date | null;
}

export interface StartAttachmentInput {
  title: string;
  fileName: string;
  contentType: (typeof ALLOWED_CONTENT_TYPES)[number];
  sizeBytes: number;
}

export function attachmentView(a: LabResultAttachmentRecord): AttachmentView {
  return {
    id: a.id,
    resultId: a.resultId,
    title: a.title,
    fileName: a.fileName,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    status: a.status,
    createdAt: a.createdAt,
    attachedAt: a.attachedAt,
  };
}

/** Attached (and, for laboratory staff, pending) attachments of these result versions, for result views. */
export async function attachmentsOf(executor: DbExecutor, actor: Actor, resultIds: string[]): Promise<Map<string, AttachmentView[]>> {
  const out = new Map<string, AttachmentView[]>();
  if (resultIds.length === 0) return out;
  const rows = await executor
    .select()
    .from(labResultAttachment)
    .where(
      and(
        eq(labResultAttachment.organizationId, actor.organizationId),
        inArray(labResultAttachment.resultId, resultIds),
        ne(labResultAttachment.status, "removed"),
      ),
    )
    .orderBy(asc(labResultAttachment.createdAt));
  for (const row of rows) {
    if (row.status !== "attached" && !canSeeUnreleased(actor)) continue;
    out.set(row.resultId, [...(out.get(row.resultId) ?? []), attachmentView(row)]);
  }
  return out;
}

/**
 * Files attached to a result version: instrument printouts, images, an outsourced laboratory's report. The file is a
 * private document managed by the laboratory (never listed or served by the generic documents API, nor exported), so
 * the laboratory's visibility rules apply to it: before release only laboratory staff see it. Attachments are added or
 * removed only while the version is entered; from verification on they are part of what was verified, approved and
 * released, and never change (the database refuses it too). A correction is a new version with its own attachments.
 *
 * Upload in two steps, as for documents: `start` registers the attachment and returns a presigned PUT; `complete`
 * checks the stored object and attaches it.
 */
@Injectable()
export class LabResultAttachments {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  async start(actor: Actor, resultId: string, input: StartAttachmentInput): Promise<{ attachment: AttachmentView; upload: PresignedUpload }> {
    const result = await this.editableResult(this.db, actor, resultId);
    const { document, upload } = await this.documents.create(
      actor,
      {
        category: "clinical_attachment",
        title: input.title,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        patientId: result.patientId,
      },
      MANAGED,
    );
    const attachment = await this.db.transaction(async (tx) => {
      await this.editableResult(tx, actor, resultId, { lock: true });
      const [row] = await tx
        .insert(labResultAttachment)
        .values({
          organizationId: result.organizationId,
          facilityId: result.facilityId,
          patientId: result.patientId,
          resultId,
          documentId: document.id,
          title: input.title,
          fileName: input.fileName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          createdBy: actor.userId,
        })
        .returning();
      await this.audit.record(tx, actor, {
        action: "lab.result.attachment.add",
        resourceType: "lab_result",
        resourceId: resultId,
        patientId: result.patientId,
        metadata: { attachmentId: row!.id, documentId: document.id, contentType: input.contentType, sizeBytes: input.sizeBytes },
      });
      return row!;
    });
    return { attachment: attachmentView(attachment), upload };
  }

  /** Verifies the uploaded object and attaches it to the (still entered) result version. */
  async complete(actor: Actor, attachmentId: string): Promise<AttachmentView> {
    const current = await this.find(actor, attachmentId);
    if (current.status !== "pending") throw new BusinessRuleError(`The attachment is ${current.status}`, "attachment_not_pending");
    await this.editableResult(this.db, actor, current.resultId);
    await this.documents.completeUpload(actor, current.documentId, MANAGED);
    return this.db.transaction(async (tx) => {
      await this.editableResult(tx, actor, current.resultId, { lock: true });
      const [row] = await tx
        .update(labResultAttachment)
        .set({ status: "attached", attachedAt: new Date() })
        .where(and(eq(labResultAttachment.id, attachmentId), eq(labResultAttachment.status, "pending")))
        .returning();
      if (!row) throw new BusinessRuleError("The attachment is no longer pending", "attachment_not_pending");
      await this.audit.record(tx, actor, {
        action: "lab.result.attachment.attach",
        resourceType: "lab_result",
        resourceId: row.resultId,
        patientId: row.patientId,
        metadata: { attachmentId, documentId: row.documentId },
      });
      return attachmentView(row);
    });
  }

  /** Takes an attachment off a result that is still entered (kept, with the reason); its document is archived. */
  async remove(actor: Actor, attachmentId: string, reason: string): Promise<AttachmentView> {
    const current = await this.find(actor, attachmentId);
    if (current.status === "removed") throw new BusinessRuleError("The attachment was already removed", "attachment_removed");
    const removed = await this.db.transaction(async (tx) => {
      await this.editableResult(tx, actor, current.resultId, { lock: true });
      const [row] = await tx
        .update(labResultAttachment)
        .set({ status: "removed", removedAt: new Date(), removedBy: actor.userId, removalReason: reason })
        .where(and(eq(labResultAttachment.id, attachmentId), ne(labResultAttachment.status, "removed")))
        .returning();
      if (!row) throw new BusinessRuleError("The attachment was already removed", "attachment_removed");
      await this.audit.record(tx, actor, {
        action: "lab.result.attachment.remove",
        resourceType: "lab_result",
        resourceId: row.resultId,
        patientId: row.patientId,
        reason,
        metadata: { attachmentId, documentId: row.documentId },
      });
      return row;
    });
    // A file that never finished uploading has no available document to archive.
    if (current.status === "attached") await this.documents.archive(actor, current.documentId, reason, MANAGED);
    return attachmentView(removed);
  }

  /** The attachments of a result version the actor may see (released, or any version for laboratory staff). */
  async list(actor: Actor, resultId: string): Promise<AttachmentView[]> {
    await this.visibleResult(actor, resultId);
    const rows = await this.db
      .select()
      .from(labResultAttachment)
      .where(
        and(
          eq(labResultAttachment.organizationId, actor.organizationId),
          eq(labResultAttachment.resultId, resultId),
          ne(labResultAttachment.status, "removed"),
        ),
      )
      .orderBy(asc(labResultAttachment.createdAt));
    return rows.filter((r) => r.status === "attached" || canSeeUnreleased(actor)).map(attachmentView);
  }

  /** A short-lived download link (audited as a document download). */
  async downloadUrl(actor: Actor, attachmentId: string): Promise<{ url: string; expiresAt: string }> {
    const current = await this.find(actor, attachmentId);
    await this.visibleResult(actor, current.resultId);
    if (current.status !== "attached") throw new NotFoundError("Attachment");
    return this.documents.downloadUrl(actor, current.documentId, MANAGED);
  }

  private async find(actor: Actor, attachmentId: string): Promise<LabResultAttachmentRecord> {
    const [row] = await this.db
      .select()
      .from(labResultAttachment)
      .where(and(eq(labResultAttachment.organizationId, actor.organizationId), eq(labResultAttachment.id, attachmentId)));
    if (!row) throw new NotFoundError("Attachment");
    return row;
  }

  /** A result version the actor may change attachments of: this facility's laboratory, still entered. */
  private async editableResult(executor: DbExecutor, actor: Actor, resultId: string, options: { lock?: boolean } = {}): Promise<LabResultRecord> {
    const facilityId = requireFacilityId(actor);
    const query = executor
      .select()
      .from(labResult)
      .where(and(eq(labResult.organizationId, actor.organizationId), eq(labResult.id, resultId)));
    const [result] = options.lock ? await query.for("update") : await query;
    if (!result) throw new NotFoundError("Laboratory result");
    if (result.facilityId !== facilityId) throw new BusinessRuleError("This result belongs to another facility's laboratory", "wrong_facility");
    if (result.status !== "entered") {
      throw new BusinessRuleError(
        `The result is ${result.status}: attachments are added or removed only before verification (correct the result to change them)`,
        "result_not_editable",
      );
    }
    return result;
  }

  /** Before release a result (and its files) is the laboratory's own; afterwards clinicians with lab.result.read see it. */
  private async visibleResult(actor: Actor, resultId: string): Promise<LabResultRecord> {
    const [result] = await this.db
      .select()
      .from(labResult)
      .where(and(eq(labResult.organizationId, actor.organizationId), eq(labResult.id, resultId)));
    if (!result || (!result.releasedAt && !canSeeUnreleased(actor))) throw new NotFoundError("Laboratory result");
    return result;
  }
}
