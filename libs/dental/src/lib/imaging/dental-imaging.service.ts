import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  type DbExecutor,
  DomainEventPublisher,
  NotFoundError,
  requireFacilityId,
  asPgError,
  PgErrorCode,
} from "@healthcare/core";
import { DocumentsService } from "@healthcare/documents";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { addImageSchema } from "../dental.dto";
import { dentalImage, type DentalImageRecord, dentalImageRelease, type DentalImageReleaseRecord } from "../dental.schema";
import { found, strip } from "../dental-support";
import { DENTAL_CONTEXT, type DentalContext } from "../ports";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/heic", "image/tiff", "application/dicom"]);

/**
 * Dental radiographs and photos. The file is a private document in object storage (uploaded through
 * `POST /documents`, category "imaging"); this records what it shows. Opening one issues a short-lived signed URL,
 * audited by the documents service. A dentist can release an image to the patient in MyHealth (and withdraw it);
 * releases are kept as history (`dental_image_release`).
 */
@Injectable()
export class DentalImagingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: DomainEventPublisher,
    private readonly documents: DocumentsService,
    @Inject(DENTAL_CONTEXT) private readonly context: DentalContext,
  ) {}

  async add(actor: Actor, patientId: string, input: z.infer<typeof addImageSchema>) {
    const facilityId = requireFacilityId(actor);
    const document = await this.documents.get(actor, input.documentId);
    if (document.patientId !== patientId) throw new NotFoundError("Document");
    if (document.status !== "available") throw new BusinessRuleError("The file has not finished uploading", "document_unavailable");
    if (document.category !== "imaging" || !IMAGE_TYPES.has(document.contentType)) {
      throw new BusinessRuleError("Only an imaging document (image or DICOM file) can be added", "not_an_image");
    }
    if (input.encounterId) {
      const encounter = await this.context.encounter(actor.organizationId, input.encounterId);
      if (!encounter || encounter.patientId !== patientId) throw new NotFoundError("Encounter");
    }
    try {
      return await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(dentalImage)
          .values({
            organizationId: actor.organizationId,
            facilityId,
            patientId,
            documentId: document.id,
            encounterId: input.encounterId ?? null,
            kind: input.kind,
            teeth: [...new Set(input.teeth)].sort(),
            takenOn: input.takenOn,
            notes: input.notes || null,
            recordedBy: actor.userId,
          })
          .returning();
        const image = found(created, "Image");
        await this.audit.record(tx, actor, {
          action: "dental.image.add",
          resourceType: "dental_image",
          resourceId: image.id,
          patientId,
          metadata: { documentId: document.id, kind: image.kind, teeth: image.teeth },
        });
        return strip(image);
      });
    } catch (error) {
      if (asPgError(error)?.code === PgErrorCode.uniqueViolation)
        throw new ConflictError("This file is already in the dental record", undefined, "image_exists");
      throw error;
    }
  }

  /** The patient's images, each with its active MyHealth release (null when not shared). */
  async forPatient(organizationId: string, patientId: string) {
    const rows = await this.db
      .select()
      .from(dentalImage)
      .where(and(eq(dentalImage.organizationId, organizationId), eq(dentalImage.patientId, patientId)))
      .orderBy(desc(dentalImage.takenOn), desc(dentalImage.recordedAt));
    const releases = await this.activeReleases(
      organizationId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => {
      const release = releases.get(r.id);
      return { ...strip(r), release: release ? { releasedAt: release.releasedAt, releasedBy: release.releasedBy } : null };
    });
  }

  /** Active releases (not withdrawn) by image id. */
  async activeReleases(organizationId: string, imageIds: string[]): Promise<Map<string, DentalImageReleaseRecord>> {
    if (imageIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(dentalImageRelease)
      .where(and(eq(dentalImageRelease.organizationId, organizationId), inArray(dentalImageRelease.imageId, imageIds), isNull(dentalImageRelease.withdrawnAt)));
    return new Map(rows.map((r) => [r.imageId, r]));
  }

  /**
   * Shares an image with the patient in MyHealth. They see it only while the organization shares dental records
   * (dental settings); an image entered in error cannot be released.
   */
  async release(actor: Actor, imageId: string) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(dentalImage)
        .where(and(eq(dentalImage.organizationId, actor.organizationId), eq(dentalImage.id, imageId)))
        .for("update");
      const image = found(current, "Image");
      if (image.status !== "recorded") throw new BusinessRuleError("This image was marked entered in error", "image_entered_in_error");
      const [active] = await tx
        .select({ id: dentalImageRelease.id })
        .from(dentalImageRelease)
        .where(and(eq(dentalImageRelease.imageId, imageId), isNull(dentalImageRelease.withdrawnAt)));
      if (active) throw new ConflictError("This image is already shared in MyHealth", undefined, "image_released");
      const [release] = await tx.insert(dentalImageRelease).values({ organizationId: actor.organizationId, imageId, releasedBy: actor.userId }).returning();
      await this.audit.record(tx, actor, {
        action: "dental.image.release",
        resourceType: "dental_image",
        resourceId: imageId,
        patientId: image.patientId,
        metadata: { releaseId: release!.id },
      });
      await this.events.record(tx, {
        type: "DentalImageReleased",
        organizationId: actor.organizationId,
        aggregateType: "dental_image",
        aggregateId: imageId,
        facilityId: image.facilityId,
        patientId: image.patientId,
        payload: { releaseId: release!.id },
      });
      return { imageId, releasedAt: release!.releasedAt };
    });
  }

  /** Stops sharing an image in MyHealth (with a reason); the release stays in the history. */
  async withdraw(actor: Actor, imageId: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const image = found(
        (
          await tx
            .select()
            .from(dentalImage)
            .where(and(eq(dentalImage.organizationId, actor.organizationId), eq(dentalImage.id, imageId)))
        )[0],
        "Image",
      );
      const withdrawn = await this.endRelease(tx, actor, imageId, reason);
      if (!withdrawn) throw new NotFoundError("Active release");
      await this.audit.record(tx, actor, {
        action: "dental.image.withdraw",
        resourceType: "dental_image",
        resourceId: imageId,
        patientId: image.patientId,
        reason,
      });
      return { imageId, withdrawnAt: withdrawn.withdrawnAt };
    });
  }

  /** A short-lived link to open the image (the documents service audits each one). */
  async link(actor: Actor, imageId: string) {
    const image = await this.find(actor.organizationId, imageId);
    if (image.status !== "recorded") throw new BusinessRuleError("This image was marked entered in error", "image_entered_in_error");
    return this.documents.downloadUrl(actor, image.documentId);
  }

  async markEnteredInError(actor: Actor, imageId: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(dentalImage)
        .where(and(eq(dentalImage.organizationId, actor.organizationId), eq(dentalImage.id, imageId)))
        .for("update");
      const image = found(current, "Image");
      if (image.status !== "recorded") throw new BusinessRuleError("The image is already marked entered in error", "already_entered_in_error");
      const [row] = (await tx
        .update(dentalImage)
        .set({ status: "entered_in_error", enteredInErrorReason: reason, enteredInErrorAt: new Date(), enteredInErrorBy: actor.userId })
        .where(eq(dentalImage.id, imageId))
        .returning()) as [DentalImageRecord];
      // An image entered in error is no longer shared with the patient.
      const withdrawn = await this.endRelease(tx, actor, imageId, "Image entered in error");
      await this.audit.record(tx, actor, {
        action: "dental.image.entered-in-error",
        resourceType: "dental_image",
        resourceId: imageId,
        patientId: image.patientId,
        reason,
        metadata: withdrawn ? { releaseWithdrawn: true } : undefined,
      });
      return strip(row);
    });
  }

  private async endRelease(tx: DbExecutor, actor: Actor, imageId: string, reason: string) {
    const [row] = await tx
      .update(dentalImageRelease)
      .set({ withdrawnAt: new Date(), withdrawnBy: actor.userId, withdrawReason: reason })
      .where(and(eq(dentalImageRelease.organizationId, actor.organizationId), eq(dentalImageRelease.imageId, imageId), isNull(dentalImageRelease.withdrawnAt)))
      .returning();
    return row;
  }

  private async find(organizationId: string, imageId: string): Promise<DentalImageRecord> {
    const [row] = await this.db
      .select()
      .from(dentalImage)
      .where(and(eq(dentalImage.organizationId, organizationId), eq(dentalImage.id, imageId)));
    return found(row, "Image");
  }
}
