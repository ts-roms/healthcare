import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { OUTSIDE_RESULT_RECEIVED_FROM, OUTSIDE_RESULT_SOURCE_KINDS } from "./outside-result.schema";

/** Files a result from an outside laboratory or hospital: the uploaded report and what it says about itself. */
export const recordOutsideResultSchema = z.object({
  /** The report, uploaded for this patient with category `outside_result` (two-step upload, then complete). */
  documentId: z.uuid(),
  /** Who performed it, as written on the report. */
  sourceName: z.string().trim().min(2, "Name the laboratory or hospital").max(200),
  sourceKind: z.enum(OUTSIDE_RESULT_SOURCE_KINDS),
  /** The day the specimen was taken or the test done, as stated on the report (YYYY-MM-DD). */
  performedOn: z.iso.date(),
  /** The tests as named on the report. */
  tests: z.string().trim().min(2, "Say which tests the report covers").max(500),
  receivedFrom: z.enum(OUTSIDE_RESULT_RECEIVED_FROM),
  notes: z.string().trim().min(1).max(2000).optional(),
});
export class RecordOutsideResultDto extends createZodDto(recordOutsideResultSchema) {}

/** A clinician records that they read the filed report; the note is optional and says nothing the platform acts on. */
export const reviewOutsideResultSchema = z.object({ note: z.string().trim().min(1).max(500).optional() });
export class ReviewOutsideResultDto extends createZodDto(reviewOutsideResultSchema) {}

export const outsideResultInErrorSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(500) });
export class OutsideResultInErrorDto extends createZodDto(outsideResultInErrorSchema) {}
