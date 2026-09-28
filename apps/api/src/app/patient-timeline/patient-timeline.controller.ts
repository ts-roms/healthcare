import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { PatientTimelineService } from "./patient-timeline.service";
import { TIMELINE_KIND_KEYS, TIMELINE_MAX_PAGE_SIZE, TIMELINE_PAGE_SIZE, type TimelineKind } from "./timeline.rules";

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "Not a calendar date");

export const timelineQuerySchema = z.object({
  /** Comma-separated (or repeated) kinds; every kind the caller may see when omitted. */
  kinds: z
    .preprocess(
      (v) => (Array.isArray(v) ? v.join(",") : v),
      z
        .string()
        .transform((s) =>
          s
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
        )
        .pipe(z.array(z.enum(TIMELINE_KIND_KEYS as [TimelineKind, ...TimelineKind[]]))),
    )
    .optional(),
  /** Local dates (inclusive), read in the filtered facility's time zone (else the request's facility, else Asia/Manila). */
  from: localDate.optional(),
  to: localDate.optional(),
  facilityId: z.string().uuid().optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(TIMELINE_MAX_PAGE_SIZE).default(TIMELINE_PAGE_SIZE),
});
export class TimelineQueryDto extends createZodDto(timelineQuerySchema) {}

@ApiTags("patients")
@ApiBearerAuth()
@Controller({ path: "patients", version: "1" })
export class PatientTimelineController {
  constructor(private readonly timeline: PatientTimelineService) {}

  @Get(":patientId/timeline")
  @RequirePermissions("patient.read")
  @ApiOperation({
    summary:
      "Patient 360 timeline: appointments, encounters, vitals, prescriptions, laboratory orders and releases, dental, care plans, invoices, payments, communications, imported history and documents in one list, newest first (cursor paged). Kinds the caller may not read are listed in `withheld`.",
  })
  get(@CurrentActor() actor: Actor, @Param("patientId", ParseUUIDPipe) patientId: string, @Query() query: TimelineQueryDto) {
    return this.timeline.timeline(actor, patientId, query);
  }
}
