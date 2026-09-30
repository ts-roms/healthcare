import { pageQuerySchema } from "@healthcare/core";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ALLERGY_CATEGORIES, BOOKING_CHANNELS, MODALITIES, PROFESSIONS, ROOM_TYPES, VISIT_PRIORITIES } from "./clinic.schema";

const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Use lower-case letters, digits or hyphens");
const text = (max: number) => z.string().trim().min(1).max(max);
const reason = z.string().trim().min(3, "Give a reason").max(500);
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");
const isoDateTime = z.iso.datetime({ offset: true });

// ---- configuration --------------------------------------------------------

export const createPractitionerSchema = z.object({
  displayName: text(200),
  profession: z.enum(PROFESSIONS),
  specialty: text(120).optional(),
  licenseNumber: text(40).optional(),
  licenseValidUntil: z.iso.date().optional(),
  /** Link to a staff account so the person can document and prescribe as this practitioner. */
  userId: z.string().uuid().optional(),
});
export class CreatePractitionerDto extends createZodDto(createPractitionerSchema) {}

export const updatePractitionerSchema = createPractitionerSchema
  .partial()
  .extend({ status: z.enum(["active", "inactive"]).optional(), version: z.number().int().positive() });
export class UpdatePractitionerDto extends createZodDto(updatePractitionerSchema) {}

export const createRoomSchema = z.object({ facilityId: z.string().uuid(), code, name: text(120), roomType: z.enum(ROOM_TYPES) });
export class CreateRoomDto extends createZodDto(createRoomSchema) {}

export const createVisitTypeSchema = z.object({
  code,
  name: text(120),
  defaultDurationMinutes: z.number().int().min(5).max(480),
  modality: z.enum(MODALITIES).default("in_person"),
  requiresTriage: z.boolean().default(true),
  /** Patients may book this visit type themselves in MyHealth. */
  onlineBooking: z.boolean().default(false),
});
export class CreateVisitTypeDto extends createZodDto(createVisitTypeSchema) {}

export const updateVisitTypeSchema = z.object({
  name: text(120).optional(),
  defaultDurationMinutes: z.number().int().min(5).max(480).optional(),
  onlineBooking: z.boolean().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  version: z.number().int().positive(),
});
export class UpdateVisitTypeDto extends createZodDto(updateVisitTypeSchema) {}

export const createCodingSystemSchema = z.object({ key: code, name: text(120), version: text(40).optional() });
export class CreateCodingSystemDto extends createZodDto(createCodingSystemSchema) {}

export const createScheduleSchema = z
  .object({
    practitionerId: z.string().uuid(),
    facilityId: z.string().uuid(),
    roomId: z.string().uuid().optional(),
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: localTime,
    endTime: localTime,
    slotMinutes: z.number().int().min(5).max(240),
    validFrom: z.iso.date(),
    validUntil: z.iso.date().optional(),
  })
  .refine((v) => v.endTime > v.startTime, { message: "endTime must be after startTime", path: ["endTime"] })
  .refine((v) => !v.validUntil || v.validUntil >= v.validFrom, { message: "validUntil must not precede validFrom", path: ["validUntil"] });
export class CreateScheduleDto extends createZodDto(createScheduleSchema) {}

export const createExceptionSchema = z
  .object({
    facilityId: z.string().uuid(),
    /** Omit for a whole-facility closure (e.g. a declared holiday). */
    practitionerId: z.string().uuid().optional(),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    reason: text(300),
  })
  .refine((v) => v.endsAt > v.startsAt, { message: "endsAt must be after startsAt", path: ["endsAt"] });
export class CreateExceptionDto extends createZodDto(createExceptionSchema) {}

// ---- appointments ---------------------------------------------------------

export const availabilityQuerySchema = z.object({
  practitionerId: z.string().uuid(),
  facilityId: z.string().uuid(),
  visitTypeId: z.string().uuid(),
  date: z.iso.date(),
});
export class AvailabilityQueryDto extends createZodDto(availabilityQuerySchema) {}

export const bookAppointmentSchema = z.object({
  patientId: z.string().uuid(),
  practitionerId: z.string().uuid(),
  facilityId: z.string().uuid(),
  visitTypeId: z.string().uuid(),
  startsAt: isoDateTime,
  /** Defaults to the visit type's duration. */
  durationMinutes: z.number().int().min(5).max(480).optional(),
  roomId: z.string().uuid().optional(),
  bookingChannel: z.enum(BOOKING_CHANNELS).default("front_desk"),
  reason: text(500).optional(),
  notes: text(2000).optional(),
  /** Recurring series: repeat every N days, M times in total (including this one). */
  recurrence: z.object({ intervalDays: z.number().int().min(1).max(365), occurrences: z.number().int().min(2).max(52) }).optional(),
  /** Allow booking outside the practitioner's published schedule (e.g. an added clinic session). */
  outsideSchedule: z.boolean().default(false),
  waitlistEntryId: z.string().uuid().optional(),
});
export class BookAppointmentDto extends createZodDto(bookAppointmentSchema) {}

export const rescheduleSchema = z.object({
  startsAt: isoDateTime,
  durationMinutes: z.number().int().min(5).max(480).optional(),
  practitionerId: z.string().uuid().optional(),
  roomId: z.string().uuid().nullable().optional(),
  reason,
  version: z.number().int().positive(),
  outsideSchedule: z.boolean().default(false),
});
export class RescheduleDto extends createZodDto(rescheduleSchema) {}

export const cancelAppointmentSchema = z.object({ reason, version: z.number().int().positive() });
export class CancelAppointmentDto extends createZodDto(cancelAppointmentSchema) {}

export const versionOnlySchema = z.object({ version: z.number().int().positive() });
export class VersionOnlyDto extends createZodDto(versionOnlySchema) {}

export const listAppointmentsSchema = pageQuerySchema.extend({
  facilityId: z.string().uuid().optional(),
  practitionerId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  /** Local date in the facility's time zone. */
  date: z.iso.date().optional(),
  status: z.enum(["booked", "confirmed", "checked_in", "completed", "cancelled", "no_show"]).optional(),
});
export class ListAppointmentsDto extends createZodDto(listAppointmentsSchema) {}

export const createWaitlistSchema = z
  .object({
    patientId: z.string().uuid(),
    facilityId: z.string().uuid(),
    practitionerId: z.string().uuid().optional(),
    visitTypeId: z.string().uuid().optional(),
    earliestDate: z.iso.date(),
    latestDate: z.iso.date(),
    priority: z.enum(["routine", "soon"]).default("routine"),
    notes: text(1000).optional(),
  })
  .refine((v) => v.latestDate >= v.earliestDate, { message: "latestDate must not precede earliestDate", path: ["latestDate"] });
export class CreateWaitlistDto extends createZodDto(createWaitlistSchema) {}

export const closeWaitlistSchema = z.object({ reason });
export class CloseWaitlistDto extends createZodDto(closeWaitlistSchema) {}

// ---- queue ----------------------------------------------------------------

export const walkInSchema = z.object({
  patientId: z.string().uuid(),
  visitTypeId: z.string().uuid(),
  priority: z.enum(VISIT_PRIORITIES).default("routine"),
  chiefComplaint: text(500).optional(),
  assignedPractitionerId: z.string().uuid().optional(),
});
export class WalkInDto extends createZodDto(walkInSchema) {}

export const checkInSchema = z.object({ chiefComplaint: text(500).optional(), priority: z.enum(VISIT_PRIORITIES).default("routine") });
export class CheckInDto extends createZodDto(checkInSchema) {}

export const queueQuerySchema = z.object({
  date: z.iso.date().optional(),
  includeClosed: z.enum(["true", "false"]).optional(),
});
export class QueueQueryDto extends createZodDto(queueQuerySchema) {}

export const moveVisitSchema = z.object({
  status: z.enum(["in_triage", "awaiting_consultation", "cancelled", "left_without_being_seen"]),
  reason: reason.optional(),
  version: z.number().int().positive(),
});
export class MoveVisitDto extends createZodDto(moveVisitSchema) {}

export const callVisitSchema = z.object({ calledTo: text(60), version: z.number().int().positive() });
export class CallVisitDto extends createZodDto(callVisitSchema) {}

export const assignVisitSchema = z.object({
  practitionerId: z.string().uuid().nullable(),
  priority: z.enum(VISIT_PRIORITIES).optional(),
  version: z.number().int().positive(),
});
export class AssignVisitDto extends createZodDto(assignVisitSchema) {}

// ---- triage, vitals, allergies ---------------------------------------------

export const vitalsSchema = z
  .object({
    measuredAt: isoDateTime.optional(),
    systolicMmhg: z.number().int().optional(),
    diastolicMmhg: z.number().int().optional(),
    heartRateBpm: z.number().int().optional(),
    respiratoryRateBpm: z.number().int().optional(),
    temperatureC: z.number().optional(),
    spo2Percent: z.number().int().optional(),
    weightKg: z.number().optional(),
    heightCm: z.number().optional(),
    bloodGlucoseMgDl: z.number().int().optional(),
    notes: text(1000).optional(),
  })
  .refine(
    (v) =>
      [v.systolicMmhg, v.heartRateBpm, v.respiratoryRateBpm, v.temperatureC, v.spo2Percent, v.weightKg, v.heightCm, v.bloodGlucoseMgDl].some(
        (x) => x !== undefined,
      ),
    { message: "Record at least one measurement" },
  );
export class VitalsDto extends createZodDto(vitalsSchema) {}

export const recordVitalsSchema = z.object({
  patientId: z.string().uuid(),
  visitId: z.string().uuid().optional(),
  encounterId: z.string().uuid().optional(),
  vitals: vitalsSchema,
});
export class RecordVitalsDto extends createZodDto(recordVitalsSchema) {}

export const triageSchema = z.object({
  chiefComplaint: text(500),
  painScore: z.number().int().min(0).max(10).optional(),
  priority: z.enum(VISIT_PRIORITIES),
  riskFlags: z.array(text(60)).max(20).default([]),
  notes: text(2000).optional(),
  vitals: vitalsSchema.optional(),
  /** Move the patient to "awaiting consultation" (default) or keep them in triage. */
  completeTriage: z.boolean().default(true),
});
export class TriageDto extends createZodDto(triageSchema) {}

export const enteredInErrorSchema = z.object({ reason });
export class EnteredInErrorDto extends createZodDto(enteredInErrorSchema) {}

export const createAllergySchema = z.object({
  category: z.enum(ALLERGY_CATEGORIES),
  substance: text(200),
  reaction: text(500).optional(),
  severity: z.enum(["mild", "moderate", "severe"]).optional(),
  criticality: z.enum(["low", "high", "unable_to_assess"]).default("unable_to_assess"),
  verification: z.enum(["unconfirmed", "confirmed"]).default("unconfirmed"),
});
export class CreateAllergyDto extends createZodDto(createAllergySchema) {}

export const updateAllergyStatusSchema = z.object({
  status: z.enum(["active", "inactive", "resolved", "entered_in_error"]),
  reason: reason.optional(),
  version: z.number().int().positive(),
});
export class UpdateAllergyStatusDto extends createZodDto(updateAllergyStatusSchema) {}

// ---- encounters -------------------------------------------------------------

export const startEncounterSchema = z
  .object({
    visitId: z.string().uuid().optional(),
    /** For encounters without a queue visit (e.g. telemedicine or retrospective documentation). */
    patientId: z.string().uuid().optional(),
    modality: z.enum(MODALITIES).default("in_person"),
    chiefComplaint: text(500).optional(),
  })
  .refine((v) => Boolean(v.visitId) !== Boolean(v.patientId), { message: "Provide exactly one of visitId or patientId" });
export class StartEncounterDto extends createZodDto(startEncounterSchema) {}

const noteFields = {
  templateKey: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{1,48}$/)
    .default("soap"),
  subjective: z.string().max(20_000).optional(),
  objective: z.string().max(20_000).optional(),
  assessment: z.string().max(20_000).optional(),
  plan: z.string().max(20_000).optional(),
  /** Specialty template fields (structured, configurable). */
  sections: z.record(z.string().max(64), z.unknown()).default({}),
};

export const saveNoteSchema = z.object({ ...noteFields, basedOnRevision: z.number().int().min(0) });
export class SaveNoteDto extends createZodDto(saveNoteSchema) {}

export const amendNoteSchema = z.object({ ...noteFields, basedOnRevision: z.number().int().min(1), reason });
export class AmendNoteDto extends createZodDto(amendNoteSchema) {}

export const signEncounterSchema = z.object({ version: z.number().int().positive() });
export class SignEncounterDto extends createZodDto(signEncounterSchema) {}

export const addDiagnosisSchema = z
  .object({
    codeSystemKey: code.optional(),
    code: z.string().trim().min(1).max(20).optional(),
    display: text(300),
    rank: z.enum(["primary", "secondary"]).default("secondary"),
    certainty: z.enum(["provisional", "confirmed"]).default("provisional"),
    isChronic: z.boolean().default(false),
    notes: text(1000).optional(),
    /** Required when the encounter is already signed (becomes an amendment). */
    amendmentReason: reason.optional(),
  })
  .refine((v) => Boolean(v.code) === Boolean(v.codeSystemKey), { message: "code and codeSystemKey go together", path: ["code"] });
export class AddDiagnosisDto extends createZodDto(addDiagnosisSchema) {}

export const updateDiagnosisStatusSchema = z.object({
  status: z.enum(["resolved", "entered_in_error"]),
  certainty: z.enum(["provisional", "confirmed", "refuted"]).optional(),
  reason,
});
export class UpdateDiagnosisStatusDto extends createZodDto(updateDiagnosisStatusSchema) {}

export const listEncountersSchema = pageQuerySchema.extend({ patientId: z.string().uuid() });
export class ListEncountersDto extends createZodDto(listEncountersSchema) {}

export const dashboardQuerySchema = z.object({ date: z.iso.date().optional() });
export class DashboardQueryDto extends createZodDto(dashboardQuerySchema) {}

export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;
export type VitalsInput = z.infer<typeof vitalsSchema>;

// ---- patient self-booking (MyHealth) --------------------------------------

export const patientSlotsSchema = z.object({
  facilityId: z.string().uuid(),
  visitTypeId: z.string().uuid(),
  date: z.iso.date(),
  practitionerId: z.string().uuid().optional(),
});
export class PatientSlotsDto extends createZodDto(patientSlotsSchema) {}

export const patientBookSchema = z.object({
  facilityId: z.string().uuid(),
  visitTypeId: z.string().uuid(),
  practitionerId: z.string().uuid(),
  startsAt: isoDateTime,
  /** The patient's own words; optional. */
  reason: z.string().trim().min(1).max(500).optional(),
});
export class PatientBookDto extends createZodDto(patientBookSchema) {}

export const patientRescheduleSchema = z.object({
  startsAt: isoDateTime,
  version: z.number().int().positive(),
  /** Another practitioner at the same facility; the current one when omitted. */
  practitionerId: z.string().uuid().optional(),
});
export class PatientRescheduleDto extends createZodDto(patientRescheduleSchema) {}

export const patientCancelSchema = z.object({ reason: z.string().trim().min(3).max(500).optional(), version: z.number().int().positive() });
export class PatientCancelDto extends createZodDto(patientCancelSchema) {}

export const patientWaitlistJoinSchema = z.object({
  facilityId: z.string().uuid(),
  visitTypeId: z.string().uuid(),
  /** A particular practitioner; anyone on duty at the facility when omitted. */
  practitionerId: z.string().uuid().optional(),
  earliestDate: z.iso.date(),
  latestDate: z.iso.date(),
});
export class PatientWaitlistJoinDto extends createZodDto(patientWaitlistJoinSchema) {}

// ---- Online booking rules per facility (migration 0077) --------------------------------------

export const updateBookingRulesSchema = z.object({
  minLeadMinutes: z.number().int().min(0).max(10_080),
  maxAdvanceDays: z.number().int().min(1).max(365),
  maxUpcoming: z.number().int().min(1).max(20),
  changeCutoffMinutes: z.number().int().min(0).max(10_080),
  waitlistEnabled: z.boolean(),
  maxWaitlistEntries: z.number().int().min(1).max(10),
  /** The version read; not needed the first time a facility gets its own rules. */
  version: z.number().int().positive().optional(),
});
export class UpdateBookingRulesDto extends createZodDto(updateBookingRulesSchema) {}

// ---- Medical certificates (migration 0068) ---------------------------------------------------

const calendarDate = z.iso.date();

export const issueCertificateSchema = z.object({
  /** What the certificate is for, in the practitioner's words (e.g. "Absence from work"). */
  purpose: z.string().trim().min(3, "Say what the certificate is for").max(200),
  /** Findings or diagnosis as the practitioner states them on the certificate. */
  findings: z.string().trim().min(3, "Write the findings or diagnosis").max(2000),
  recommendations: z.string().trim().max(2000).optional(),
  /** A rest period, both dates included. */
  rest: z
    .object({ from: calendarDate, to: calendarDate })
    .refine((r) => r.to >= r.from, { message: "The rest period ends before it starts", path: ["to"] })
    .optional(),
});
export class IssueCertificateDto extends createZodDto(issueCertificateSchema) {}

export const voidCertificateSchema = z.object({ reason: z.string().trim().min(5, "Say why the certificate is void").max(500) });
export class VoidCertificateDto extends createZodDto(voidCertificateSchema) {}
