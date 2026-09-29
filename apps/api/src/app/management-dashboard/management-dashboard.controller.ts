import { Controller, Get, Query, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import { type Actor, CurrentActor, RequirePermissions } from "@healthcare/core";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { CSV_SECTIONS } from "./management-dashboard.csv";
import { ManagementDashboardService } from "./management-dashboard.service";

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "Not a calendar date");

export const managementDashboardQuerySchema = z.object({
  /** Local dates (inclusive), read in the facility's time zone; the last 30 days when omitted. */
  from: localDate.optional(),
  to: localDate.optional(),
  /** One facility; every facility the caller may report on when omitted. */
  facilityId: z.uuid().optional(),
  /** Compare the headline figures with the previous equal period (default true). */
  compare: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
});
export class ManagementDashboardQueryDto extends createZodDto(managementDashboardQuerySchema) {}

export const managementDashboardCsvQuerySchema = managementDashboardQuerySchema.omit({ compare: true }).extend({ section: z.enum(CSV_SECTIONS) });
export class ManagementDashboardCsvQueryDto extends createZodDto(managementDashboardCsvQuerySchema) {}

@ApiTags("management")
@ApiBearerAuth()
@Controller({ path: "management", version: "1" })
export class ManagementDashboardController {
  constructor(private readonly dashboards: ManagementDashboardService) {}

  @Get("dashboard")
  @RequirePermissions("management.dashboard.read")
  @ApiOperation({
    summary:
      'Management dashboard over a range of local days (≤ 366): patient volume and retention, appointments, no-shows, waiting time, providers and schedule utilization, laboratory volume, turnaround and rejections, dental, online consultations, revenue and collections (revenue also needs billing.report.read on every facility in scope), with the headline figures beside the previous equal period. Counts and amounts only; patient counts under 5 shown as "<5".',
  })
  get(@CurrentActor() actor: Actor, @Query() query: ManagementDashboardQueryDto) {
    return this.dashboards.dashboard(actor, query);
  }

  @Get("dashboard.csv")
  @RequirePermissions("management.dashboard.read")
  @ApiProduces("text/csv")
  @ApiOperation({
    summary:
      "One section of the management dashboard as CSV (same filters, scope, suppression and audit; revenue sections need billing.report.read on every facility in scope).",
  })
  async csv(@CurrentActor() actor: Actor, @Query() query: ManagementDashboardCsvQueryDto): Promise<StreamableFile> {
    const { section, ...filters } = query;
    const { filename, content } = await this.dashboards.csv(actor, filters, section);
    const body = Buffer.from(content, "utf8");
    return new StreamableFile(body, { type: "text/csv; charset=utf-8", disposition: `attachment; filename="${filename}"`, length: body.length });
  }
}
