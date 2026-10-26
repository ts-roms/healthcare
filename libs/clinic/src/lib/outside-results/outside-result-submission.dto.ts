import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { OUTSIDE_RESULT_SOURCE_KINDS } from "./outside-result.schema";

/** A patient's own upload: an image or a PDF of the report (ten a day, 10 MB). */
export const SUBMISSION_UPLOAD_CONTENT_TYPES = ["image/jpeg", "image/png", "image/heic", "application/pdf"] as const;
export const MAX_SUBMISSION_UPLOAD_BYTES = 10 * 1024 * 1024;

export const submissionUploadSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((name) => !/[\\/\0]/.test(name), "File name must not contain path separators"),
  contentType: z.enum(SUBMISSION_UPLOAD_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_SUBMISSION_UPLOAD_BYTES, "File is larger than 10 MB"),
});
export class SubmissionUploadDto extends createZodDto(submissionUploadSchema) {}

/** What the patient says about the report they uploaded, in their own words. */
export const submitOutsideResultSchema = z.object({
  documentId: z.uuid(),
  sourceName: z.string().trim().min(2, "Say which laboratory or hospital it is from").max(200),
  tests: z.string().trim().min(2, "Say what the test was").max(500),
  /** The day the test was done, if known (YYYY-MM-DD). */
  performedOn: z.iso.date().optional(),
  notes: z.string().trim().min(1).max(1000).optional(),
});
export class SubmitOutsideResultDto extends createZodDto(submitOutsideResultSchema) {}

/** The records office files the report on the record with its own reading of it. */
export const fileSubmissionSchema = z.object({
  sourceName: z.string().trim().min(2, "Name the laboratory or hospital as written on the report").max(200),
  sourceKind: z.enum(OUTSIDE_RESULT_SOURCE_KINDS),
  performedOn: z.iso.date(),
  tests: z.string().trim().min(2, "Say which tests the report covers").max(500),
  notes: z.string().trim().min(1).max(2000).optional(),
});
export class FileSubmissionDto extends createZodDto(fileSubmissionSchema) {}

/** Why it was not filed, in words the patient reads. */
export const declineSubmissionSchema = z.object({ reason: z.string().trim().min(5, "Give a reason the patient can read").max(500) });
export class DeclineSubmissionDto extends createZodDto(declineSubmissionSchema) {}
