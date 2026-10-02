import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_PATIENT_UPLOAD_BYTES,
  MESSAGE_BODY_MAX,
  MESSAGE_SUBJECT_MAX,
  MESSAGE_TOPICS,
  PATIENT_UPLOAD_CONTENT_TYPES,
} from "./patient-message.rules";

const body = z.string().trim().min(1, "Write a message").max(MESSAGE_BODY_MAX, `At most ${MESSAGE_BODY_MAX} characters`);
const subject = z.string().trim().min(1, "Give the message a subject").max(MESSAGE_SUBJECT_MAX, `At most ${MESSAGE_SUBJECT_MAX} characters`);

/** Documents of the patient's record to carry with the message (at most three; migration 0097). */
const documentIds = z.array(z.uuid()).max(MAX_ATTACHMENTS_PER_MESSAGE, `At most ${MAX_ATTACHMENTS_PER_MESSAGE} files`).default([]);

export const startThreadSchema = z.object({ topic: z.enum(MESSAGE_TOPICS), subject, body, documentIds });
export class StartThreadDto extends createZodDto(startThreadSchema) {}

export const replySchema = z.object({ body, documentIds });
export class ReplyDto extends createZodDto(replySchema) {}

/** A patient's own upload in MyHealth: an image or a PDF (migration 0097). */
export const patientUploadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((name) => !/[\\/\0]/.test(name), "File name must not contain path separators"),
  contentType: z.enum(PATIENT_UPLOAD_CONTENT_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_PATIENT_UPLOAD_BYTES, "File is larger than 10 MB"),
});
export class PatientUploadDto extends createZodDto(patientUploadSchema) {}

export const noteSchema = z.object({ body: z.string().trim().min(1, "Write a note").max(MESSAGE_BODY_MAX) });
export class NoteDto extends createZodDto(noteSchema) {}

export const settingsQuerySchema = z.object({ facilityId: z.uuid() });
export class SettingsQueryDto extends createZodDto(settingsQuerySchema) {}

/** Routing and response target for one topic at a facility (migration 0097). */
export const upsertSettingSchema = z
  .object({
    facilityId: z.uuid(),
    topic: z.enum(MESSAGE_TOPICS),
    /** A role of the organization (its key), or one person; neither = everyone who can reply at the facility. */
    routeRoleKey: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,60}$/)
      .nullable()
      .optional(),
    routeUserId: z.uuid().nullable().optional(),
    autoAssign: z.boolean().default(false),
    responseTargetHours: z.number().int().min(1).max(168).nullable().optional(),
    version: z.number().int().positive().optional(),
  })
  .refine((v) => !(v.routeRoleKey && v.routeUserId), { message: "Route to a role or to a person, not both", path: ["routeUserId"] })
  .refine((v) => !v.autoAssign || Boolean(v.routeUserId), { message: "Assigning on arrival needs a person", path: ["autoAssign"] });
export class UpsertSettingDto extends createZodDto(upsertSettingSchema) {}

export const staffStartThreadSchema = startThreadSchema.extend({ patientId: z.uuid() });
export class StaffStartThreadDto extends createZodDto(staffStartThreadSchema) {}

export const threadQuerySchema = z.object({
  filter: z.enum(["awaiting", "open", "closed", "all"]).default("awaiting"),
  facilityId: z.uuid().optional(),
  patientId: z.uuid().optional(),
  assignedToMe: z.enum(["true", "false"]).optional(),
});
export class ThreadQueryDto extends createZodDto(threadQuerySchema) {}

export const assignThreadSchema = z.object({ assignToMe: z.boolean() });
export class AssignThreadDto extends createZodDto(assignThreadSchema) {}
