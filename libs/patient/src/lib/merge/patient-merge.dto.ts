import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const reason = z.string().trim().min(5, "Give a reason of at least 5 characters").max(1000);

export const mergePreviewQuerySchema = z.object({ into: z.uuid() });

export const mergePatientSchema = z.object({
  /** The record that survives; the path's record is retired into it. */
  survivorPatientId: z.uuid(),
  reason,
  /** Versions of both records as reviewed (optimistic locking). */
  retiredVersion: z.number().int().positive(),
  survivorVersion: z.number().int().positive(),
  /** Codes of every flagged difference the person reviewed (from the preview), e.g. `birth_date`, `deceased_status`. */
  acknowledgedDifferences: z.array(z.string().min(1).max(160)).max(50).default([]),
});

export const unmergePatientSchema = z.object({ reason });

export class MergePreviewQueryDto extends createZodDto(mergePreviewQuerySchema) {}
export class MergePatientDto extends createZodDto(mergePatientSchema) {}
export class UnmergePatientDto extends createZodDto(unmergePatientSchema) {}
