import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { RECORD_COPY_SECTIONS, RECORDS_REQUEST_SCOPES } from "./records-request.schema";

const calendarDate = z.iso.date();
const version = z.number().int().positive();

export const submitRecordsRequestSchema = z
  .object({
    scope: z.array(z.enum(RECORDS_REQUEST_SCOPES)).min(1, "Choose what you need copies of").max(RECORDS_REQUEST_SCOPES.length),
    periodFrom: calendarDate.optional(),
    periodTo: calendarDate.optional(),
    /** Anything that helps the records office find what is needed. */
    details: z.string().trim().max(1000).optional(),
    /** Why the copies are needed (optional). */
    purpose: z.string().trim().max(300).optional(),
  })
  .refine((v) => !v.periodFrom || !v.periodTo || v.periodTo >= v.periodFrom, { message: "The period ends before it starts", path: ["periodTo"] })
  .refine((v) => !v.scope.includes("other") || (v.details?.length ?? 0) >= 3, { message: "Say what else you need", path: ["details"] });
export class SubmitRecordsRequestDto extends createZodDto(submitRecordsRequestSchema) {}

export const recordsRequestQuerySchema = z.object({ status: z.enum(["open", "closed", "all"]).default("open") });
export class RecordsRequestQueryDto extends createZodDto(recordsRequestQuerySchema) {}

export const startReviewSchema = z.object({ version });
export class StartReviewDto extends createZodDto(startReviewSchema) {}

export const fulfilRecordsRequestSchema = z.object({
  /** Documents of the patient's record to share (at least one). */
  documentIds: z.array(z.uuid()).min(1, "Choose the documents to share").max(50),
  /** How the requester's identity was confirmed (required when the organization's procedure says so). */
  identityCheckMethod: z.string().trim().min(3).max(200).optional(),
  /** A note to the patient (optional). */
  note: z.string().trim().min(3).max(1000).optional(),
  version,
});
export class FulfilRecordsRequestDto extends createZodDto(fulfilRecordsRequestSchema) {}

export const declineRecordsRequestSchema = z.object({
  /** Told to the patient. */
  reason: z.string().trim().min(3, "Say why, in words the patient will read").max(1000),
  version,
});
export class DeclineRecordsRequestDto extends createZodDto(declineRecordsRequestSchema) {}

export const prepareRecordCopySchema = z
  .object({
    /** What the copy contains (the patient's identification is always on its cover). */
    sections: z.array(z.enum(RECORD_COPY_SECTIONS)).min(1, "Choose what the copy contains").max(RECORD_COPY_SECTIONS.length),
    /** Records dated in this period, in the facility's time zone (allergies are the current list whatever the period). */
    periodFrom: calendarDate.optional(),
    periodTo: calendarDate.optional(),
  })
  .refine((v) => !v.periodFrom || !v.periodTo || v.periodTo >= v.periodFrom, { message: "The period ends before it starts", path: ["periodTo"] });
export class PrepareRecordCopyDto extends createZodDto(prepareRecordCopySchema) {}

export const recordsRequestSettingSchema = z.object({
  /** The organization's own response time, in days from submission (none: no response date is shown). */
  responseDays: z.number().int().min(1).max(365).nullable(),
  /** Staff record how they confirmed the requester's identity before sharing. */
  identityCheckRequired: z.boolean(),
  /** What patients read before asking (fees, identification to bring, how answers are given), in the organization's words. */
  patientNotice: z.string().trim().min(10).max(1500).nullable(),
  /** 0 when never set. */
  version: z.number().int().min(0),
});
export class RecordsRequestSettingDto extends createZodDto(recordsRequestSettingSchema) {}
