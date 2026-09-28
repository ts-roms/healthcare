import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "@healthcare/audit";
import {
  type Actor,
  BusinessRuleError,
  ConflictError,
  DATABASE,
  type Database,
  NotFoundError,
  requireFacilityId,
  asPgError,
  PgErrorCode,
} from "@healthcare/core";
import { DocumentsService } from "@healthcare/documents";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { addImageSchema } from "../dental.dto";
import { dentalImage, type DentalImageRecord } from "../dental.schema";
import { found, strip } from "../dental-support";
import { DENTAL_CONTEXT, type DentalContext } from "../ports";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/heic", "image/tiff", "application/dicom"]);

/**
 * Dental radiographs and photos. The file is a private document in object storage (uploaded through
 * `POST /documents`, category "imaging"); this records what it shows. Opening one issues a short-lived signed URL,
 * audited by the documents service.
 */
@Injectable()
export class DentalImagingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
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

  async forPatient(organizationId: string, patientId: string) {
    const rows = await this.db
      .select()
      .from(dentalImage)
      .where(and(eq(dentalImage.organizationId, organizationId), eq(dentalImage.patientId, patientId)))
      .orderBy(desc(dentalImage.takenOn), desc(dentalImage.recordedAt));
    return rows.map(strip);
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
      await this.audit.record(tx, actor, {
        action: "dental.image.entered-in-error",
        resourceType: "dental_image",
        resourceId: imageId,
        patientId: image.patientId,
        reason,
      });
      return strip(row);
    });
  }

  private async find(organizationId: string, imageId: string): Promise<DentalImageRecord> {
    const [row] = await this.db
      .select()
      .from(dentalImage)
      .where(and(eq(dentalImage.organizationId, organizationId), eq(dentalImage.id, imageId)));
    return found(row, "Image");
  }
}
