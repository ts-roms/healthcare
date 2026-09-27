import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ACTIVITY_KINDS, CARE_PLAN_CATEGORIES, GOAL_STATUSES } from './care-plan.schema';

const text = (max: number) => z.string().trim().min(1).max(max);
const reason = z.string().trim().min(3).max(500);

export const goalSchema = z.object({
  description: text(500),
  targetMeasure: text(120).optional(),
  targetValue: text(120).optional(),
  targetDate: z.iso.date().optional(),
});
export class AddGoalDto extends createZodDto(goalSchema) {}

export const activitySchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  description: text(500),
  assignee: z.enum(['patient', 'care_team']),
  assigneePractitionerId: z.string().uuid().optional(),
  dueDate: z.iso.date().optional(),
  /** e.g. 90 for "repeat HbA1c every 3 months"; the next occurrence is created on completion. */
  recurrenceIntervalDays: z.number().int().min(1).max(730).optional(),
  /** Index into the plan's goals when creating a plan, or a goal id when adding later. */
  goalId: z.string().uuid().optional(),
});
export class AddActivityDto extends createZodDto(activitySchema) {}

export const problemSchema = z.object({ diagnosisId: z.string().uuid().optional(), description: text(300) });

export const createCarePlanSchema = z
  .object({
    patientId: z.string().uuid(),
    title: text(200),
    category: z.enum(CARE_PLAN_CATEGORIES),
    description: text(4000).optional(),
    status: z.enum(['draft', 'active']).default('active'),
    startDate: z.iso.date(),
    endDate: z.iso.date().optional(),
    authorPractitionerId: z.string().uuid().optional(),
    sourceEncounterId: z.string().uuid().optional(),
    problems: z.array(problemSchema).max(20).default([]),
    goals: z.array(goalSchema).max(30).default([]),
    activities: z.array(activitySchema.omit({ goalId: true }).extend({ goalIndex: z.number().int().min(0).optional() })).max(50).default([]),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: 'endDate must not precede startDate', path: ['endDate'] });
export class CreateCarePlanDto extends createZodDto(createCarePlanSchema) {}

export const changePlanStatusSchema = z.object({
  status: z.enum(['active', 'on_hold', 'completed', 'cancelled']),
  reason: reason.optional(),
  version: z.number().int().positive(),
});
export class ChangePlanStatusDto extends createZodDto(changePlanStatusSchema) {}

export const updateGoalSchema = z.object({ status: z.enum(GOAL_STATUSES) });
export class UpdateGoalDto extends createZodDto(updateGoalSchema) {}

export const updateActivitySchema = z
  .object({
    status: z.enum(['planned', 'scheduled', 'in_progress', 'completed', 'cancelled']),
    /** Required for "scheduled": the booked follow-up appointment. */
    appointmentId: z.string().uuid().optional(),
    reason: reason.optional(),
  })
  .refine((v) => v.status !== 'scheduled' || v.appointmentId, { message: 'appointmentId is required to schedule', path: ['appointmentId'] })
  .refine((v) => v.status !== 'cancelled' || v.reason, { message: 'A reason is required to cancel', path: ['reason'] });
export class UpdateActivityDto extends createZodDto(updateActivitySchema) {}

export const progressNoteSchema = z.object({ note: text(4000) });
export class ProgressNoteDto extends createZodDto(progressNoteSchema) {}

export const listCarePlansSchema = z.object({ patientId: z.string().uuid(), includeClosed: z.enum(['true', 'false']).optional() });
export class ListCarePlansDto extends createZodDto(listCarePlansSchema) {}

export const dueActivitiesSchema = z.object({
  /** Include activities due up to this many days ahead (default 7). */
  withinDays: z.coerce.number().int().min(0).max(90).default(7),
  kind: z.enum(ACTIVITY_KINDS).optional(),
  assigneePractitionerId: z.string().uuid().optional(),
});
export class DueActivitiesDto extends createZodDto(dueActivitiesSchema) {}
