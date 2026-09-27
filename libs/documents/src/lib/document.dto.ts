import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { DOCUMENT_CATEGORIES } from "./document.schema";

/** Clinical document formats accepted for upload. */
export const ALLOWED_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/tiff", "application/dicom"] as const;

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export const createDocumentSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES),
  title: z.string().trim().min(1).max(200),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((name) => !/[\\/\0]/.test(name), "File name must not contain path separators"),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_DOCUMENT_BYTES, "File is larger than 50 MB"),
  patientId: z.string().uuid().optional(),
});
export class CreateDocumentDto extends createZodDto(createDocumentSchema) {}

export const listDocumentsSchema = z.object({
  patientId: z.string().uuid(),
  includeArchived: z.enum(["true", "false"]).optional(),
});
export class ListDocumentsDto extends createZodDto(listDocumentsSchema) {}

export const archiveDocumentSchema = z.object({ reason: z.string().trim().min(5).max(500) });
export class ArchiveDocumentDto extends createZodDto(archiveDocumentSchema) {}
