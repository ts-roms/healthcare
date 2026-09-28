import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "@healthcare/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import { document, type DocumentCategory } from "./document.schema";

export interface PatientDocumentRecord {
  id: string;
  facilityId: string | null;
  category: DocumentCategory;
  title: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: Date;
}

/**
 * A patient's stored documents for a record export (FHIR): metadata of the documents that are available for
 * download and not managed by a domain (laboratory result attachments are served by the laboratory). Pending uploads have no verified file; archived documents are withdrawn from use and their files are no
 * longer served, so neither is exported. Storage keys never leave this library. Not audited here: the caller audits
 * the access it serves (and every download is audited by DocumentsService).
 */
@Injectable()
export class DocumentRecordQueries {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async patientRecord(organizationId: string, patientId: string): Promise<PatientDocumentRecord[]> {
    const rows = await this.db
      .select({
        id: document.id,
        facilityId: document.facilityId,
        category: document.category,
        title: document.title,
        fileName: document.fileName,
        contentType: document.contentType,
        sizeBytes: document.sizeBytes,
        uploadedAt: document.uploadedAt,
      })
      .from(document)
      .where(and(eq(document.organizationId, organizationId), eq(document.patientId, patientId), eq(document.status, "available"), isNull(document.managedBy)))
      .orderBy(asc(document.uploadedAt), asc(document.id));
    // An available document always has its upload time (set when the upload is verified).
    return rows.flatMap((r) => (r.uploadedAt ? [{ ...r, uploadedAt: r.uploadedAt }] : []));
  }
}
