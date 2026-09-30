import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { MESSAGE_BODY_MAX, MESSAGE_SUBJECT_MAX, MESSAGE_TOPICS } from "./patient-message.rules";

const body = z.string().trim().min(1, "Write a message").max(MESSAGE_BODY_MAX, `At most ${MESSAGE_BODY_MAX} characters`);
const subject = z.string().trim().min(1, "Give the message a subject").max(MESSAGE_SUBJECT_MAX, `At most ${MESSAGE_SUBJECT_MAX} characters`);

export const startThreadSchema = z.object({ topic: z.enum(MESSAGE_TOPICS), subject, body });
export class StartThreadDto extends createZodDto(startThreadSchema) {}

export const replySchema = z.object({ body });
export class ReplyDto extends createZodDto(replySchema) {}

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
