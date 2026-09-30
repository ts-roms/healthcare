import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { COMPLIANCE_AREAS, COMPLIANCE_OUTCOMES } from "./compliance.schema";

export const recordComplianceReviewSchema = z.object({
  area: z.enum(COMPLIANCE_AREAS),
  outcome: z.enum(COMPLIANCE_OUTCOMES),
  /** Who reviewed the configuration (e.g. the organization's accountant, pharmacist, pathologist or DPO). */
  reviewerName: z.string().trim().min(2).max(120),
  reviewerRole: z.string().trim().min(2).max(120),
  /** The issuances or engagement the review was made against, as the reviewer wrote them. */
  reference: z.string().trim().min(3).max(500),
  reviewedOn: z.iso.date(),
  note: z.string().trim().max(1000).optional(),
});
export class RecordComplianceReviewDto extends createZodDto(recordComplianceReviewSchema) {}
